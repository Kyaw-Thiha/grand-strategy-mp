extends PanelContainer
## Propose Trade Route — FULL_CENTER modal, opened from Diplomacy → Trade Routes.
## Partner eligibility is derived client-side from data the client already has (province
## ownership from GameState, adjacency + has_port from MapLoader's static map data) — the
## server independently re-derives and enforces the same eligibility, so this is a UX
## convenience, not a security boundary. Per this phase's scope cut, third-party transit
## routing (Phase 10 not yet built) is simply omitted: a non-bordering, non-naval nation does
## not appear in the list at all, rather than shown-but-disabled.

signal close_requested()

const TRADEABLE_RESOURCES := ["money", "grain", "iron", "oil", "rubber", "nitrates",
	"tungsten", "chromium", "aluminium", "uranium"]

var _nation_definitions: Array[Dictionary] = []
var _nation_by_id: Dictionary = {}
var _map_id: String = "western_europe_6"

var _partner_list: VBoxContainer
var _selected_partner_id: String = ""
var _selected_kind: String = "land"
var _send_resource_option: OptionButton
var _send_qty_spin: SpinBox
var _receive_resource_option: OptionButton
var _receive_qty_spin: SpinBox
var _empty_label: Label
var _form_box: VBoxContainer


func _ready() -> void:
	_load_nation_definitions()

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 14)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_bottom", 14)
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.custom_minimum_size = Vector2(420, 0)
	vbox.add_theme_constant_override("separation", 10)
	margin.add_child(vbox)

	var header := HBoxContainer.new()
	vbox.add_child(header)
	var title := Label.new()
	title.text = "PROPOSE TRADE ROUTE"
	title.size_flags_horizontal = 3
	title.add_theme_font_size_override("font_size", 16)
	header.add_child(title)
	var close_btn := Button.new()
	close_btn.text = "X"
	close_btn.custom_minimum_size = Vector2(28, 28)
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	header.add_child(close_btn)

	var partner_label := Label.new()
	partner_label.text = "PARTNER NATION"
	vbox.add_child(partner_label)

	_partner_list = VBoxContainer.new()
	vbox.add_child(_partner_list)

	_empty_label = Label.new()
	_empty_label.text = "No eligible partners — not at peace with, bordering, or sea-connected to any nation."
	_empty_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	_empty_label.visible = false
	vbox.add_child(_empty_label)

	_form_box = VBoxContainer.new()
	vbox.add_child(_form_box)

	var send_row := HBoxContainer.new()
	_form_box.add_child(send_row)
	var send_label := Label.new()
	send_label.text = "You send: "
	send_row.add_child(send_label)
	_send_resource_option = _make_resource_option()
	send_row.add_child(_send_resource_option)
	_send_qty_spin = _make_qty_spin()
	send_row.add_child(_send_qty_spin)

	var receive_row := HBoxContainer.new()
	_form_box.add_child(receive_row)
	var receive_label := Label.new()
	receive_label.text = "You receive: "
	receive_row.add_child(receive_label)
	_receive_resource_option = _make_resource_option()
	_receive_resource_option.select(1)
	receive_row.add_child(_receive_resource_option)
	_receive_qty_spin = _make_qty_spin()
	receive_row.add_child(_receive_qty_spin)

	var send_btn := Button.new()
	send_btn.text = "Send Proposal"
	send_btn.pressed.connect(_on_send_proposal_pressed)
	_form_box.add_child(send_btn)


func _make_resource_option() -> OptionButton:
	var opt := OptionButton.new()
	opt.custom_minimum_size = Vector2(100, 0)
	for i in range(TRADEABLE_RESOURCES.size()):
		opt.add_item(TRADEABLE_RESOURCES[i].capitalize(), i)
		opt.set_item_metadata(i, TRADEABLE_RESOURCES[i])
	return opt


func _make_qty_spin() -> SpinBox:
	var spin := SpinBox.new()
	spin.min_value = 1
	spin.max_value = 100000
	spin.value = 10
	spin.custom_minimum_size = Vector2(70, 0)
	return spin


func open_propose_modal() -> void:
	_rebuild_partner_list()


