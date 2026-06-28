class_name DivisionBuilderPanel
extends PanelContainer
## Division Builder — full-center overlay.
## Left 60%: 5x5 template grid of UnitGlyphCell nodes.
## Right 40%: context panel — Overview state (no cell selected)
##            or Cell-Selected state (shows eligible units for that row).
##
## Cell index convention: visual_row * 5 + col
##   visual_row 0 = VANGUARD (front/top), visual_row 4 = REAR (bottom)

signal close_requested()

const _CELL_SCENE := preload("res://scenes/game/panels/unit_glyph_cell.tscn")

const ROW_NAMES: Array[String] = ["VANGUARD", "ASSAULT", "SUPPORT", "RESERVE", "REAR"]
const ROW_COLORS: Array = [
	Color(0.80, 0.15, 0.15, 1.0),
	Color(0.85, 0.45, 0.10, 1.0),
	Color(0.75, 0.65, 0.10, 1.0),
	Color(0.15, 0.60, 0.25, 1.0),
	Color(0.20, 0.40, 0.75, 1.0),
]

const ELIGIBLE_UNITS: Array = [
	["recon_infantry", "force_recon_sniper", "cavalry", "armoured_car", "light_tank", "commando"],
	["medium_tank", "heavy_tank", "assault_infantry", "infantry", "at_gun_sp", "self_propelled_gun"],
	["artillery", "howitzer", "at_gun", "mg", "aa_gun", "flamethrower"],
	["infantry", "assault_infantry", "at_infantry", "commando", "sniper"],
	["infantry", "mg", "at_infantry", "sniper"],
]

const UNIT_DESCRIPTIONS: Dictionary = {
	"infantry": "Standard line infantry",
	"assault_infantry": "Close-assault specialists",
	"recon_infantry": "Scouts ahead, widens radius",
	"mg": "Sustained fire, suppression",
	"cavalry": "Fast flanking, high mobility",
	"light_tank": "Fast armor, limited firepower",
	"medium_tank": "Balanced breakthrough tank",
	"heavy_tank": "Slow but heavily armoured",
	"armoured_car": "Fast scouting, anti-stealth",
	"at_infantry": "Portable anti-tank weapons",
	"at_gun": "Towed anti-tank gun",
	"at_gun_sp": "Self-propelled anti-tank",
	"aa_gun": "Anti-aircraft defence",
	"sniper": "Precision fire, high stealth",
	"flamethrower": "Clears fortifications, AOE",
	"artillery": "Long-range indirect fire",
	"commando": "Specialist inf, high stealth",
	"force_recon_sniper": "Elite recon, reveals stealth",
	"howitzer": "Heavy artillery barrage",
	"self_propelled_gun": "Mobile fire support",
}

const ARMOR_TYPES := ["light_tank", "medium_tank", "heavy_tank",
	"armoured_car", "at_gun_sp", "self_propelled_gun"]
const ARTY_TYPES  := ["artillery", "howitzer", "at_gun", "aa_gun"]


var _current_template: Dictionary = {}
var _cells: Array = []
var _selected_cell_index: int = -1
var _cell_nodes: Array = []

var _template_name_label: Label
var _overview_btn: Button
var _overview_container: VBoxContainer
var _cell_selected_container: VBoxContainer
var _eligible_list_container: VBoxContainer
var _detail_label: Label
var _row_badge_label: Label
var _cell_title_label: Label
var _division_type_label: Label
var _engagement_radius_label: Label
var _fill_bars: Array = []
var _fill_labels: Array = []
var _preview_unit_type: String = ""


func _ready() -> void:
	_cells.resize(25)
	_cells.fill("")
	_build_top_bar()
	_build_body()
	EventBus.division_builder_open_requested.connect(_on_open_requested)
	close_requested.connect(func() -> void: EventBus.division_builder_closed.emit())


