extends Node
## Tests for TacticalCombatPanel lifecycle and theme.

var _panel: Control = null
var _failed: bool = false

func _ready() -> void:
	_panel = preload("res://scenes/game/panels/tactical_combat_panel.tscn").instantiate()
	add_child(_panel)

	_assert_true(_panel.has_method("setup_engagement"), "must have setup_engagement()")
	_assert_false(_panel.visible, "panel must start hidden")

	var style = _panel.get_theme_stylebox("panel")
	if style is StyleBoxFlat:
		_assert_true(style.bg_color.r > 0.85, "red > 0.85 (cream, not dark)")
		_assert_true(style.bg_color.g > 0.80, "green > 0.80 (cream, not dark)")
		_assert_true(style.bg_color.b > 0.75, "blue > 0.75 (cream, not dark)")
	else:
		_failed = true
		push_error("FAILED: panel must have StyleBoxFlat with cream bg applied in _ready()")

	_assert_not_null(_panel.get_node_or_null("PanelContent/GridRow/AttackerGrid"),
		"AttackerGrid must exist")
	_assert_not_null(_panel.get_node_or_null("PanelContent/GridRow/DefenderGrid"),
		"DefenderGrid must exist")

	EventBus.tactical_combat_opened.emit("div-a_vs_div-b")
	await get_tree().process_frame
	_assert_true(_panel.visible, "panel shows on tactical_combat_opened")

	EventBus.tactical_combat_closed.emit()
	await get_tree().process_frame
	_assert_false(_panel.visible, "panel hides on tactical_combat_closed")

	var grid = _panel.get_node_or_null("PanelContent/GridRow/AttackerGrid")
	if grid != null:
		_assert_eq(grid.get_child_count(), 25, "AttackerGrid must have 25 GridCell children")

	if _failed:
		push_error("TacticalCombatPanel test FAILED")
		get_tree().quit(1)
		return
	print("TacticalCombatPanel test passed.")
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

func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])

func _assert_not_null(value: Variant, message: String) -> void:
	if value != null:
		return
	_failed = true
	push_error("ASSERT NOT NULL FAILED: " + message)
