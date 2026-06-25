extends Node
## Verifies the inspector-authored research tree scene registers its static cards.

const RESEARCH_TREE_SCENE := preload("res://scenes/systems/research/research_tree.tscn")


func _ready() -> void:
	var research_tree: Control = RESEARCH_TREE_SCENE.instantiate()
	add_child(research_tree)
	await get_tree().process_frame

	var first_card: Node = research_tree.find_child("InfantryBasicTraining", true, false)
	_assert_true(first_card != null, "static infantry card should exist in scene")

	var first_status: Label = first_card.get_node("Margin/Layout/StatusLabel")
	_assert_equal(first_status.text, "Available", "row 0 card should be available at runtime")

	var locked_card: Node = research_tree.find_child("InfantrySupportWeapons", true, false)
	var locked_status: Label = locked_card.get_node("Margin/Layout/StatusLabel")
	_assert_equal(locked_status.text, "Locked", "row 1 card should remain locked before row 0 completion")

	print("ResearchTree scene test passed.")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	push_error("ASSERT TRUE FAILED: " + message)
	get_tree().quit(1)


func _assert_equal(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	push_error("ASSERT EQUAL FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
	get_tree().quit(1)