func _on_open_requested(template_id: String) -> void:
	if template_id == "":
		_current_template = {"id": "", "name": "New Template", "cells": []}
		_cells.fill("")
	else:
		_current_template = DivisionTemplateStore.get_template(template_id)
		if _current_template.is_empty():
			_current_template = {"id": template_id, "name": "Unknown", "cells": []}
			_cells.fill("")
		else:
			var loaded: Array = _current_template.get("cells", [])
			for i: int in range(25):
				_cells[i] = loaded[i] if i < loaded.size() else ""
	_selected_cell_index = -1
	_template_name_label.text = _current_template.get("name", "New Template")
	_refresh_grid()
	_show_overview()


func _build_top_bar() -> void:
	var top_bar: HBoxContainer = %TopBar

	var accent := ColorRect.new()
	accent.custom_minimum_size = Vector2(3, 24)
	accent.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	accent.color = Color(0.18, 0.62, 0.56, 1.0)
	top_bar.add_child(accent)

	var title := Label.new()
	title.text = "DIVISION BUILDER"
	title.add_theme_font_size_override("font_size", 18)
	top_bar.add_child(title)

	_template_name_label = Label.new()
	_template_name_label.text = "New Template"
	_template_name_label.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_template_name_label.add_theme_font_size_override("font_size", 13)
	_template_name_label.add_theme_color_override("font_color", Color(0.8, 0.7, 0.5, 1.0))
	top_bar.add_child(_template_name_label)

	_overview_btn = Button.new()
	_overview_btn.text = "\u2190 Overview (deselect)"
	_overview_btn.visible = false
	_overview_btn.pressed.connect(_deselect_cell)
	top_bar.add_child(_overview_btn)

	var save_btn := Button.new()
	save_btn.text = "Save"
	save_btn.pressed.connect(_save_template)
	top_bar.add_child(save_btn)

	var close_btn := Button.new()
	close_btn.text = "\u2715"
	close_btn.custom_minimum_size = Vector2(28, 28)
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	top_bar.add_child(close_btn)


func _build_body() -> void:
	var body: HBoxContainer = %Body

	var left := PanelContainer.new()
	left.layout_mode = 2
	left.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	left.size_flags_stretch_ratio = 0.6
	body.add_child(left)
	_build_grid_panel(left)

	var right := PanelContainer.new()
	right.layout_mode = 2
	right.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	right.size_flags_stretch_ratio = 0.4
	body.add_child(right)
	_build_right_panel(right)


func _build_grid_panel(parent: PanelContainer) -> void:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 8)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 8)
	margin.add_theme_constant_override("margin_bottom", 8)
	margin.layout_mode = 2
	parent.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.layout_mode = 2
	vbox.add_theme_constant_override("separation", 4)
	margin.add_child(vbox)

	var header_row := HBoxContainer.new()
	header_row.layout_mode = 2
	vbox.add_child(header_row)
	var grid_title := Label.new()
	grid_title.text = "TEMPLATE GRID \u00b7 5\u00d75"
	grid_title.add_theme_font_size_override("font_size", 11)
	grid_title.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	header_row.add_child(grid_title)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	header_row.add_child(spacer)
	var dir_lbl := Label.new()
	dir_lbl.text = "front-to-back \u2193"
	dir_lbl.add_theme_font_size_override("font_size", 11)
	dir_lbl.add_theme_color_override("font_color", Color(0.75, 0.35, 0.2, 1.0))
	header_row.add_child(dir_lbl)

	var front_lbl := Label.new()
	front_lbl.text = "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 FRONT LINE \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550"
	front_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	front_lbl.add_theme_color_override("font_color", Color(0.75, 0.2, 0.2, 1.0))
	front_lbl.add_theme_font_size_override("font_size", 11)
	vbox.add_child(front_lbl)

	var grid_area := HBoxContainer.new()
	grid_area.layout_mode = 2
	grid_area.add_theme_constant_override("separation", 6)
	vbox.add_child(grid_area)

	var row_label_col := VBoxContainer.new()
	row_label_col.layout_mode = 2
	row_label_col.add_theme_constant_override("separation", 0)
	row_label_col.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	grid_area.add_child(row_label_col)

	for r: int in range(5):
		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.custom_minimum_size = Vector2(68, 76)
		row_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row_lbl.add_theme_font_size_override("font_size", 11)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		row_label_col.add_child(row_lbl)

	var grid := GridContainer.new()
	grid.layout_mode = 2
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	grid_area.add_child(grid)

	_cell_nodes.clear()
	for i: int in range(25):
		var cell: UnitGlyphCell = _CELL_SCENE.instantiate() as UnitGlyphCell
		cell.unit_type = _cells[i]
		cell.cell_clicked.connect(func(_c: UnitGlyphCell) -> void: _on_cell_clicked(i))
		cell.cell_right_clicked.connect(func(_c: UnitGlyphCell) -> void: _on_cell_right_clicked(i))
		grid.add_child(cell)
		_cell_nodes.append(cell)


