extends Node


var _failed: bool = false


func _ready() -> void:
	var air_layer: Node2D = Node2D.new()
	var map_loader: Node = Node.new()

	var air_system: Node = preload("res://src/systems/air/air_wing_system.gd").new()
	air_system.setup(map_loader, air_layer)
	_assert_true(air_layer.get_child_count() > 0, "AirWingSystem must attach a preview overlay to the air layer")

	_assert_true(air_system.has_method("_append_pending_milestone"), "AirWingSystem missing _append_pending_milestone()")
	_assert_true(air_system.has_method("_remove_last_pending_milestone"), "AirWingSystem missing _remove_last_pending_milestone()")
	_assert_true(air_system.has_method("_clear_pending"), "AirWingSystem missing _clear_pending()")

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	air_system.call("_append_pending_milestone", "wp-1")
	air_system.call("_append_pending_milestone", "wp-2")
	_assert_eq(air_system.get("_pending_milestones"), ["wp-1", "wp-2"], "milestones must append in order")
	_assert_eq(air_system.get("_pending_chain"), ["wp-1", "wp-2"], "pending chain must mirror appended milestones")
	_assert_true(air_system.get("_shift_chain_started"), "shift-chain flag must turn on after appending milestones")

	air_system.call("_remove_last_pending_milestone")
	_assert_eq(air_system.get("_pending_milestones"), ["wp-1"], "remove_last must drop the most recent milestone")
	_assert_eq(air_system.get("_pending_chain"), ["wp-1"], "pending chain must shrink with milestones")

	air_system.call("_clear_pending")
	_assert_eq(air_system.get("_pending_milestones"), [], "clear must empty milestones")
	_assert_eq(air_system.get("_pending_chain"), [], "clear must empty pending chain")
	_assert_true(not air_system.get("_shift_chain_started"), "clear must reset shift-chain flag")

	air_system.call("cleanup")
	air_system.free()
	air_layer.free()
	map_loader.free()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_air_wing_preview_state: all tests passed")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
