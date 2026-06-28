class_name DivisionTemplateViewerPanel
extends PanelContainer

signal close_requested()

const _CELL_SCENE: PackedScene = preload("res://scenes/game/panels/unit_glyph_cell.tscn")

const ROW_NAMES: Array[String] = ["VANGUARD", "ASSAULT", "SUPPORT", "RESERVE", "REAR"]
const ROW_COLORS: Array = [
	Color(0.80, 0.15, 0.15, 1.0),
	Color(0.85, 0.45, 0.10, 1.0),
	Color(0.75, 0.65, 0.10, 1.0),
	Color(0.15, 0.60, 0.25, 1.0),
	Color(0.20, 0.40, 0.75, 1.0),
]
const ROW_PERK_HINTS: Array[String] = ["+supp dealt", "+HP damage", "+supp resist", "↑ supp decay", "—"]
const ARMOR_TYPES := ["light_tank","medium_tank","heavy_tank","armoured_car","at_gun_sp","self_propelled_gun"]
const ARTY_TYPES  := ["artillery","howitzer","at_gun","aa_gun"]

var _division_id: String = ""
var _current_template_id: String = ""
var _preview_template_id: String = ""
var _is_locked: bool = false
var _in_select_mode: bool = false

var _cells: Array = []
var _cell_nodes: Array = []

var _div_title_label: Label
var _view_container: VBoxContainer
var _select_container: VBoxContainer
var _template_name_label: Label
var _division_type_label: Label
var _engagement_radius_label: Label
var _movement_swatches: Array = []
var _fill_bars: Array = []
var _fill_labels: Array = []
var _fill_count_label: Label
var _template_list_container: VBoxContainer
var _confirm_btn: Button
var _confirm_label: Label
var _change_btn: Button
var _locked_notice: Label
var _no_template_label: Label

var _division_data: Dictionary = {}


func _ready() -> void:
	_cells.resize(25)
	_cells.fill("")
	_build_top_bar()
	_build_body()


func open_for_division(division_id: String) -> void:
	_division_id = division_id
	_division_data = GameState.get_division(division_id)
	_current_template_id = _division_data.get("template_id", "")
	_preview_template_id = _current_template_id
	var combat_state: String = _division_data.get("combat_state", "idle")
	_is_locked = combat_state in ["engaged", "retreating", "suppressed"]
	_in_select_mode = false
	_div_title_label.text = "DIVISION TEMPLATE   %s" % division_id
	_load_cells_from_template(_current_template_id)
	_refresh_grid()
	_show_view_state()


func _build_top_bar() -> void:
	var top_bar: HBoxContainer = %TopBar

	var accent := ColorRect.new()
	accent.custom_minimum_size = Vector2(3, 0)
	accent.color = Color(0.18, 0.62, 0.56, 1.0)
	accent.size_flags_vertical = 3
	top_bar.add_child(accent)

	_div_title_label = Label.new()
	_div_title_label.size_flags_horizontal = 3
	_div_title_label.theme_override_font_sizes/font_size = 16
	top_bar.add_child(_div_title_label)

	var close_btn := Button.new()
	close_btn.text = "[X]"
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	top_bar.add_child(close_btn)


func _build_body() -> void:
	var body: HBoxContainer = %Body

	var left_panel := PanelContainer.new()
	left_panel.size_flags_horizontal = 3
	left_panel.stretch_ratio = 0.6
	body.add_child(left_panel)

	var right_panel := PanelContainer.new()
	right_panel.size_flags_horizontal = 3
	right_panel.stretch_ratio = 0.4
	body.add_child(right_panel)

	_build_grid_panel(left_panel)
	_build_right_panel(right_panel)