func _build_right_panel(parent: PanelContainer) -> void:
	var scroll := ScrollContainer.new()
	scroll.layout_mode = 2
	scroll.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	scroll.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(scroll)

	var margin := MarginContainer.new()
	margin.layout_mode = 2
	margin.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 10)
	scroll.add_child(margin)

	var right_vbox := VBoxContainer.new()
	right_vbox.layout_mode = 2
	right_vbox.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	right_vbox.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	margin.add_child(right_vbox)

	_overview_container = VBoxContainer.new()
	_overview_container.layout_mode = 2
	_overview_container.add_theme_constant_override("separation", 10)
	right_vbox.add_child(_overview_container)

	var ov_title := Label.new()
	ov_title.text = "DIVISION OVERVIEW"
	ov_title.add_theme_font_size_override("font_size", 16)
	_overview_container.add_child(ov_title)

	var auto_lbl := Label.new()
	auto_lbl.text = "[AUTO-DERIVED]  computed from composition"
	auto_lbl.add_theme_font_size_override("font_size", 10)
	auto_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_overview_container.add_child(auto_lbl)

	var type_row := HBoxContainer.new()
	type_row.layout_mode = 2
	_overview_container.add_child(type_row)
	var type_col := VBoxContainer.new()
	type_col.layout_mode = 2
	type_col.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	type_row.add_child(type_col)
	var type_header := Label.new()
	type_header.text = "DIVISION TYPE"
	type_header.add_theme_font_size_override("font_size", 10)
	type_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	type_col.add_child(type_header)
	_division_type_label = Label.new()
	_division_type_label.text = "\u2014"
	_division_type_label.add_theme_font_size_override("font_size", 16)
	type_col.add_child(_division_type_label)

	var radius_col := VBoxContainer.new()
	radius_col.layout_mode = 2
	type_row.add_child(radius_col)
	var radius_header := Label.new()
	radius_header.text = "ENGAGEMENT\nRADIUS"
	radius_header.add_theme_font_size_override("font_size", 10)
	radius_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	radius_col.add_child(radius_header)
	_engagement_radius_label = Label.new()
	_engagement_radius_label.text = "\u2014"
	_engagement_radius_label.add_theme_font_size_override("font_size", 16)
	radius_col.add_child(_engagement_radius_label)

	var mp_header := Label.new()
	mp_header.text = "MOVEMENT PROFILE \u2014 fast \u2192 impassable"
	mp_header.add_theme_font_size_override("font_size", 10)
	mp_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_overview_container.add_child(mp_header)
	var swatch_row := HBoxContainer.new()
	swatch_row.layout_mode = 2
	swatch_row.add_theme_constant_override("separation", 4)
	_overview_container.add_child(swatch_row)
	for entry: Array in [
		[Color(0.35, 0.55, 0.25, 1.0), "Plains"],
		[Color(0.30, 0.50, 0.20, 1.0), "Hills"],
		[Color(0.25, 0.40, 0.15, 1.0), "Forest"],
		[Color(0.15, 0.25, 0.10, 1.0), "DnsF"],
		[Color(0.10, 0.10, 0.10, 0.8), "Mtn"],
	]:
		var swatch_col := VBoxContainer.new()
		swatch_col.layout_mode = 2
		swatch_row.add_child(swatch_col)
		var swatch := ColorRect.new()
		swatch.custom_minimum_size = Vector2(38, 24)
		swatch.color = entry[0] as Color
		swatch_col.add_child(swatch)
		var swatch_lbl := Label.new()
		swatch_lbl.text = entry[1] as String
		swatch_lbl.add_theme_font_size_override("font_size", 9)
		swatch_col.add_child(swatch_lbl)

	var fill_header_row := HBoxContainer.new()
	fill_header_row.layout_mode = 2
	_overview_container.add_child(fill_header_row)
	var fill_hdr := Label.new()
	fill_hdr.text = "FILL & ROLE BALANCE"
	fill_hdr.add_theme_font_size_override("font_size", 11)
	fill_hdr.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	fill_header_row.add_child(fill_hdr)
	var fill_total_lbl := Label.new()
	fill_total_lbl.name = "FillTotalLabel"
	fill_total_lbl.add_theme_font_size_override("font_size", 11)
	fill_header_row.add_child(fill_total_lbl)

	_fill_bars.clear()
	_fill_labels.clear()
	for r: int in range(5):
		var bar_row := HBoxContainer.new()
		bar_row.layout_mode = 2
		bar_row.add_theme_constant_override("separation", 6)
		_overview_container.add_child(bar_row)
		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.custom_minimum_size = Vector2(72, 0)
		row_lbl.add_theme_font_size_override("font_size", 10)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		bar_row.add_child(row_lbl)
		var bar := ProgressBar.new()
		bar.min_value = 0.0
		bar.max_value = 5.0
		bar.value = 0.0
		bar.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		bar.custom_minimum_size = Vector2(0, 12)
		bar_row.add_child(bar)
		var count_lbl := Label.new()
		count_lbl.custom_minimum_size = Vector2(28, 0)
		count_lbl.add_theme_font_size_override("font_size", 10)
		bar_row.add_child(count_lbl)
		_fill_bars.append(bar)
		_fill_labels.append(count_lbl)

	_cell_selected_container = VBoxContainer.new()
	_cell_selected_container.layout_mode = 2
	_cell_selected_container.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	_cell_selected_container.add_theme_constant_override("separation", 8)
	_cell_selected_container.visible = false
	right_vbox.add_child(_cell_selected_container)

	var badge_row := HBoxContainer.new()
	badge_row.layout_mode = 2
	badge_row.add_theme_constant_override("separation", 8)
	_cell_selected_container.add_child(badge_row)
	_row_badge_label = Label.new()
	_row_badge_label.custom_minimum_size = Vector2(80, 28)
	_row_badge_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_row_badge_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	badge_row.add_child(_row_badge_label)
	_cell_title_label = Label.new()
	_cell_title_label.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_cell_title_label.add_theme_font_size_override("font_size", 13)
	badge_row.add_child(_cell_title_label)

	var hint_lbl := Label.new()
	hint_lbl.text = "hover = preview    click = place"
	hint_lbl.add_theme_font_size_override("font_size", 10)
	hint_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_cell_selected_container.add_child(hint_lbl)

	var eligible_hdr := Label.new()
	eligible_hdr.name = "EligibleHeader"
	eligible_hdr.add_theme_font_size_override("font_size", 11)
	eligible_hdr.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	_cell_selected_container.add_child(eligible_hdr)

	var list_scroll := ScrollContainer.new()
	list_scroll.layout_mode = 2
	list_scroll.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_cell_selected_container.add_child(list_scroll)

	_eligible_list_container = VBoxContainer.new()
	_eligible_list_container.layout_mode = 2
	_eligible_list_container.add_theme_constant_override("separation", 4)
	_eligible_list_container.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_eligible_list_container.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.add_child(_eligible_list_container)

	var sep := HSeparator.new()
	_cell_selected_container.add_child(sep)

	var detail_hdr := Label.new()
	detail_hdr.text = "DETAIL"
	detail_hdr.add_theme_font_size_override("font_size", 10)
	detail_hdr.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_cell_selected_container.add_child(detail_hdr)

	_detail_label = Label.new()
	_detail_label.add_theme_font_size_override("font_size", 12)
	_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	_cell_selected_container.add_child(_detail_label)


