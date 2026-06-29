extends Node
## Tests that tactical combat EventBus signals exist.

var _failed: bool = false

func _ready() -> void:
	_assert_true(EventBus.has_signal("round_resolved"), "round_resolved must exist")
	_assert_true(EventBus.has_signal("unit_incapacitated"), "unit_incapacitated must exist")
	_assert_true(EventBus.has_signal("tactical_combat_opened"), "tactical_combat_opened must exist")
	_assert_true(EventBus.has_signal("tactical_combat_closed"), "tactical_combat_closed must exist")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return
	print("EventBus signals test passed.")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)
