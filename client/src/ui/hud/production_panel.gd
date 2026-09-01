extends PanelContainer

signal close_requested()

@onready var _close_button: Button = %CloseButton
@onready var _template_list: VBoxContainer = %TemplateList
@onready var _btn_add_template: Button = %BtnAddTemplate
@onready var _btn_raise: Button = %BtnRaise
@onready var _reserve_list: VBoxContainer = %ReserveList

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

# unit_type -> category label, per RESOURCE_ECONOMY.md's Reserve status categories.
const RESERVE_CATEGORIES := {
	"Infantry": ["infantry", "assault_infantry", "recon_infantry", "mg", "cavalry", "at_infantry", "sniper", "commando", "flamethrower", "force_recon_sniper", "motorised_infantry"],
	"Ordnance": ["artillery", "at_gun", "aa_gun", "howitzer"],
	"Tank": ["armoured_car", "light_tank", "medium_tank", "heavy_tank", "at_gun_sp", "self_propelled_gun", "mechanised_infantry"],
	"Air": ["cas_plane", "dive_bomber", "fighter", "naval_bomber", "heavy_fighter", "strategic_bomber", "tactical_bomber", "recon_plane"],
}


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_btn_add_template.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit("")
	)
	_btn_raise.pressed.connect(_on_raise_pressed)
	DivisionTemplateStore.templates_changed.connect(func() -> void: _refresh_templates())
	EventBus.marshalling_updated.connect(_refresh_templates)
	EventBus.division_added.connect(func(_id: String) -> void: _refresh_templates())
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_templates())
	EventBus.division_removed.connect(func(_id: String) -> void: _refresh_templates())
	EventBus.reserve_updated.connect(_refresh_reserve)
	_refresh_templates()
	_refresh_reserve()


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
	if tc != null:
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


func _refresh_templates() -> void:
	for child in _template_list.get_children():
		child.queue_free()
	var fielded_counts: Dictionary = {}
	for div_id: String in GameState.divisions:
		var tid: String = GameState.divisions[div_id].get("template_id", "")
		fielded_counts[tid] = fielded_counts.get(tid, 0) + 1
	var deploying_counts: Dictionary = {}
	for mid: String in GameState.marshalling_divisions:
		var tid: String = GameState.marshalling_divisions[mid].get("template_id", "")
		deploying_counts[tid] = deploying_counts.get(tid, 0) + 1

	for template: Dictionary in DivisionTemplateStore.get_templates():
		var item: Control = _make_template_item(
			template, fielded_counts.get(template.get("id", ""), 0), deploying_counts.get(template.get("id", ""), 0),
		)
		_template_list.add_child(item)


## Relocated from military_panel.gd (Phase 9 Task C amendment — Division Templates moved here
## per economy_production_ui_handoff.md §7 Tab 1), extended with Fielded/Deploying counts.
func _make_template_item(template: Dictionary, fielded: int, deploying: int) -> Control:
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

	var counts_lbl := Label.new()
	counts_lbl.text = "Fielded: %d    Deploying: %d" % [fielded, deploying]
	counts_lbl.add_theme_font_size_override("font_size", 11)
	vbox.add_child(counts_lbl)

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


func _on_raise_pressed() -> void:
	# Opens the existing Division Template Viewer so the player picks which template to raise
	# and which owned province to raise it from — reuses EventBus's existing open-request signal
	# rather than a new picker UI. The actual RAISE_DIVISION submission with the chosen
	# home_province_id happens wherever that viewer's confirm action lives; if it doesn't yet
	# expose a "raise this template from this province" action, that action should call:
	# CommandQueue.submit("RAISE_DIVISION", {"template_id": tid, "home_province_id": pid, "cells": cells})
	EventBus.division_template_viewer_open_requested.emit()


func _refresh_reserve() -> void:
	for child in _reserve_list.get_children():
		child.queue_free()
	for category: String in RESERVE_CATEGORIES:
		var total: float = 0.0
		for unit_type: String in RESERVE_CATEGORIES[category]:
			total += float(GameState.reserve.get(unit_type, 0.0))
		var row := Label.new()
		row.text = "%s   %s HP-eq / %s cap" % [category, str(int(total)), str(int(GameState.reserve_cap))]
		_reserve_list.add_child(row)
