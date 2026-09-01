extends PanelContainer

signal close_requested()

@onready var _close_button: Button = %CloseButton
@onready var _template_list: VBoxContainer = %TemplateList
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
	_btn_raise.pressed.connect(_on_raise_pressed)
	EventBus.marshalling_updated.connect(_refresh_templates)
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_templates())
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
		var tid: String = template.get("id", "")
		var row := HBoxContainer.new()
		var label := Label.new()
		label.text = "%s   Fielded: %d   Deploying: %d" % [
			template.get("name", tid), fielded_counts.get(tid, 0), deploying_counts.get(tid, 0),
		]
		row.add_child(label)
		_template_list.add_child(row)


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
