extends Control
## Configures isolated action-state and edge-fallback surround variants.


func _ready() -> void:
	_configure_icon($TwoIcon, Color(0.12, 0.38, 0.72), "normal", 82.0, 18.0)
	_configure_icon($ThreeIcon, Color(0.36, 0.48, 0.24), "engaged", 61.0, 43.0)
	_configure_icon($FourIcon, Color(0.48, 0.24, 0.18), "suppressed", 37.0, 76.0)
	_configure_icon($BottomRightIcon, Color(0.56, 0.42, 0.16), "suppressed", 54.0, 68.0)
	$TwoControls.set_control_count(2)
	$ThreeControls.set_control_count(3)
	$ThreeControls.set_action_context("showcase", true)
	$ThreeControls.set_placement(&"top_left")
	$FourControls.set_control_count(4)
	$FourControls.set_placement(&"bottom_left")
	$BottomRightControls.set_action_context("showcase", false, true)
	$BottomRightControls.set_placement(&"bottom_right")


func _configure_icon(
		icon: Node2D,
		nation_color: Color,
		combat_state: String,
		hp: float,
		suppression: float
) -> void:
	icon.setup(
		{
			"division_id": "showcase",
			"hp": hp,
			"max_hp": 100.0,
			"suppression": suppression,
			"combat_state": combat_state,
			"supply_status": "out_of_supply" if combat_state == "suppressed" else "normal",
			"move_order": [],
		},
		nation_color,
		60.0,
		45.0,
		60.0
	)