func _build_grid_panel(parent_node: PanelContainer) -> void:
	var margin := MarginContainer.new()
	margin.theme_override_constants/margin_left = 8
	margin.theme_override_constants/margin_top = 8
	margin.theme_override_constants/margin_right = 8
	margin.theme_override_constants/margin_bottom = 8
	parent_node.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.theme_override_constants/separation = 6
	margin.add_child(vbox)

	var header_row := HBoxContainer.new()
	var header_label := Label.new()
	header_label.text = "TEMPLATE GRID · 5×5"
	header_label.theme_override_font_sizes/font_size = 12
	header_row.add_child(header_label)
	var header_spacer := Control.new()
	header_spacer.size_flags_horizontal = 3
	header_row.add_child(header_spacer)
	var header_dir := Label.new()
	header_dir.text = "front-to-back ↓"
	header_dir.theme_override_font_sizes/font_size = 10
	header_row.add_child(header_dir)
	vbox.add_child(header_row)

	var front_lbl := Label.new()
	front_lbl.text = "══════════ FRONT LINE ══════════"
	front_lbl.theme_override_font_sizes/font_size = 10
	front_lbl.horizontal_alignment = 1
	vbox.add_child(front_lbl)

	var grid_area := HBoxContainer.new()
	grid_area.size_flags_horizontal = 3
	grid_area.size_flags_vertical = 3
	vbox.add_child(grid_area)

	var row_label_col := VBoxContainer.new()
	row_label_col.size_flags_vertical = 3
	row_label_col.theme_override_constants/separation = 6
	grid_area.add_child(row_label_col)

	for r: int in range(5):
		var row_vbox := VBoxContainer.new()
		row_vbox.theme_override_constants/separation = 0
		var name_lbl := Label.new()
		name_lbl.text = ROW_NAMES[r]
		name_lbl.theme_override_font_sizes/font_size = 10
		name_lbl.modulate = ROW_COLORS[r]
		row_vbox.add_child(name_lbl)
		var hint_lbl := Label.new()
		hint_lbl.text = ROW_PERK_HINTS[r]
		hint_lbl.theme_override_font_sizes/font_size = 8
		hint_lbl.modulate = Color(0.6, 0.6, 0.6, 1.0)
		row_vbox.add_child(hint_lbl)
		row_label_col.add_child(row_vbox)

	var grid := GridContainer.new()
	grid.columns = 5
	grid.size_flags_horizontal = 3
	grid.size_flags_vertical = 3
	grid_area.add_child(grid)

	_cell_nodes.clear()
	for i: int in range(25):
		var cell: UnitGlyphCell = _CELL_SCENE.instantiate() as UnitGlyphCell
		cell.unit_type = _cells[i]
		grid.add_child(cell)
		_cell_nodes.append(cell)


func _build_right_panel(parent_node: PanelContainer) -> void:
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = 3
	scroll.size_flags_vertical = 3
	parent_node.add_child(scroll)

	var margin := MarginContainer.new()
	margin.theme_override_constants/margin_left = 8
	margin.theme_override_constants/margin_top = 8
	margin.theme_override_constants/margin_right = 8
	margin.theme_override_constants/margin_bottom = 8
	scroll.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.theme_override_constants/separation = 8
	margin.add_child(vbox)

	_view_container = VBoxContainer.new()
	_view_container.theme_override_constants/separation = 8
	vbox.add_child(_view_container)

	_select_container = VBoxContainer.new()
	_select_container.theme_override_constants/separation = 8
	_select_container.visible = false
	vbox.add_child(_select_container)

	_build_view_state()
	_build_select_state()