func _on_cell_clicked(index: int) -> void:
	if _selected_cell_index == index:
		_deselect_cell()
		return
	_selected_cell_index = index
	for i: int in range(_cell_nodes.size()):
		(_cell_nodes[i] as UnitGlyphCell).is_selected = (i == index)
	_overview_btn.visible = true
	_show_cell_selected(index)


func _on_cell_right_clicked(index: int) -> void:
	_cells[index] = ""
	(_cell_nodes[index] as UnitGlyphCell).unit_type = ""
	if _selected_cell_index == index:
		_refresh_cell_selected_panel(index)
	_refresh_overview_stats()


func _deselect_cell() -> void:
	_selected_cell_index = -1
	for node: UnitGlyphCell in _cell_nodes:
		node.is_selected = false
	_overview_btn.visible = false
	_show_overview()


func _show_overview() -> void:
	_overview_container.visible = true
	_cell_selected_container.visible = false
	_refresh_overview_stats()


func _show_cell_selected(index: int) -> void:
	_overview_container.visible = false
	_cell_selected_container.visible = true
	_refresh_cell_selected_panel(index)


func _refresh_overview_stats() -> void:
	var div_type  := _derive_division_type(_cells)
	var radius    := _derive_engagement_radius(_cells)
	var total     := 0
	for unit_type: String in _cells:
		if unit_type != "":
			total += 1

	_division_type_label.text    = div_type
	_engagement_radius_label.text = radius

	var fill_total_lbl: Label = _overview_container.find_child("FillTotalLabel", true, false) as Label
	if fill_total_lbl != null:
		fill_total_lbl.text = "%d / 25 cells" % total

	for r: int in range(5):
		var count := 0
		for c: int in range(5):
			if _cells[r * 5 + c] != "":
				count += 1
		(_fill_bars[r] as ProgressBar).value = float(count)
		(_fill_labels[r] as Label).text = "%d/5" % count


