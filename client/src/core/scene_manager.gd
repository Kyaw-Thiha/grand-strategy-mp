extends Node
## Handles all scene transitions. Single point of control for moving between
## main menu, lobby, game, and postgame screens.

signal scene_changed(scene_name: String)
signal game_start_confirmed()

const SCENE_MAIN_MENU := "res://scenes/main_menu/main_menu.tscn"
const SCENE_LOBBY     := "res://scenes/lobby/lobby.tscn"
const SCENE_LOADING   := "res://scenes/loading/loading_screen.tscn"
const SCENE_GAME      := "res://scenes/debug/map_debug.tscn"  # Phase 3: reuse map debug
const SCENE_POSTGAME  := "res://scenes/postgame/postgame.tscn"

var _loading_target_scene_path: String = ""
var _loading_target_scene_name: String = ""
var _loading_waits_for_game_start: bool = false
var _game_start_confirmed: bool = false


func goto_main_menu() -> void:
	_transition(SCENE_MAIN_MENU, "main_menu")


## Shows the loading screen before entering the main menu.
## Parameters: none.
## Returns: nothing.
func goto_main_menu_loading() -> void:
	goto_loading_target(SCENE_MAIN_MENU, "main_menu")


func goto_lobby() -> void:
	_transition(SCENE_LOBBY, "lobby")


func goto_game() -> void:
	goto_game_loading(false)


## Shows the loading screen before entering the game scene.
## Parameters:
## - wait_for_game_start: true when the screen should wait for GAME_STARTED before loading the game scene.
## Returns: nothing.
func goto_game_loading(wait_for_game_start: bool) -> void:
	_set_loading_target(SCENE_GAME, "game")
	_loading_waits_for_game_start = wait_for_game_start
	_game_start_confirmed = not wait_for_game_start
	_transition(SCENE_LOADING, "loading")


## Shows the loading screen before entering an arbitrary target scene.
## Parameters:
## - scene_path: scene resource path to load.
## - scene_name: semantic scene name emitted after transition.
## Returns: nothing.
func goto_loading_target(scene_path: String, scene_name: String) -> void:
	_set_loading_target(scene_path, scene_name)
	_loading_waits_for_game_start = false
	_game_start_confirmed = true
	_transition(SCENE_LOADING, "loading")


func goto_postgame() -> void:
	_transition(SCENE_POSTGAME, "postgame")


## Returns the scene path currently being loaded by the loading screen.
## Parameters: none.
## Returns: target scene path, or the game scene path when no explicit target is pending.
func get_loading_target_scene_path() -> String:
	if _loading_target_scene_path.is_empty():
		return SCENE_GAME
	return _loading_target_scene_path


## Returns whether the active loading screen should wait for server game-start confirmation.
## Parameters: none.
## Returns: true when loading was opened before GAME_STARTED arrived.
func should_loading_wait_for_game_start() -> bool:
	return _loading_waits_for_game_start and not _game_start_confirmed


## Returns whether SceneManager is currently routing into the game through loading.
## Parameters: none.
## Returns: true when a game loading target is pending.
func is_game_loading_pending() -> bool:
	return _loading_target_scene_name == "game"


## Marks the server game-start event as received and releases any waiting loading screen.
## Parameters: none.
## Returns: nothing.
func confirm_game_start() -> void:
	if not is_game_loading_pending():
		return
	_loading_waits_for_game_start = false
	_game_start_confirmed = true
	game_start_confirmed.emit()


## Cancels a pending game-start loading flow and returns to the lobby.
## Parameters:
## - reason: user-facing error text.
## Returns: nothing.
func cancel_game_start_loading(reason: String) -> void:
	if not is_game_loading_pending():
		return
	_loading_target_scene_path = ""
	_loading_target_scene_name = ""
	_loading_waits_for_game_start = false
	_game_start_confirmed = false
	goto_lobby()
	if not reason.is_empty():
		EventBus.notification_requested.emit(reason, "error")


## Completes a loading-screen transition with an already loaded scene resource.
## Parameters:
## - packed_scene: loaded scene resource to enter.
## Returns: nothing.
func complete_loading_transition(packed_scene: PackedScene) -> void:
	var scene_name: String = _loading_target_scene_name
	if scene_name.is_empty():
		scene_name = "game"
	_loading_target_scene_path = ""
	_loading_target_scene_name = ""
	_loading_waits_for_game_start = false
	_game_start_confirmed = false
	get_tree().change_scene_to_packed(packed_scene)
	scene_changed.emit(scene_name)


func _set_loading_target(scene_path: String, scene_name: String) -> void:
	_loading_target_scene_path = scene_path
	_loading_target_scene_name = scene_name


func _transition(scene_path: String, scene_name: String) -> void:
	get_tree().change_scene_to_file(scene_path)
	scene_changed.emit(scene_name)
