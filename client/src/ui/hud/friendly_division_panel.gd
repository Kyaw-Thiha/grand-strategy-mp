extends PanelContainer
## Bottom selection bar panel — shows HP/suppression/action buttons for own divisions.

var _nation_color: ColorRect
var _div_name: Label
var _div_template: Label
var _hp_label: Label
var _hp_pct: Label
var _hp_bar: ProgressBar
var _supp_label: Label
var _supp_pct: Label
var _supp_bar: ProgressBar
var _btn_move: Button
var _btn_hold: Button
var _btn_retreat: Button
var _btn_cancel: Button
var _btn_reposition: Button
var _combat_state_label: Label

var _current_div_id: String = ""


func _ready() -> void:
	_nation_color = get_node_or_null("Margin/HBox/IdentityBlock/NameRow/NationColor")
	_div_name = get_node_or_null("Margin/HBox/IdentityBlock/NameRow/DivName")
	_div_template = get_node_or_null("Margin/HBox/IdentityBlock/DivTemplate")
	_hp_label = get_node_or_null("Margin/HBox/BarsBlock/HpGroup/HpRow/HpLabel")
	_hp_pct = get_node_or_null("Margin/HBox/BarsBlock/HpGroup/HpRow/HpPct")
	_hp_bar = get_node_or_null("Margin/HBox/BarsBlock/HpGroup/HpBar")
	_supp_label = get_node_or_null("Margin/HBox/BarsBlock/SuppGroup/SuppRow/SuppLabel")
	_supp_pct = get_node_or_null("Margin/HBox/BarsBlock/SuppGroup/SuppRow/SuppPct")
	_supp_bar = get_node_or_null("Margin/HBox/BarsBlock/SuppGroup/SuppBar")
	_btn_move = get_node_or_null("Margin/HBox/ActionsBlock/Row1/BtnMove")
	_btn_hold = get_node_or_null("Margin/HBox/ActionsBlock/Row1/BtnHold")
	_btn_retreat = get_node_or_null("Margin/HBox/ActionsBlock/Row2/BtnRetreat")
	_btn_cancel = get_node_or_null("Margin/HBox/ActionsBlock/Row2/BtnCancel")
	_btn_reposition = get_node_or_null("Margin/HBox/ActionsBlock/Row3/BtnReposition")
	_combat_state_label = get_node_or_null("Margin/HBox/IdentityBlock/CombatStateLabel")
	EventBus.division_updated.connect(_on_division_updated)
	EventBus.division_deselected.connect(func() -> void: _current_div_id = "")


func populate(div_id: String, data: Dictionary) -> void:
	if _div_name == null:
		push_warning("FriendlyDivisionPanel: node refs not found — tscn may be broken")
		return

	_current_div_id = div_id
	_div_name.text = div_id

	var div_type: String = data.get("division_type", "infantry")
	if _div_template != null:
		_div_template.text = "TEMPLATE · %s" % div_type.to_upper()

	_refresh_stats(data)

	# Show Retreat button only when the division is actively in combat
	var combat_state: String = data.get("combat_state", "idle")
	var in_combat: bool = combat_state in ["engaged", "suppressed"]
	if _btn_retreat != null:
		_btn_retreat.visible = in_combat
	if _btn_reposition != null:
		_btn_reposition.visible = in_combat

	_rewire_buttons(div_id)


func _refresh_stats(data: Dictionary) -> void:
	var hp: float = float(data.get("hp", 100.0))
	var max_hp: float = float(data.get("max_hp", 100.0))
	var hp_pct_val: float = hp / max_hp if max_hp > 0.0 else 1.0
	if _hp_pct != null:
		_hp_pct.text = "%.0f%%" % (hp_pct_val * 100.0)
	if _hp_bar != null:
		_hp_bar.value = hp_pct_val

	var supp: float = float(data.get("suppression", 0.0))
	if _supp_pct != null:
		_supp_pct.text = "%.0f%%" % supp
	if _supp_bar != null:
		_supp_bar.value = supp / 100.0

	var combat_state: String = data.get("combat_state", "idle")
	if _combat_state_label != null:
		_combat_state_label.text = "STATE · %s" % combat_state.to_upper()
	if _btn_retreat != null:
		_btn_retreat.visible = combat_state in ["engaged", "suppressed"]
	if _btn_reposition != null:
		_btn_reposition.visible = combat_state in ["engaged", "suppressed"]


func _on_division_updated(div_id: String) -> void:
	if div_id != _current_div_id:
		return
	var data: Dictionary = GameState.get_division(div_id)
	if data.is_empty():
		return
	_refresh_stats(data)


func _rewire_buttons(div_id: String) -> void:
	if _btn_move == null or _btn_cancel == null:
		return

	# Disconnect all previously connected handlers before re-wiring
	for btn: Button in [_btn_move, _btn_hold, _btn_retreat, _btn_cancel, _btn_reposition]:
		if btn == null:
			continue
		if btn.pressed.get_connections().size() > 0:
			for conn: Dictionary in btn.pressed.get_connections():
				btn.pressed.disconnect(conn["callable"])

	_btn_move.pressed.connect(func() -> void:
		EventBus.move_mode_requested.emit(div_id)
	)

	if _btn_hold != null:
		_btn_hold.disabled = false
		_btn_hold.pressed.connect(func() -> void:
			CommandQueue.submit("HOLD", { "division_id": div_id })
		)

	if _btn_retreat != null:
		_btn_retreat.pressed.connect(func() -> void:
			CommandQueue.submit("RETREAT", { "division_id": div_id })
		)

	if _btn_reposition != null:
		_btn_reposition.pressed.connect(func() -> void:
			EventBus.reposition_mode_requested.emit(div_id)
		)

	_btn_cancel.pressed.connect(func() -> void:
		EventBus.division_deselected.emit()
	)
