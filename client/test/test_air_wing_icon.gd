extends Node


var icon: Node2D


func _ready() -> void:
	icon = $AirWingIcon
	_test_idle_hidden()
	_test_visible_states()
	_test_readiness_tint()
	_test_count_badge()
	print("[PASS] test_air_wing_icon: all tests passed")
	get_tree().quit()


func _test_idle_hidden() -> void:
	icon.lifecycle_state = "idle"
	icon._update_visibility()
	assert(not icon.visible, "IDLE wing icon must be hidden")


func _test_visible_states() -> void:
	for state in ["transit", "engaged", "loiter", "rtb", "refuel"]:
		icon.lifecycle_state = state
		icon._update_visibility()
		assert(icon.visible, "Wing in '%s' state must be visible" % state)


func _test_readiness_tint() -> void:
	icon.combat_readiness = 1.0
	var c: Color = icon._readiness_color()
	assert(c.g > c.r, "High readiness (1.0) must be green-dominant")

	icon.combat_readiness = 0.55
	c = icon._readiness_color()
	assert(c.r > 0.4 and c.g > 0.4, "Mid readiness (0.55) must be yellow (both r and g present)")
	assert(c.b < 0.2,                "Mid readiness must not be blue-dominant")

	icon.combat_readiness = 0.2
	c = icon._readiness_color()
	assert(c.r > c.g, "Low readiness (0.2) must be red-dominant")


func _test_count_badge() -> void:
	icon.wing_count = 1
	assert(not icon._should_show_count_badge(), "No count badge for wing_count == 1")

	icon.wing_count = 3
	assert(icon._should_show_count_badge(), "Count badge required for wing_count > 1")

	icon.wing_count = 24
	assert(icon._should_show_count_badge(), "Count badge required for wing_count == 24")
