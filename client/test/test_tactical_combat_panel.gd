extends Node
## Tests for TacticalCombatPanel lifecycle and grid cell management.

var _panel: Control = null
var _panel_bg: PanelContainer = null
var _failed: bool = false

func _ready() -> void:
	_panel = preload("res://scenes/game/panels/tactical_combat_panel.tscn").instantiate()
	add_child(_panel)
	_panel_bg = _panel.get_node("OuterMargin/Panel") as PanelContainer

	_assert_true(_panel_bg.has_method("setup_engagement"), "must have setup_engagement()")
	_assert_false(_panel.visible, "panel must start hidden")

	_assert_not_null(_panel.get_node_or_null("OuterMargin/Panel/InnerMargin/VBoxContent/GridRow/AttackerGridArea/AttackerGridBody/AttackerGrid"),
		"AttackerGrid must exist")
	_assert_not_null(_panel.get_node_or_null("OuterMargin/Panel/InnerMargin/VBoxContent/GridRow/DefenderGridArea/DefenderGridBody/DefenderGrid"),
		"DefenderGrid must exist")

	var atk_grid = _panel.get_node("OuterMargin/Panel/InnerMargin/VBoxContent/GridRow/AttackerGridArea/AttackerGridBody/AttackerGrid")
	if atk_grid != null:
		_assert_eq(atk_grid.get_child_count(), 25, "AttackerGrid must have 25 cells")

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
