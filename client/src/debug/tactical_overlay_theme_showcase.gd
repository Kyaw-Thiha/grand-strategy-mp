extends Control
## Presents otherwise transient button states side by side for theme review.

@onready var hover_preview: Button = %HoverPreview
@onready var hold_hover_preview: Button = %HoldHoverPreview
@onready var retreat_hover_preview: Button = %RetreatHoverPreview
@onready var focus_preview: Button = %FocusPreview


func _ready() -> void:
	for node: Node in find_children("*", "Button", true, false):
		var button: Button = node as Button
		button.custom_minimum_size.y = maxf(button.custom_minimum_size.y, 34.0)
	_show_hover_state(hover_preview, &"TacticalOverlayButton")
	_show_hover_state(hold_hover_preview, &"TacticalHoldButton")
	_show_hover_state(retreat_hover_preview, &"TacticalRetreatButton")
	focus_preview.grab_focus()


func _show_hover_state(button: Button, variation: StringName) -> void:
	button.add_theme_stylebox_override("normal", button.get_theme_stylebox("hover", variation))
	button.add_theme_color_override("font_color", button.get_theme_color("font_hover_color", variation))
