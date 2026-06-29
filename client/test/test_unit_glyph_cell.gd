extends Node
## Tests for UnitGlyphCell incapacitated property and rendering.

var _cell: Control = null
var _failed: bool = false

func _ready() -> void:
	_cell = preload("res://scenes/game/panels/unit_glyph_cell.tscn").instantiate()
	add_child(_cell)

	# Default state: not incapacitated, unit_type empty
	_assert_eq(_cell.get("unit_type"), "", "unit_type starts empty")
	_assert_eq(_cell.get("incapacitated"), false, "incapacitated starts false")

	# Set unit_type to infantry
	_cell.set("unit_type", "infantry")
	_assert_eq(_cell.get("unit_type"), "infantry", "unit_type set correctly")

	# Set incapacitated
	_cell.set("incapacitated", true)
	_assert_eq(_cell.get("incapacitated"), true, "incapacitated set to true")

	# Toggle back
	_cell.set("incapacitated", false)
	_assert_eq(_cell.get("incapacitated"), false, "incapacitated set to false")

	if _failed:
		push_error("UnitGlyphCell test FAILED")
		get_tree().quit(1)
		return
	print("UnitGlyphCell test passed.")
	get_tree().quit(0)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
