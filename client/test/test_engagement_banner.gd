extends Node
## Tests for EngagementBanner HP logic and lifecycle.

var _banner: Node2D = null
var _failed: bool = false

func _ready() -> void:
	_banner = preload("res://scenes/systems/military/engagement_banner.tscn").instantiate()
	add_child(_banner)

	_assert_true(_banner.has_method("setup"), "must have setup()")
	_assert_true(_banner.has_method("update_hp"), "must have update_hp()")

	_assert_almost_eq(_banner.get_atk_hp_pct(), 0.5, 0.001, "default atk HP = 0.5")
	_assert_almost_eq(_banner.get_def_hp_pct(), 0.5, 0.001, "default def HP = 0.5")

	_banner.update_hp(1.5, -0.2)
	_assert_almost_eq(_banner.get_atk_hp_pct(), 1.0, 0.001, "atk HP clamped to 1.0")
	_assert_almost_eq(_banner.get_def_hp_pct(), 0.0, 0.001, "def HP clamped to 0.0")

	_banner.update_hp(0.90, 0.35)
	_assert_true(_banner.get_suppression_warning(), "amber warning when def HP < 40%")

	_banner.update_hp(0.15, 0.80)
	_assert_true(_banner.get_suppression_warning(), "amber warning when atk HP < 20%")

	_banner.update_hp(0.75, 0.75)
	_assert_false(_banner.get_suppression_warning(), "no warning when both HP healthy")

	_assert_true(_banner.has_method("cleanup"), "must have cleanup() for signal disconnection")

	if _failed:
		push_error("EngagementBanner test FAILED")
		get_tree().quit(1)
		return
	print("EngagementBanner test passed.")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)


func _assert_false(value: bool, message: String) -> void:
	if not value:
		return
	_failed = true
	push_error("ASSERT FALSE FAILED: " + message)


func _assert_almost_eq(actual: float, expected: float, tolerance: float, message: String) -> void:
	if absf(actual - expected) <= tolerance:
		return
	_failed = true
	push_error("ASSERT ALMOST EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
