class_name PauseMenu
extends CanvasLayer

const _KeybindScene: PackedScene = preload("res://scenes/game/settings_keybind.tscn")
const OPEN_ANIMATION_SECONDS: float = 0.18
const CLOSE_ANIMATION_SECONDS: float = 0.14
const TARGET_BLUR_STRENGTH: float = 15.0
const TARGET_DIM_ALPHA: float = 0.52
const PANEL_CLOSED_SCALE: Vector2 = Vector2(0.96, 0.96)

@onready var _continue_button: Button = %ContinueButton
@onready var _settings_button: Button = %SettingsButton
@onready var _how_to_play_button: Button = %HowToPlayButton
@onready var _quit_button: Button = %QuitButton
@onready var _blur_overlay: ColorRect = %BlurOverlay
@onready var _dim_overlay: ColorRect = %DimOverlay
@onready var _panel: PanelContainer = %Panel

var _restore_clear_color: Color = Color.BLACK
var _has_restore_clear_color: bool = false
var _keybind_panel: Node = null
var _animation_tween: Tween = null
var _is_closing: bool = false
var _is_blocking_player_input: bool = false


func _ready() -> void:
	visible = false
	_apply_closed_visual_state()
	_continue_button.pressed.connect(hide_menu)
	_settings_button.pressed.connect(_on_settings_pressed)
	_how_to_play_button.pressed.connect(_on_placeholder_button_pressed)
	_quit_button.pressed.connect(_on_quit_button_pressed)
	_dim_overlay.gui_input.connect(_on_dim_input)


## Shows the visual pause menu. This does not pause multiplayer simulation.
## Parameters: none.
## Returns: nothing.
func show_menu() -> void:
	_kill_animation_tween()
	_is_closing = false
	visible = true
	_set_player_input_blocking(true)
	_prepare_panel_pivot()
	_apply_closed_visual_state()

	_animation_tween = create_tween()
	_animation_tween.set_parallel(true)
	_animation_tween.set_trans(Tween.TRANS_SINE)
	_animation_tween.set_ease(Tween.EASE_OUT)
	_animation_tween.tween_method(_set_blur_strength, 0.0, TARGET_BLUR_STRENGTH, OPEN_ANIMATION_SECONDS)
	_animation_tween.tween_method(_set_dim_alpha, 0.0, TARGET_DIM_ALPHA, OPEN_ANIMATION_SECONDS)
	_animation_tween.tween_property(_panel, "modulate:a", 1.0, OPEN_ANIMATION_SECONDS)
	_animation_tween.tween_property(_panel, "scale", Vector2.ONE, OPEN_ANIMATION_SECONDS)
	_continue_button.grab_focus()


## Hides the visual pause menu.
## Parameters: none.
## Returns: nothing.
func hide_menu() -> void:
	if not visible:
		return

	_kill_animation_tween()
	_is_closing = true
	_prepare_panel_pivot()

	_animation_tween = create_tween()
	_animation_tween.set_parallel(true)
	_animation_tween.set_trans(Tween.TRANS_SINE)
	_animation_tween.set_ease(Tween.EASE_IN)
	_animation_tween.tween_method(_set_blur_strength, _get_blur_strength(), 0.0, CLOSE_ANIMATION_SECONDS)
	_animation_tween.tween_method(_set_dim_alpha, _dim_overlay.color.a, 0.0, CLOSE_ANIMATION_SECONDS)
	_animation_tween.tween_property(_panel, "modulate:a", 0.0, CLOSE_ANIMATION_SECONDS)
	_animation_tween.tween_property(_panel, "scale", PANEL_CLOSED_SCALE, CLOSE_ANIMATION_SECONDS)
	_animation_tween.finished.connect(_on_hide_animation_finished, CONNECT_ONE_SHOT)


## Toggles the visual pause menu.
## Parameters: none.
## Returns: nothing.
func toggle_menu() -> void:
	if visible and not _is_closing:
		hide_menu()
	else:
		show_menu()


