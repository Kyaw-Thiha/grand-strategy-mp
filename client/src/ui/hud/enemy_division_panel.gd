extends PanelContainer
## Bottom selection bar panel — shows intel on enemy divisions.

var _enemy_nation_color: ColorRect
var _enemy_name: Label
var _enemy_nation: Label
var _intel_tier: Label
var _comp_hint: Label
var _composition_table: GridContainer


func _ready() -> void:
	_enemy_nation_color = get_node_or_null("Margin/HBox/IdentityBlock/NameRow/EnemyNationColor")
	_enemy_name = get_node_or_null("Margin/HBox/IdentityBlock/NameRow/EnemyName")
	_enemy_nation = get_node_or_null("Margin/HBox/IdentityBlock/EnemyNation")
	_intel_tier = get_node_or_null("Margin/HBox/IntelBlock/IntelBadge/IntelTier")
	_comp_hint = get_node_or_null("Margin/HBox/IntelBlock/CompositionBlock/CompHint")
	_composition_table = get_node_or_null("Margin/HBox/IntelBlock/CompositionBlock/CompositionTable")


func populate(div_id: String, data: Dictionary) -> void:
	if _enemy_name == null:
		push_warning("EnemyDivisionPanel: node refs not found — tscn may be broken")
		return

	_enemy_name.text = "Unknown formation"
	var nation_id: String = data.get("nation_id", "UNKNOWN")
	if _enemy_nation != null:
		_enemy_nation.text = nation_id.to_upper()

	if _intel_tier != null:
		_intel_tier.text = "INTEL · SCOUT\nTIER 1"

	if _composition_table != null:
		for child: Node in _composition_table.get_children():
			_composition_table.remove_child(child)
			child.queue_free()

		var entries: Array = [["Infantry", "~?"], ["Armor", "~?"], ["Artillery", "?"]]
		for entry: Array in entries:
			var type_lbl: Label = Label.new()
			type_lbl.text = entry[0]
			type_lbl.add_theme_font_size_override("font_size", 11)
			var val_lbl: Label = Label.new()
			val_lbl.text = entry[1]
			val_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			_composition_table.add_child(type_lbl)
			_composition_table.add_child(val_lbl)
