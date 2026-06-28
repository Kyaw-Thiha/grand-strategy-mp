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

var _comp_grid: GridContainer
var _comp_cells: Array = []

const UNIT_CLASS_COLOR: Dictionary = {
	"infantry": Color(0.42, 0.49, 0.18, 1.0),
	"assault_infantry": Color(0.42, 0.49, 0.18, 1.0),
	"mg": Color(0.42, 0.49, 0.18, 1.0),
	"commando": Color(0.42, 0.49, 0.18, 1.0),
	"flamethrower": Color(0.42, 0.49, 0.18, 1.0),
	"at_infantry": Color(0.42, 0.49, 0.18, 1.0),
	"sniper": Color(0.42, 0.49, 0.18, 1.0),
	"light_tank": Color(0.29, 0.43, 0.65, 1.0),
	"medium_tank": Color(0.29, 0.43, 0.65, 1.0),
	"heavy_tank": Color(0.29, 0.43, 0.65, 1.0),
	"armoured_car": Color(0.29, 0.43, 0.65, 1.0),
	"at_gun_sp": Color(0.29, 0.43, 0.65, 1.0),
	"self_propelled_gun": Color(0.29, 0.43, 0.65, 1.0),
	"artillery": Color(0.55, 0.19, 0.19, 1.0),
	"howitzer": Color(0.55, 0.19, 0.19, 1.0),
	"at_gun": Color(0.55, 0.19, 0.19, 1.0),
	"aa_gun": Color(0.55, 0.19, 0.19, 1.0),
	"recon_infantry": Color(0.10, 0.55, 0.50, 1.0),
	"cavalry": Color(0.10, 0.55, 0.50, 1.0),
	"force_recon_sniper": Color(0.10, 0.55, 0.50, 1.0),
}
const UNIT_CLASS_EMPTY_COLOR := Color(0.10, 0.08, 0.07, 1.0)


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
	_comp_grid = get_node_or_null("Margin/HBox/CompBlock/CompGrid") as GridContainer
	_build_comp_cells()
	if _comp_grid != null:
		_comp_grid.gui_input.connect(_on_comp_grid_input)
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

	_refresh_comp_grid(data)


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


func _build_comp_cells() -> void:
	if _comp_grid == null:
		return
	_comp_cells.clear()
	for i: int in range(25):
		var rect := ColorRect.new()
		rect.custom_minimum_size = Vector2(8, 8)
		rect.color = UNIT_CLASS_EMPTY_COLOR
		_comp_grid.add_child(rect)
		_comp_cells.append(rect)


func _refresh_comp_grid(data: Dictionary) -> void:
	if _comp_cells.is_empty():
		return
	var template_id: String = data.get("template_id", "")
	var cells: Array = []
	if template_id != "":
		var template: Dictionary = DivisionTemplateStore.get_template(template_id)
		cells = template.get("cells", [])
	for i: int in range(25):
		var rect: ColorRect = _comp_cells[i] as ColorRect
		var unit_type: String = cells[i] if i < cells.size() else ""
		rect.color = UNIT_CLASS_COLOR.get(unit_type, UNIT_CLASS_EMPTY_COLOR)


func _on_comp_grid_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
		EventBus.division_template_viewer_open_requested.emit(_current_div_id)
