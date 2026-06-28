extends PanelContainer
## Military panel — side-docked, with Land/Air/Naval sub-tabs.
## Land tab lists division templates from DivisionTemplateStore.
## Air and Naval tabs are placeholders for Phase 12/13.
##
## NOTE: The original active-division list code is DISABLED below.
## Search for "DISABLED" to find it. Re-enable when the active-division list is restored.

signal close_requested()
# DISABLED: restore alongside the active-division list
# signal division_clicked(division_id: String)

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_inject_land_header()
	_refresh_template_list()
	DivisionTemplateStore.templates_changed.connect(func() -> void: _refresh_template_list())

	# DISABLED: re-enable when active-division list is restored
	# EventBus.division_added.connect(func(_id: String) -> void: _refresh_land_list())
	# EventBus.division_updated.connect(func(_id: String) -> void: _refresh_land_list())
	# EventBus.division_removed.connect(func(_id: String) -> void: _refresh_land_list())


func _setup_tab_buttons() -> void:
	var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tc == null or tab_btns == null:
		return
	var btn_group := ButtonGroup.new()
	for i: int in range(tab_btns.get_child_count()):
		var btn: Button = tab_btns.get_child(i) as Button
		btn.button_group = btn_group
		btn.pressed.connect(_on_tab_button_pressed.bind(i))
	tc.tab_changed.connect(_sync_tab_button)


func _on_tab_button_pressed(idx: int) -> void:
	var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	if tc != None:
		tc.current_tab = idx


func _sync_tab_button(idx: int) -> void:
	var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tab_btns == null or idx >= tab_btns.get_child_count():
		return
	(tab_btns.get_child(idx) as Button).button_pressed = true


func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null(_CONTENT_PATH + "/TabBar")
	if tabs_node == null or not tabs_node is TabContainer:
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	tabs.current_tab = posmod(tabs.current_tab + (1 if forward else -1), count)


# ── Land header injection ─────────────────────────────────────────────────

func _inject_land_header() -> void:
	var title_lbl: Label = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Header/HBox/Title") as Label
	if title_lbl != null:
		title_lbl.text = "DIVISION TEMPLATES"

	var hbox: HBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Header/HBox") as HBoxContainer
	if hbox == null:
		return
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(spacer)
	var add_btn := Button.new()
	add_btn.text = "+"
	add_btn.custom_minimum_size = Vector2(28, 28)
	add_btn.tooltip_text = "Add new division template"
	add_btn.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit("")
	)
	hbox.add_child(add_btn)


# ── Template list ─────────────────────────────────────────────────────────

func _refresh_template_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer") as VBoxContainer
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	for template: Dictionary in DivisionTemplateStore.get_templates():
		var item: Control = _make_template_item(template)
		list_container.add_child(item)


func _make_template_item(template: Dictionary) -> Control:
	var template_id: String = template.get("id", "")
	var name_str: String   = template.get("name", "Unknown")
	var cells: Array       = template.get("cells", [])

	var container := PanelContainer.new()
	container.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 2)
	container.add_child(vbox)

	var name_lbl := Label.new()
	name_lbl.text = name_str
	name_lbl.add_theme_font_size_override("font_size", 13)
	vbox.add_child(name_lbl)

	var type_lbl := Label.new()
	type_lbl.text = _derive_division_type(cells)
	type_lbl.add_theme_font_size_override("font_size", 11)
	type_lbl.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	vbox.add_child(type_lbl)

	var edit_row := HBoxContainer.new()
	var edit_spacer := Control.new()
	edit_spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	edit_row.add_child(edit_spacer)
	var edit_btn := Button.new()
	edit_btn.text = "Edit"
	edit_btn.custom_minimum_size = Vector2(48, 24)
	edit_btn.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit(template_id)
	)
	edit_row.add_child(edit_btn)
	vbox.add_child(edit_row)

	return container


