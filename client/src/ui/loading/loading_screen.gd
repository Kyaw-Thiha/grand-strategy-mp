extends Control

const BACKGROUND_DIRECTORY: String = "res://assets/loading-screen"
const BACKGROUND_PREFIX: String = "loading-screen"
const BACKGROUND_SUFFIX: String = ".png"
const BACKGROUND_ROTATION_SECONDS: float = 10.0
const BACKGROUND_FADE_SECONDS: float = 0.8
const MINIMUM_VISIBLE_SECONDS: float = 2.0
const SERVER_WAIT_PROGRESS_CAP: float = 70.0
const SERVER_WAIT_PROGRESS_PER_SECOND: float = 14.0
const LOADING_TIPS: Array[String] = [
	"The most peaceful country in Civ VI: India",
	"Did you know that Italian tanks in WW2 had 4 gears? 1 for advancing and 3 for retreating.",
	"Whoever reading this is gay",
]

@onready var _background_a: TextureRect = %BackgroundA
@onready var _background_b: TextureRect = %BackgroundB
@onready var _tip_label: Label = %TipLabel
@onready var _progress_bar: ProgressBar = %ProgressBar
@onready var _progress_label: Label = %ProgressLabel
@onready var _rotation_timer: Timer = %RotationTimer

var _rng: RandomNumberGenerator = RandomNumberGenerator.new()
var _loading_image_paths: Array[String] = []
var _remaining_image_paths: Array[String] = []
var _active_background: TextureRect = null
var _inactive_background: TextureRect = null
var _target_scene_path: String = ""
var _loaded_scene: PackedScene = null
var _elapsed_seconds: float = 0.0
var _waiting_for_game_start: bool = false
var _uses_server_wait_stage: bool = false
var _thread_load_requested: bool = false
var _thread_load_finished: bool = false
var _transition_completed: bool = false


func _ready() -> void:
	_rng.randomize()
	_active_background = _background_a
	_inactive_background = _background_b
	_background_a.modulate.a = 1.0
	_background_b.modulate.a = 0.0
	_progress_bar.value = 0.0

	_load_background_paths()
	_show_next_loading_card(false)
	_rotation_timer.wait_time = BACKGROUND_ROTATION_SECONDS
	_rotation_timer.timeout.connect(_on_rotation_timer_timeout)
	_rotation_timer.start()

	_target_scene_path = SceneManager.get_loading_target_scene_path()
	_waiting_for_game_start = SceneManager.should_loading_wait_for_game_start()
	_uses_server_wait_stage = _waiting_for_game_start
	SceneManager.game_start_confirmed.connect(_on_game_start_confirmed)
	if _waiting_for_game_start:
		_progress_label.text = "Waiting for server..."
	else:
		_request_threaded_scene_load()


func _process(delta: float) -> void:
	_elapsed_seconds += delta
	if _waiting_for_game_start:
		_update_server_wait_progress(delta)
	else:
		_poll_scene_load_progress()
	_try_complete_transition()


func _on_rotation_timer_timeout() -> void:
	_show_next_loading_card(true)


func _on_game_start_confirmed() -> void:
	if not _waiting_for_game_start:
		return
	_waiting_for_game_start = false
	_progress_bar.value = maxf(_progress_bar.value, SERVER_WAIT_PROGRESS_CAP)
	_request_threaded_scene_load()


## Loads available loading-screen image paths from the configured asset directory.
## Parameters: none.
## Returns: nothing.
func _load_background_paths() -> void:
	_loading_image_paths.clear()
	var directory: DirAccess = DirAccess.open(BACKGROUND_DIRECTORY)
	if directory == null:
		push_warning("LoadingScreen: missing background directory: " + BACKGROUND_DIRECTORY)
		return

	directory.list_dir_begin()
	var file_name: String = directory.get_next()
	while not file_name.is_empty():
		if not directory.current_is_dir() and _is_loading_screen_image(file_name):
			_loading_image_paths.append("%s/%s" % [BACKGROUND_DIRECTORY, file_name])
		file_name = directory.get_next()
	directory.list_dir_end()
	_loading_image_paths.sort()


## Returns whether a file name follows the loading-screen image naming convention.
## Parameters:
## - file_name: file name from the loading-screen directory.
## Returns: true when the file should be used as a loading background.
func _is_loading_screen_image(file_name: String) -> bool:
	return file_name.begins_with(BACKGROUND_PREFIX) and file_name.ends_with(BACKGROUND_SUFFIX)


