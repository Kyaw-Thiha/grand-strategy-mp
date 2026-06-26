extends PanelContainer
## Economy panel — side-docked, placeholder for Phase 9.
## Gold accent (#c9982f) per UI wireframe.

signal close_requested()

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())


func cycle_sub_tab(forward: bool) -> void:
	pass  # No sub-tabs yet