static func _derive_division_type(cells: Array) -> String:
	const ARMOR_TYPES := ["light_tank", "medium_tank", "heavy_tank",
		"armoured_car", "at_gun_sp", "self_propelled_gun"]
	const ARTY_TYPES  := ["artillery", "howitzer", "at_gun", "aa_gun"]
	var armor := 0
	var arty  := 0
	var inf   := 0
	var total := 0
	for unit_type: String in cells:
		if unit_type == "":
			continue
		total += 1
		if unit_type in ARMOR_TYPES:
			armor += 1
		elif unit_type in ARTY_TYPES:
			arty += 1
		else:
			inf += 1
	if total == 0:
		return "Empty"
	if armor >= 3:
		return "Armoured Assault"
	if armor >= 2 and inf >= 2:
		return "Combined-Arms"
	if arty >= 2 and inf >= 3:
		return "Supported Infantry"
	if inf >= 5:
		return "Infantry Division"
	return "Mixed"


# ── DISABLED: original active-division list ───────────────────────────────
# Re-enable this block and remove template list above when restoring
# the active-division list feature.
#
# var _division_items: Array[Dictionary] = []
#
# func _refresh_land_list() -> void:
# 	var list_container: VBoxContainer = get_node_or_null(
# 		_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer")
# 	if list_container == null:
# 		return
# 	for child: Node in list_container.get_children():
# 		list_container.remove_child(child)
# 		child.queue_free()
# 	var div_ids: Array = GameState.get_my_nation_divisions()
# 	var stacks_map: Dictionary = {}
# 	var solo: Array = []
# 	for div_id: String in div_ids:
# 		var div_data: Dictionary = GameState.get_division(div_id)
# 		if div_data.is_empty():
# 			continue
# 		if div_data.get("combat_state", "") == "destroyed":
# 			continue
# 		var sid: String = div_data.get("stack_id", "")
# 		if sid.is_empty():
# 			solo.append({ "id": div_id, "data": div_data })
# 		else:
# 			if not stacks_map.has(sid):
# 				stacks_map[sid] = []
# 			stacks_map[sid].append({ "id": div_id, "data": div_data })
# 	for sid: String in stacks_map:
# 		var members: Array = stacks_map[sid]
# 		members.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
# 			return int(a.data.get("stack_position", 0)) < int(b.data.get("stack_position", 0))
# 		)
# 		var group_lbl: Label = Label.new()
# 		group_lbl.text = "Stack (%d)" % members.size()
# 		group_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
# 		group_lbl.add_theme_font_size_override("font_size", 11)
# 		list_container.add_child(group_lbl)
# 		for member: Dictionary in members:
# 			var item: Button = _make_division_item(member.id, member.data)
# 			list_container.add_child(item)
# 	for entry: Dictionary in solo:
# 		var item: Button = _make_division_item(entry.id, entry.data)
# 		list_container.add_child(item)
#
# func _make_division_item(div_id: String, div_data: Dictionary) -> Button:
# 	var btn: Button = Button.new()
# 	btn.custom_minimum_size.y = 48
# 	btn.layout_mode = 2
# 	btn.size_flags_horizontal = 3
# 	btn.size_flags_vertical = 3
# 	var div_type: String = div_data.get("division_type", "infantry")
# 	var hp: float = float(div_data.get("hp", 100.0))
# 	var max_hp: float = float(div_data.get("max_hp", 100.0))
# 	var hp_pct: float = hp / max_hp if max_hp > 0 else 1.0
# 	var label_text: String = "%s [%s]\nHP: %.0f%%" % [div_id, div_type.capitalize(), hp_pct * 100.0]
# 	var lbl: Label = Label.new()
# 	lbl.text = label_text
# 	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
# 	lbl.layout_mode = 2
# 	lbl.size_flags_vertical = 3
# 	btn.add_child(lbl)
# 	btn.pressed.connect(func() -> void:
# 		division_clicked.emit(div_id)
# 		EventBus.division_selected.emit(div_id)
# 	)
# 	return btn
