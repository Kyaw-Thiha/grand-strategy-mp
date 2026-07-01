class_name MaximizeMinimizeToggleButton
extends Button
## Reusable icon-only button for maximize/minimize UI state.
## `button_pressed == true` means the owning UI is currently maximized.

const MAXIMIZED_ICON: Texture2D = preload("res://assets/icons/up-right-and-down-left-from-center-solid-full.svg")
const MINIMIZED_ICON: Texture2D = preload("res://assets/icons/down-left-and-up-right-to-center-solid-full.svg")

var is_maximized: bool:
	get:
		return button_pressed
	set(value):
		set_maximized(value)


func _ready() -> void:
	toggle_mode = true
	focus_mode = Control.FOCUS_NONE
	mouse_filter = Control.MOUSE_FILTER_STOP
	if not toggled.is_connected(_on_toggled):
		toggled.connect(_on_toggled)
	set_maximized(button_pressed)


## Sets the current maximize state and refreshes icon/tooltip.
## Parameters:
## - value: true when the owning UI is maximized, false when minimized.
## Returns: nothing.
func set_maximized(value: bool) -> void:
	set_pressed_no_signal(value)
	_refresh_visual_state()


## Alternates between maximized and minimized states.
## Parameters: none.
## Returns: nothing.
func toggle() -> void:
	set_maximized(not button_pressed)
	toggled.emit(button_pressed)


## Updates the icon and tooltip after a state change.
## Parameters: none.
## Returns: nothing.
func _refresh_visual_state() -> void:
	if button_pressed:
		icon = MAXIMIZED_ICON
		tooltip_text = "Minimize"
	else:
		icon = MINIMIZED_ICON
		tooltip_text = "Maximize"


func _on_toggled(_pressed: bool) -> void:
	_refresh_visual_state()