func _build_view_state() -> void:
	var header := Label.new()
	header.text = "CURRENT TEMPLATE"
	header.theme_override_font_sizes/font_size = 14
	_view_container.add_child(header)

	_no_template_label = Label.new()
	_no_template_label.text = "NO TEMPLATE ASSIGNED"
	_no_template_label.theme_override_font_sizes/font_size = 12
	_no_template_label.modulate = Color(0.6, 0.6, 0.6, 1.0)
	_view_container.add_child(_no_template_label)

	var separator := HSeparator.new()
	_view_container.add_child(separator)

	_template_name_label = Label.new()
	_template_name_label.theme_override_font_sizes/font_size = 16
	_view_container.add_child(_template_name_label)

	var type_radius_row := HBoxContainer.new()
	type_radius_row.theme_override_constants/separation = 8
	_view_container.add_child(type_radius_row)

	_division_type_label = Label.new()
	_division_type_label.size_flags_horizontal = 3
	_division_type_label.theme_override_font_sizes/font_size = 11
	type_radius_row.add_child(_division_type_label)

	_engagement_radius_label = Label.new()
	_engagement_radius_label.theme_override_font_sizes/font_size = 11
	type_radius_row.add_child(_engagement_radius_label)

	var profile_header := Label.new()
	profile_header.text = "MOVEMENT PROFILE"
	profile_header.theme_override_font_sizes/font_size = 12
	_view_container.add_child(profile_header)

	var swatch_row := HBoxContainer.new()
	swatch_row.theme_override_constants/separation = 4
	_view_container.add_child(swatch_row)

	var terrain_names := ["Plains", "Hills", "Forest", "DnsF", "Mtn"]
	var terrain_colors := [
		Color(0.60, 0.75, 0.35, 1.0),
		Color(0.55, 0.50, 0.30, 1.0),
		Color(0.25, 0.45, 0.20, 1.0),
		Color(0.15, 0.30, 0.10, 1.0),
		Color(0.40, 0.35, 0.30, 1.0),
	]
	_movement_swatches.clear()
	for s: int in range(5):
		var swatch := ColorRect.new()
		swatch.custom_minimum_size = Vector2(24, 12)
		swatch.color = terrain_colors[s]
		swatch.tooltip_text = terrain_names[s]
		swatch_row.add_child(swatch)
		_movement_swatches.append(swatch)

	var fill_header := Label.new()
	fill_header.text = "FILL & ROLE BALANCE"
	fill_header.theme_override_font_sizes/font_size = 12
	_view_container.add_child(fill_header)

	_fill_count_label = Label.new()
	_fill_count_label.theme_override_font_sizes/font_size = 11
	_view_container.add_child(_fill_count_label)

	_fill_bars.clear()
	_fill_labels.clear()
	for r: int in range(5):
		var row_hbox := HBoxContainer.new()
		row_hbox.theme_override_constants/separation = 4
		_view_container.add_child(row_hbox)

		var name_lbl := Label.new()
		name_lbl.text = ROW_NAMES[r]
		name_lbl.custom_minimum_size = Vector2(60, 0)
		name_lbl.theme_override_font_sizes/font_size = 10
		row_hbox.add_child(name_lbl)

		var bar := ProgressBar.new()
		bar.size_flags_horizontal = 3
		bar.custom_minimum_size = Vector2(0, 12)
		bar.max_value = 5.0
		bar.show_percentage = false
		row_hbox.add_child(bar)
		_fill_bars.append(bar)

		var count_lbl := Label.new()
		count_lbl.custom_minimum_size = Vector2(20, 0)
		count_lbl.theme_override_font_sizes/font_size = 10
		row_hbox.add_child(count_lbl)
		_fill_labels.append(count_lbl)

	_locked_notice = Label.new()
	_locked_notice.text = "Template cannot be changed while division is engaged"
	_locked_notice.theme_override_font_sizes/font_size = 11
	_locked_notice.modulate = Color(0.8, 0.3, 0.3, 1.0)
	_locked_notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_view_container.add_child(_locked_notice)

	_change_btn = Button.new()
	_change_btn.text = "Change Template →"
	_change_btn.pressed.connect(_enter_select_mode)
	_view_container.add_child(_change_btn)