## Shows the next loading image and tip, optionally crossfading from the current image.
## Parameters:
## - fade: true to crossfade between background layers.
## Returns: nothing.
func _show_next_loading_card(fade: bool) -> void:
	var image_path: String = _take_next_image_path()
	if not image_path.is_empty():
		var image_texture: Texture2D = load(image_path) as Texture2D
		if fade:
			_crossfade_to_texture(image_texture)
		else:
			_active_background.texture = image_texture

	_tip_label.text = _pick_tip()


## Returns the next background image path without repeats until the list is exhausted.
## Parameters: none.
## Returns: resource path for the next loading image, or an empty string when none exist.
func _take_next_image_path() -> String:
	if _loading_image_paths.is_empty():
		return ""
	if _remaining_image_paths.is_empty():
		_remaining_image_paths = _loading_image_paths.duplicate()
		_remaining_image_paths.shuffle()
	return _remaining_image_paths.pop_back()


## Crossfades the inactive background layer in with a new texture.
## Parameters:
## - texture: texture to fade in.
## Returns: nothing.
func _crossfade_to_texture(texture: Texture2D) -> void:
	_inactive_background.texture = texture
	_inactive_background.modulate.a = 0.0
	var tween: Tween = create_tween()
	tween.set_parallel(true)
	tween.tween_property(_inactive_background, "modulate:a", 1.0, BACKGROUND_FADE_SECONDS)
	tween.tween_property(_active_background, "modulate:a", 0.0, BACKGROUND_FADE_SECONDS)
	tween.finished.connect(_swap_background_layers)


## Swaps active and inactive background layers after a fade completes.
## Parameters: none.
## Returns: nothing.
func _swap_background_layers() -> void:
	var previous_active_background: TextureRect = _active_background
	_active_background = _inactive_background
	_inactive_background = previous_active_background


## Picks a random loading tip.
## Parameters: none.
## Returns: loading tip text.
func _pick_tip() -> String:
	if LOADING_TIPS.is_empty():
		return ""
	var tip_index: int = _rng.randi_range(0, LOADING_TIPS.size() - 1)
	return LOADING_TIPS[tip_index]


## Requests threaded loading for the target scene once server readiness allows it.
## Parameters: none.
## Returns: nothing.
func _request_threaded_scene_load() -> void:
	if _thread_load_requested:
		return
	_thread_load_requested = true
	var request_error: Error = ResourceLoader.load_threaded_request(_target_scene_path)
	if request_error != OK:
		push_error("LoadingScreen: failed to request scene load: %s" % _target_scene_path)
		_thread_load_finished = true


## Advances staged loading progress while waiting for server game-start confirmation.
## Parameters:
## - delta: frame delta seconds.
## Returns: nothing.
func _update_server_wait_progress(delta: float) -> void:
	var next_value: float = _progress_bar.value + SERVER_WAIT_PROGRESS_PER_SECOND * delta
	_progress_bar.value = minf(next_value, SERVER_WAIT_PROGRESS_CAP)
	_progress_label.text = "Starting game... %d%%" % int(round(_progress_bar.value))


## Polls threaded scene loading and updates the progress bar.
## Parameters: none.
## Returns: nothing.
func _poll_scene_load_progress() -> void:
	if not _thread_load_requested or _thread_load_finished or _target_scene_path.is_empty():
		return

	var progress: Array = []
	var status: int = ResourceLoader.load_threaded_get_status(_target_scene_path, progress)
	var loaded_fraction: float = 0.0
	if not progress.is_empty():
		loaded_fraction = float(progress[0])
	var progress_floor: float = SERVER_WAIT_PROGRESS_CAP if _uses_server_wait_stage else 0.0
	_progress_bar.value = clampf(
		progress_floor + loaded_fraction * (100.0 - progress_floor),
		progress_floor,
		100.0
	)
	_progress_label.text = "Loading... %d%%" % int(round(_progress_bar.value))

	if status == ResourceLoader.THREAD_LOAD_LOADED:
		var loaded_resource: Resource = ResourceLoader.load_threaded_get(_target_scene_path)
		_loaded_scene = loaded_resource as PackedScene
		_thread_load_finished = true
		_progress_bar.value = 100.0
		_progress_label.text = "Loading... 100%"
	elif status == ResourceLoader.THREAD_LOAD_FAILED or status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
		push_error("LoadingScreen: scene load failed: %s" % _target_scene_path)
		_thread_load_finished = true


## Enters the loaded scene once loading is complete and the minimum display time has passed.
## Parameters: none.
## Returns: nothing.
func _try_complete_transition() -> void:
	if _transition_completed:
		return
	if not _thread_load_finished:
		return
	if _elapsed_seconds < MINIMUM_VISIBLE_SECONDS:
		return
	if _loaded_scene == null:
		return

	_transition_completed = true
	SceneManager.complete_loading_transition(_loaded_scene)
