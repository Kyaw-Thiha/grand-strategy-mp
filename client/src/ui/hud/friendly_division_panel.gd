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
var _btn_cancel: Button

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
	_btn_cancel = get_node_or_null("Margin/HBox/ActionsBlock/Row2/BtnCancel")


func populate(div_id: String, data: Dictionary) -> void:
	if _div_name == null:
		push_warning("FriendlyDivisionPanel: node refs not found — tscn may be broken")
		return

	_current_div_id = div_id
	_div_name.text = div_id

	var div_type: String = data.get("division_type", "infantry")
	if _div_template != null:
		_div_template.text = "TEMPLATE · %s" % div_type.to_upper()

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

	_rewire_buttons(div_id)


func _rewire_buttons(div_id: String) -> void:
	if _btn_move == null or _btn_cancel == null:
		return

	if _btn_move.pressed.get_connections().size() > 0:
		for conn: Dictionary in _btn_move.pressed.get_connections():
			_btn_move.pressed.disconnect(conn["callable"])
	if _btn_cancel.pressed.get_connections().size() > 0:
		for conn: Dictionary in _btn_cancel.pressed.get_connections():
			_btn_cancel.pressed.disconnect(conn["callable"])

	_btn_move.pressed.connect(func() -> void:
		EventBus.move_mode_requested.emit(div_id)
	)
	_btn_cancel.pressed.connect(func() -> void:
		EventBus.division_deselected.emit()
	)

	if _btn_hold != null:
		_btn_hold.disabled = true