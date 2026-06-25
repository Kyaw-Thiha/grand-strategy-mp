extends Node
## Regression test for the local research tree prototype.

const ResearchSystemScript: GDScript = preload("res://src/systems/research/research_system.gd")

var _research_system: Variant = null
var _completed_entry_id: String = ""
var _completed_effects: Dictionary = {}


func _ready() -> void:
	_research_system = ResearchSystemScript.new()
	add_child(_research_system)
	EventBus.research_completed.connect(_on_research_completed)

	var loaded: bool = _research_system.load_from_definitions(_get_test_definitions())
	_assert_true(loaded, "definitions should load")

	_assert_true(_research_system.is_available("infantry_1"), "row 0 should be available")
	_assert_false(_research_system.is_available("tank_2"), "row 1 should be locked initially")

	_assert_true(_research_system.start_research("infantry_1"), "first research should start")
	_research_system.advance(0.5)
	_assert_near(_research_system.get_progress_ratio("infantry_1"), 0.5, "first progress should advance")

	_assert_true(_research_system.start_research("tank_1"), "second available research should switch active")
	_assert_near(_research_system.get_progress_ratio("infantry_1"), 0.5, "first progress should pause")
	_research_system.advance(1.0)
	_assert_true(_research_system.is_researched("tank_1"), "second research should complete")
	_assert_equal(_completed_entry_id, "tank_1", "completion signal should include completed id")

	_assert_true(_research_system.is_available("infantry_2"), "row 1 should unlock after any row 0 completion")
	_assert_true(_research_system.is_available("tank_2"), "row 1 should unlock across columns")

	_assert_true(_research_system.start_research("exclusive_a"), "exclusive entry should start")
	_assert_true(_research_system.start_research("tank_2"), "non-conflicting entry can still switch active")
	_assert_false(_research_system.start_research("exclusive_b"), "conflicting exclusive entry should be blocked")

	print("ResearchSystem test passed.")
	get_tree().quit(0)


## Builds a compact tree covering row unlocks, progress switching, and exclusivity.
## Parameters: none.
## Returns: test research definitions.
func _get_test_definitions() -> Array[Dictionary]:
	return [
		{
			"id": "infantry_1",
			"column": "Infantry",
			"row": 0,
			"title": "Infantry 1",
			"description": "First infantry node.",
			"science_value": 1,
			"effects": { "node": "infantry_1" },
		},
		{
			"id": "tank_1",
			"column": "Tank",
			"row": 0,
			"title": "Tank 1",
			"description": "First tank node.",
			"science_value": 1,
			"effects": { "node": "tank_1" },
		},
		{
			"id": "infantry_2",
			"column": "Infantry",
			"row": 1,
			"title": "Infantry 2",
			"description": "Second infantry node.",
			"science_value": 1,
			"effects": { "node": "infantry_2" },
		},
		{
			"id": "tank_2",
			"column": "Tank",
			"row": 1,
			"title": "Tank 2",
			"description": "Second tank node.",
			"science_value": 1,
			"effects": { "node": "tank_2" },
		},
		{
			"id": "exclusive_a",
			"column": "Infantry",
			"row": 1,
			"title": "Exclusive A",
			"description": "First exclusive option.",
			"science_value": 2,
			"exclusive_group": "doctrine",
			"effects": { "node": "exclusive_a" },
		},
		{
			"id": "exclusive_b",
			"column": "Tank",
			"row": 1,
			"title": "Exclusive B",
			"description": "Second exclusive option.",
			"science_value": 2,
			"exclusive_group": "doctrine",
			"effects": { "node": "exclusive_b" },
		},
	]


func _on_research_completed(entry_id: String, effects: Dictionary) -> void:
	_completed_entry_id = entry_id
	_completed_effects = effects


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	push_error("ASSERT TRUE FAILED: " + message)
	get_tree().quit(1)


func _assert_false(value: bool, message: String) -> void:
	if not value:
		return
	push_error("ASSERT FALSE FAILED: " + message)
	get_tree().quit(1)


func _assert_equal(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	push_error("ASSERT EQUAL FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
	get_tree().quit(1)


func _assert_near(actual: float, expected: float, message: String) -> void:
	if absf(actual - expected) <= 0.001:
		return
	push_error("ASSERT NEAR FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
	get_tree().quit(1)