func _build_select_state() -> void:
	var header_row := HBoxContainer.new()
	header_row.theme_override_constants/separation = 8
	_select_container.add_child(header_row)

	var header := Label.new()
	header.text = "SELECT TEMPLATE"
	header.theme_override_font_sizes/font_size = 14
	header.size_flags_horizontal = 3
	header_row.add_child(header)

	var back_btn := Button.new()
	back_btn.text = "← Back"
	back_btn.pressed.connect(_exit_select_mode)
	header_row.add_child(back_btn)

	var list_scroll := ScrollContainer.new()
	list_scroll.size_flags_horizontal = 3
	list_scroll.size_flags_vertical = 3
	_select_container.add_child(list_scroll)

	_template_list_container = VBoxContainer.new()
	_template_list_container.theme_override_constants/separation = 4
	list_scroll.add_child(_template_list_container)

	_select_container.add_child(HSeparator.new())

	_confirm_label = Label.new()
	_confirm_label.theme_override_font_sizes/font_size = 11
	_select_container.add_child(_confirm_label)

	_confirm_btn = Button.new()
	_confirm_btn.text = "Confirm — apply to ..."
	_confirm_btn.disabled = true
	_confirm_btn.pressed.connect(_confirm_template)
	_select_container.add_child(_confirm_btn)


func _show_view_state() -> void:
	_view_container.show()
	_select_container.hide()
	_in_select_mode = false
	_refresh_right_view()


func _enter_select_mode() -> void:
	_view_container.hide()
	_select_container.show()
	_in_select_mode = true
	_confirm_btn.disabled = true
	_rebuild_template_list()


func _exit_select_mode() -> void:
	_preview_template_id = _current_template_id
	_load_cells_from_template(_current_template_id)
	_refresh_grid()
	_show_view_state()


func _refresh_right_view() -> void:
	_locked_notice.visible = _is_locked
	_change_btn.visible = not _is_locked

	if _current_template_id == "":
		_no_template_label.show()
		_template_name_label.hide()
		_division_type_label.hide()
		_engagement_radius_label.hide()
		for bar: ProgressBar in _fill_bars:
			bar.value = 0.0
		for lbl: Label in _fill_labels:
			lbl.text = "0"
		_fill_count_label.text = ""
		return

	_no_template_label.hide()
	_template_name_label.show()
	_division_type_label.show()
	_engagement_radius_label.show()

	var template: Dictionary = DivisionTemplateStore.get_template(_current_template_id)
	var t_cells: Array = template.get("cells", [])
	var t_name: String = template.get("name", "—")
	_template_name_label.text = t_name

	var div_type: String = _derive_division_type(t_cells)
	var radius: float = float(_division_data.get("engagement_radius", 25))
	_division_type_label.text = div_type
	_engagement_radius_label.text = "~%d km" % radius

	var total_filled := 0
	var row_counts: Array = [0, 0, 0, 0, 0]
	for i: int in range(25):
		if t_cells[i] != "":
			total_filled += 1
			row_counts[i / 5] += 1
	_fill_count_label.text = "Filled: %d / 25 cells" % total_filled
	for r: int in range(5):
		var bar: ProgressBar = _fill_bars[r] as ProgressBar
		bar.value = row_counts[r]
		var lbl: Label = _fill_labels[r] as Label
		lbl.text = str(row_counts[r])


func _rebuild_template_list() -> void:
	for child: Node in _template_list_container.get_children():
		_template_list_container.remove_child(child)
		child.queue_free()

	var templates: Array = DivisionTemplateStore.get_templates()
	for t: Dictionary in templates:
		var card: PanelContainer = _make_template_card(t)
		_template_list_container.add_child(card)