func _refresh_cell_selected_panel(index: int) -> void:
	var row: int = index / 5
	var col: int = index % 5
	var current_unit: String = _cells[index]

	_row_badge_label.text = ROW_NAMES[row]
	_row_badge_label.add_theme_color_override("font_color", ROW_COLORS[row])

	var cell_title := "Cell R%dC%d" % [row + 1, col + 1]
	if current_unit != "":
		cell_title += " \u00b7 holds %s" % UnitGlyphCell.UNIT_ABBREV.get(current_unit, current_unit)
	_cell_title_label.text = cell_title

	var eligible_hdr: Label = _cell_selected_container.find_child("EligibleHeader", true, false) as Label
	if eligible_hdr != null:
		eligible_hdr.text = "ELIGIBLE UNITS \u00b7 %s ROW" % ROW_NAMES[row]

	for child: Node in _eligible_list_container.get_children():
		_eligible_list_container.remove_child(child)
		child.queue_free()

	for unit_type: String in ELIGIBLE_UNITS[row]:
		var card := _make_unit_card(unit_type, index)
		_eligible_list_container.add_child(card)

	_restore_detail_for_cell(index)


func _make_unit_card(unit_type: String, target_index: int) -> Control:
	var is_in_cell: bool = (_cells[target_index] == unit_type)

	var card := PanelContainer.new()
	card.layout_mode = 2
	card.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	card.custom_minimum_size = Vector2(0, 56)

	var hbox := HBoxContainer.new()
	hbox.layout_mode = 2
	hbox.add_theme_constant_override("separation", 8)
	card.add_child(hbox)

	var mini: UnitGlyphCell = _CELL_SCENE.instantiate() as UnitGlyphCell
	mini.unit_type = unit_type
	mini.custom_minimum_size = Vector2(48, 48)
	hbox.add_child(mini)

	var text_col := VBoxContainer.new()
	text_col.layout_mode = 2
	text_col.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(text_col)

	var name_row := HBoxContainer.new()
	name_row.layout_mode = 2
	text_col.add_child(name_row)
	var name_lbl := Label.new()
	name_lbl.text = unit_type.replace("_", " ").capitalize()
	name_lbl.add_theme_font_size_override("font_size", 13)
	name_row.add_child(name_lbl)
	var abbrev_lbl := Label.new()
	abbrev_lbl.text = "  %s" % UnitGlyphCell.UNIT_ABBREV.get(unit_type, "???")
	abbrev_lbl.add_theme_font_size_override("font_size", 11)
	abbrev_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	name_row.add_child(abbrev_lbl)

	if is_in_cell:
		var badge := Label.new()
		badge.text = " IN CELL"
		badge.add_theme_font_size_override("font_size", 10)
		badge.add_theme_color_override("font_color", Color(0.2, 0.7, 0.4, 1.0))
		name_row.add_child(badge)

	var desc_lbl := Label.new()
	desc_lbl.text = UNIT_DESCRIPTIONS.get(unit_type, "")
	desc_lbl.add_theme_font_size_override("font_size", 10)
	desc_lbl.add_theme_color_override("font_color", Color(0.65, 0.6, 0.45, 1.0))
	text_col.add_child(desc_lbl)

	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_entered.connect(func() -> void: _preview_unit_in_detail(unit_type))
	card.mouse_exited.connect(func() -> void: _restore_detail_for_cell(target_index))

	var place_unit := func() -> void:
		if _cells[target_index] == unit_type:
			_cells[target_index] = ""
		else:
			_cells[target_index] = unit_type
		(_cell_nodes[target_index] as UnitGlyphCell).unit_type = _cells[target_index]
		_refresh_cell_selected_panel(target_index)
		_refresh_overview_stats()

	card.gui_input.connect(func(event: InputEvent) -> void:
		if not (event is InputEventMouseButton):
			return
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			place_unit.call()
	)

	mini.cell_clicked.connect(func(_c: UnitGlyphCell) -> void:
		place_unit.call()
	)

	return card