## Sets the clear color to restore when leaving the game.
## Parameters:
## - clear_color: viewport clear color captured before the game scene changed it.
## Returns: nothing.
func set_restore_clear_color(clear_color: Color) -> void:
	_restore_clear_color = clear_color
	_has_restore_clear_color = true


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return

	if event is InputEventKey:
		var key: InputEventKey = event as InputEventKey
		if key.pressed and not key.echo and key.physical_keycode == KEY_ESCAPE:
			hide_menu()
		get_viewport().set_input_as_handled()
		return

	if event is InputEventMouseButton or event is InputEventMouseMotion:
		get_viewport().set_input_as_handled()


func _on_dim_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		get_viewport().set_input_as_handled()
		return
	if not (event is InputEventMouseButton):
		return
	var mb: InputEventMouseButton = event as InputEventMouseButton
	if mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN,
			MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT]:
		get_viewport().set_input_as_handled()
		return
	if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
		get_viewport().set_input_as_handled()
		hide_menu()


func _on_settings_pressed() -> void:
	if _keybind_panel == null:
		_keybind_panel = _KeybindScene.instantiate()
		add_child(_keybind_panel)
	_keybind_panel.show_panel()


func _on_placeholder_button_pressed() -> void:
	pass


## Leaves the current room and returns this client to the main menu.
## Parameters: none.
## Returns: nothing.
func _on_quit_button_pressed() -> void:
	if _has_restore_clear_color:
		RenderingServer.set_default_clear_color(_restore_clear_color)
	SceneManager.goto_main_menu_loading()
	NetManager.disconnect_from_room.call_deferred()


## Stops the active pause menu animation before a new visibility state starts.
## Parameters: none.
## Returns: nothing.
func _kill_animation_tween() -> void:
	if _animation_tween == null:
		return
	if _animation_tween.is_valid():
		_animation_tween.kill()
	_animation_tween = null


## Restores all pause visuals to their fully hidden state.
## Parameters: none.
## Returns: nothing.
func _apply_closed_visual_state() -> void:
	_set_blur_strength(0.0)
	_set_dim_alpha(0.0)
	_panel.modulate.a = 0.0
	_panel.scale = PANEL_CLOSED_SCALE


## Centers the panel scale pivot so the entry animation expands from the middle.
## Parameters: none.
## Returns: nothing.
func _prepare_panel_pivot() -> void:
	_panel.pivot_offset = _panel.size * 0.5


## Updates the shader blur amount on the full-screen pause background layer.
## Parameters:
## - value: blur radius multiplier in screen pixels.
## Returns: nothing.
func _set_blur_strength(value: float) -> void:
	var blur_material: ShaderMaterial = _blur_overlay.material as ShaderMaterial
	if blur_material == null:
		return
	blur_material.set_shader_parameter("blur_strength", value)


## Reads the current shader blur amount from the pause background layer.
## Parameters: none.
## Returns: current blur radius multiplier in screen pixels.
func _get_blur_strength() -> float:
	var blur_material: ShaderMaterial = _blur_overlay.material as ShaderMaterial
	if blur_material == null:
		return 0.0
	var blur_strength: Variant = blur_material.get_shader_parameter("blur_strength")
	if blur_strength is float:
		return blur_strength
	if blur_strength is int:
		return float(blur_strength)
	return 0.0


## Updates only the opacity of the pause dim layer.
## Parameters:
## - value: alpha from transparent to fully opaque.
## Returns: nothing.
func _set_dim_alpha(value: float) -> void:
	var dim_color: Color = _dim_overlay.color
	dim_color.a = value
	_dim_overlay.color = dim_color


## Completes close animation cleanup after the reverse tween has finished.
## Parameters: none.
## Returns: nothing.
func _on_hide_animation_finished() -> void:
	visible = false
	_is_closing = false
	_animation_tween = null
	_apply_closed_visual_state()
	_set_player_input_blocking(false)


## Broadcasts whether gameplay-facing input systems should ignore player input.
## Parameters:
## - blocking: true while the pause menu owns player input.
## Returns: nothing.
func _set_player_input_blocking(blocking: bool) -> void:
	if _is_blocking_player_input == blocking:
		return
	_is_blocking_player_input = blocking
	EventBus.pause_menu_blocking_changed.emit(blocking)