func _make_template_card(template: Dictionary) -> PanelContainer:
	var card := PanelContainer.new()
	card.theme_override_styles/panel = null

	var margin := MarginContainer.new()
	margin.theme_override_constants/margin_left = 6
	margin.theme_override_constants/margin_top = 4
	margin.theme_override_constants/margin_right = 6
	margin.theme_override_constants/margin_bottom = 4
	card.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.theme_override_constants/separation = 2
	margin.add_child(vbox)

	var name_row := HBoxContainer.new()
	vbox.add_child(name_row)

	var is_current: bool = template.get("id", "") == _current_template_id
	if is_current:
		var star := Label.new()
		star.text = "[★]"
		star.theme_override_font_sizes/font_size = 11
		name_row.add_child(star)

	var name_lbl := Label.new()
	name_lbl.text = template.get("name", "—")
	name_lbl.theme_override_font_sizes/font_size = 12
	name_lbl.size_flags_horizontal = 3
	name_row.add_child(name_lbl)

	if is_current:
		var badge := Label.new()
		badge.text = "[CURRENT]"
		badge.theme_override_font_sizes/font_size = 9
		badge.modulate = Color(0.18, 0.62, 0.56, 1.0)
		name_row.add_child(badge)

	var sub_lbl := Label.new()
	var t_cells: Array = template.get("cells", [])
	var t_type: String = _derive_division_type(t_cells)
	var t_radius: String = _derive_engagement_radius(t_cells)
	sub_lbl.text = "%s  ·  %s" % [t_type, t_radius]
	sub_lbl.theme_override_font_sizes/font_size = 9
	sub_lbl.modulate = Color(0.6, 0.6, 0.6, 1.0)
	vbox.add_child(sub_lbl)

	var tid: String = template.get("id", "")
	card.mouse_entered.connect(func() -> void:
		_load_cells_from_template(tid)
		_refresh_grid()
	)
	card.mouse_exited.connect(func() -> void:
		_load_cells_from_template(_preview_template_id)
		_refresh_grid()
	)
	card.gui_input.connect(func(event: InputEvent) -> void:
		var mb := event as InputEventMouseButton
		if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			_preview_template_id = tid
			_load_cells_from_template(tid)
			_refresh_grid()
			_confirm_btn.disabled = false
			_confirm_label.text = "Confirm: %s" % template.get("name", "—")
			_confirm_btn.text = "Confirm — apply to %s" % _division_id
	)

	return card


func _confirm_template() -> void:
	if _preview_template_id == "":
		return
	var template: Dictionary = DivisionTemplateStore.get_template(_preview_template_id)
	var t_cells: Array = template.get("cells", [])
	var cells_payload: Array = []
	for i: int in range(25):
		var unit_type: String = t_cells[i] if i < t_cells.size() else ""
		if unit_type != "":
			cells_payload.append({ "cell_index": i, "unit_type": unit_type })
	CommandQueue.submit("ASSIGN_TEMPLATE", {
		"division_id": _division_id,
		"template_id": _preview_template_id,
		"cells": cells_payload,
	})
	close_requested.emit()


func _load_cells_from_template(tid: String) -> void:
	_cells.fill("")
	if tid == "":
		return
	var template: Dictionary = DivisionTemplateStore.get_template(tid)
	var t_cells: Array = template.get("cells", [])
	for i: int in range(min(25, t_cells.size())):
		_cells[i] = t_cells[i]


func _refresh_grid() -> void:
	for i: int in range(25):
		if i < _cell_nodes.size():
			(_cell_nodes[i] as UnitGlyphCell).unit_type = _cells[i]


static func _derive_division_type(cells: Array) -> String:
	var armor := 0
	var arty := 0
	var total := 0
	for unit_type: String in cells:
		if unit_type == "":
			continue
		total += 1
		if unit_type in ARMOR_TYPES:
			armor += 1
		elif unit_type in ARTY_TYPES:
			arty += 1
	if total == 0:
		return "Empty"
	if armor >= 3:
		return "Armoured Assault"
	if armor >= 2 and (total - armor - arty) >= 2:
		return "Combined-Arms"
	if arty >= 2 and (total - armor - arty) >= 3:
		return "Supported Infantry"
	if (total - armor - arty) >= 5:
		return "Infantry Division"
	return "Mixed"


static func _derive_engagement_radius(cells: Array) -> String:
	var armor := 0
	for unit_type: String in cells:
		if unit_type in ARMOR_TYPES:
			armor += 1
	if armor >= 3:
		return "~30 km"
	if armor >= 1:
		return "~40 km"
	return "~50 km"