func _preview_unit_in_detail(unit_type: String) -> void:
	_preview_unit_type = unit_type
	_detail_label.text = "%s  %s\n%s\n(hover \u2014 click to place)" % [
		UnitGlyphCell.UNIT_ABBREV.get(unit_type, "???"),
		unit_type.replace("_", " ").capitalize(),
		UNIT_DESCRIPTIONS.get(unit_type, ""),
	]
	_detail_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.65, 1.0))


func _restore_detail_for_cell(index: int) -> void:
	_preview_unit_type = ""
	_detail_label.remove_theme_color_override("font_color")
	var current_unit: String = _cells[index] if index >= 0 else ""
	if current_unit != "":
		_detail_label.text = "%s  %s\n%s" % [
			UnitGlyphCell.UNIT_ABBREV.get(current_unit, "???"),
			current_unit.replace("_", " ").capitalize(),
			UNIT_DESCRIPTIONS.get(current_unit, ""),
		]
	else:
		_detail_label.text = "(empty \u2014 hover a unit above to preview)"


func _refresh_grid() -> void:
	for i: int in range(25):
		if i < _cell_nodes.size():
			(_cell_nodes[i] as UnitGlyphCell).unit_type = _cells[i]
			(_cell_nodes[i] as UnitGlyphCell).is_selected = false


func _save_template() -> void:
	var template_id: String = _current_template.get("id", "")
	if template_id == "":
		template_id = "user_%d" % Time.get_unix_time_from_system()
		_current_template["id"] = template_id
	_current_template["cells"] = _cells.duplicate()
	DivisionTemplateStore.save_template(_current_template)


static func _derive_division_type(cells: Array) -> String:
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
	if total == 0: return "Empty"
	if armor >= 3: return "Armoured Assault"
	if armor >= 2 and inf >= 2: return "Combined-Arms"
	if arty >= 2 and inf >= 3: return "Supported Infantry"
	if inf >= 5: return "Infantry Division"
	return "Mixed"


static func _derive_engagement_radius(cells: Array) -> String:
	var armor := 0
	for unit_type: String in cells:
		if unit_type in ARMOR_TYPES:
			armor += 1
	if armor >= 3: return "~30 km"
	if armor >= 1: return "~40 km"
	return "~50 km"