func _rebuild_partner_list() -> void:
	for child in _partner_list.get_children():
		child.queue_free()
	_selected_partner_id = ""

	var my_nation_id: String = GameState.get_my_nation_id()
	var eligible: Array[Dictionary] = []
	for definition: Dictionary in _nation_definitions:
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty() or nation_id == my_nation_id:
			continue
		if _get_stance(my_nation_id, nation_id) == "war":
			continue
		var land: bool = _nations_share_border(my_nation_id, nation_id)
		var naval: bool = _nations_share_naval_access(my_nation_id, nation_id)
		if not land and not naval:
			continue
		eligible.append({"id": nation_id, "land": land, "naval": naval})

	_empty_label.visible = eligible.is_empty()
	_form_box.visible = not eligible.is_empty()
	if eligible.is_empty():
		return

	var btn_group := ButtonGroup.new()
	for entry: Dictionary in eligible:
		var nation_id: String = entry["id"]
		var reason: String = "Direct border" if entry["land"] else "Naval access"
		var row := HBoxContainer.new()
		var radio := CheckBox.new()
		radio.text = _get_nation_name(nation_id)
		radio.button_group = btn_group
		radio.toggled.connect(func(pressed: bool) -> void:
			if pressed:
				_selected_partner_id = nation_id
				_selected_kind = "land" if entry["land"] else "port"
		)
		row.add_child(radio)
		var reason_label := Label.new()
		reason_label.text = reason
		reason_label.add_theme_font_size_override("font_size", 11)
		row.add_child(reason_label)
		_partner_list.add_child(row)

	# Default-select the first eligible partner so the form is immediately usable.
	var first_radio := _partner_list.get_child(0).get_child(0) as CheckBox
	if first_radio != null:
		first_radio.button_pressed = true


func _on_send_proposal_pressed() -> void:
	if _selected_partner_id.is_empty():
		return
	var send_res: String = str(_send_resource_option.get_item_metadata(_send_resource_option.selected))
	var receive_res: String = str(_receive_resource_option.get_item_metadata(_receive_resource_option.selected))
	if send_res == receive_res:
		return  # trading a resource for itself is nonsensical — blocked client-side, per design note
	CommandQueue.submit("PROPOSE_TRADE_ROUTE", {
		"partner_nation_id": _selected_partner_id,
		"kind": _selected_kind,
		"a_sends_resource": send_res,
		"a_sends_rate": int(_send_qty_spin.value),
		"b_sends_resource": receive_res,
		"b_sends_rate": int(_receive_qty_spin.value),
	})
	close_requested.emit()


func _nations_share_border(nation_a: String, nation_b: String) -> bool:
	var map_loader: Node = _get_map_loader()
	if map_loader == null or not map_loader.has_method("get_adjacency"):
		return false
	var owned_a: Array = _owned_provinces(nation_a)
	var owned_b_set: Dictionary = {}
	for pid: String in _owned_provinces(nation_b):
		owned_b_set[pid] = true
	for edge: Dictionary in map_loader.get_adjacency():
		var from_p: String = edge.get("from_province", "")
		var to_p: String = edge.get("to_province", "")
		if (owned_a.has(from_p) and owned_b_set.has(to_p)) or (owned_a.has(to_p) and owned_b_set.has(from_p)):
			return true
	return false


func _nations_share_naval_access(nation_a: String, nation_b: String) -> bool:
	return _nation_has_port(nation_a) and _nation_has_port(nation_b)


func _nation_has_port(nation_id: String) -> bool:
	var map_loader: Node = _get_map_loader()
	if map_loader == null or not map_loader.has_method("get_province_data"):
		return false
	for pid: String in _owned_provinces(nation_id):
		var pd: Dictionary = map_loader.get_province_data(pid)
		if bool(pd.get("has_port", false)):
			return true
	return false


func _owned_provinces(nation_id: String) -> Array:
	var result: Array = []
	for pid: String in GameState.provinces:
		if GameState.provinces[pid].get("owner_id", "") == nation_id:
			result.append(pid)
	return result


func _get_stance(from_id: String, to_id: String) -> String:
	if from_id == to_id:
		return "alliance"
	var relation: Dictionary = GameState.get_relation(from_id, to_id)
	return str(relation.get("stance", "neutral"))


func _get_map_loader() -> Node:
	var main_loop: MainLoop = Engine.get_main_loop()
	if main_loop == null:
		return null
	return main_loop.root.find_child("MapLoader", true, false)


func _load_nation_definitions() -> void:
	_nation_definitions.clear()
	_nation_by_id.clear()
	var path: String = "res://assets/data/%s/nations.json" % _map_id
	if not FileAccess.file_exists(path):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		return
	for raw_definition: Variant in (parsed as Array):
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty():
			continue
		_nation_definitions.append(definition)
		_nation_by_id[nation_id] = definition


func _get_nation_name(nation_id: String) -> String:
	var definition: Dictionary = _nation_by_id.get(nation_id, {})
	return definition.get("name", nation_id)
