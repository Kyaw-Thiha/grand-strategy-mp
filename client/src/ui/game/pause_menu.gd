extends CanvasLayer

const _KeybindScene := preload("res://scenes/game/settings_keybind.tscn")

@onready var _continue_button: Button = %ContinueButton
@onready var _settings_button: Button = %SettingsButton
@onready var _how_to_play_button: Button = %HowToPlayButton
@onready var _quit_button: Button = %QuitButton

var _restore_clear_color: Color = Color.BLACK
var _has_restore_clear_color: bool = false
var _keybind_panel: Node = null


func _ready() -> void:
	hide_menu()
	_continue_button.pressed.connect(hide_menu)
	_settings_button.pressed.connect(_on_settings_pressed)
	_how_to_play_button.pressed.connect(_on_placeholder_button_pressed)
	_quit_button.pressed.connect(_on_quit_button_pressed)


## Shows the visual pause menu. This does not pause multiplayer simulation.
## Parameters: none.
## Returns: nothing.
func show_menu() -> void:
	visible = true
	_continue_button.grab_focus()


## Hides the visual pause menu.
## Parameters: none.
## Returns: nothing.
func hide_menu() -> void:
	visible = false


## Toggles the visual pause menu.
## Parameters: none.
## Returns: nothing.
func toggle_menu() -> void:
	if visible:
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
