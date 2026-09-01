extends PanelContainer

signal close_requested()

@onready var _close_button: Button = %CloseButton
@onready var _template_list: VBoxContainer = %TemplateList
@onready var _btn_add_template: Button = %BtnAddTemplate
@onready var _reserve_list: VBoxContainer = %ReserveList

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

# unit_type -> category, per RESOURCE_ECONOMY.md's Reserve status categories. Keys match the
# server's RESERVE_CATEGORY_BUILDING keys (GameRoom.ts) so reserve_category_stats lookups
# line up directly.
const RESERVE_CATEGORY_UNIT_TYPES := {
	"infantry": ["infantry", "assault_infantry", "recon_infantry", "mg", "cavalry", "at_infantry", "sniper", "commando", "flamethrower", "force_recon_sniper", "motorised_infantry"],
	"ordnance": ["artillery", "at_gun", "aa_gun", "howitzer"],
	"tank": ["armoured_car", "light_tank", "medium_tank", "heavy_tank", "at_gun_sp", "self_propelled_gun", "mechanised_infantry"],
	"air": ["cas_plane", "dive_bomber", "fighter", "naval_bomber", "heavy_fighter", "strategic_bomber", "tactical_bomber", "recon_plane"],
}
const RESERVE_CATEGORY_LABELS := {
	"infantry": "INFANTRY",
	"ordnance": "ORDNANCE (Arty/AT/AA)",
	"tank": "TANK",
	"air": "AIR",
}

# RESOURCE_ECONOMY.md's "Reserve status — deficit/excess severity" five bands, placeholder
# thresholds (structurally confirmed, exact cutoffs TBD from playtesting).
const SEVERITY_HEAVY_DEFICIT := -0.15
const SEVERITY_LIGHT_DEFICIT := -0.02
const SEVERITY_SLIGHT_SURPLUS := 0.02
const SEVERITY_HEAVY_SURPLUS := 0.15

const COLOR_RED := Color(0.85, 0.25, 0.2, 1.0)
const COLOR_AMBER := Color(0.9, 0.65, 0.15, 1.0)
const COLOR_NEUTRAL := Color(0.55, 0.55, 0.5, 1.0)
const COLOR_GREEN := Color(0.3, 0.75, 0.35, 1.0)
const COLOR_BLUE := Color(0.25, 0.55, 0.85, 1.0)


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_btn_add_template.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit("")
	)
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


# ── Templates tab ────────────────────────────────────────────────────────────

func _refresh_templates() -> void:
	for child in _template_list.get_children():
		child.queue_free()
	var my_nation: String = GameState.get_my_nation_id()

	var fielded_counts: Dictionary = {}
	for div_id: String in GameState.divisions:
		var div_data: Dictionary = GameState.divisions[div_id]
		if div_data.get("nation_id", "") != my_nation:
			continue
		var tid: String = div_data.get("template_id", "")
		fielded_counts[tid] = fielded_counts.get(tid, 0) + 1

	# MARSHALLING_UPDATES is already per-nation-filtered server-side (broadcastToNation), so
	# every entry in GameState.marshalling_divisions already belongs to the local player's own
	# nation — no additional filtering needed here.
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
## per economy_production_ui_handoff.md §7 Tab 1), extended with Fielded/Deploying counts and a
## per-template Raise action (the mockup predates RAISE_DIVISION existing at all — a per-row
## button is the natural placement since the row already carries the template context a raise
## action needs, rather than a single top-level button that would need to ask the player to
## pick a template all over again).
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

	var action_row := HBoxContainer.new()
	var action_spacer := Control.new()
	action_spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	action_row.add_child(action_spacer)

	var raise_btn := Button.new()
	raise_btn.text = "Raise"
	raise_btn.custom_minimum_size = Vector2(52, 24)
	var home_province: String = GameState.nation_capitals.get(GameState.get_my_nation_id(), "")
	raise_btn.disabled = home_province.is_empty()
	raise_btn.tooltip_text = "Raise this division at the capital" if not home_province.is_empty() else "No capital province known yet"
	raise_btn.pressed.connect(func() -> void:
		_on_raise_pressed(template_id, cells)
	)
	action_row.add_child(raise_btn)

	var edit_btn := Button.new()
	edit_btn.text = "Edit"
	edit_btn.custom_minimum_size = Vector2(48, 24)
	edit_btn.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit(template_id)
	)
	action_row.add_child(edit_btn)
	vbox.add_child(action_row)

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


## Raises this specific template at the player's own nation's capital province — the capital is
## a sensible default that needs no extra picker UI for the common case (nation_capitals is
## synced once at GAME_STARTED, see game_state.gd's set_nation_capitals()).
func _on_raise_pressed(template_id: String, cells: Array) -> void:
	var home_province: String = GameState.nation_capitals.get(GameState.get_my_nation_id(), "")
	if home_province.is_empty():
		return
	var cell_payload: Array = []
	for i: int in range(cells.size()):
		var unit_type: String = cells[i]
		if unit_type != "":
			cell_payload.append({"cell_index": i, "unit_type": unit_type})
	CommandQueue.submit("RAISE_DIVISION", {
		"template_id": template_id,
		"home_province_id": home_province,
		"cells": cell_payload,
	})


# ── Reserve tab ──────────────────────────────────────────────────────────────

func _refresh_reserve() -> void:
	for child in _reserve_list.get_children():
		child.queue_free()
	for category: String in RESERVE_CATEGORY_UNIT_TYPES:
		var total: float = 0.0
		for unit_type: String in RESERVE_CATEGORY_UNIT_TYPES[category]:
			total += float(GameState.reserve.get(unit_type, 0.0))
		var stats: Dictionary = GameState.reserve_category_stats.get(category, {})
		var production_rate: float = float(stats.get("production_rate", 0.0))
		var net_rate: float = float(stats.get("net_rate", 0.0))
		var severity: float = (net_rate / GameState.reserve_cap) if GameState.reserve_cap > 0.0 else 0.0
		var has_demand: bool = production_rate > 0.0 or net_rate != 0.0 or total > 0.0

		var section := VBoxContainer.new()
		section.add_theme_constant_override("separation", 2)

		var header := HBoxContainer.new()
		var name_lbl := Label.new()
		name_lbl.text = RESERVE_CATEGORY_LABELS.get(category, category)
		name_lbl.add_theme_font_size_override("font_size", 12)
		name_lbl.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		header.add_child(name_lbl)
		var stat_lbl := Label.new()
		stat_lbl.text = "%d HP-eq   Prod %d/t" % [int(total), int(production_rate)]
		stat_lbl.add_theme_font_size_override("font_size", 11)
		header.add_child(stat_lbl)
		section.add_child(header)

		section.add_child(_make_reserve_bar(severity))

		var band_lbl := Label.new()
		band_lbl.text = _severity_band_label(severity, has_demand)
		band_lbl.add_theme_font_size_override("font_size", 10)
		band_lbl.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
		section.add_child(band_lbl)

		_reserve_list.add_child(section)


## Fixed five-band gradient track (Red/Amber/Neutral/Green/Blue), center-anchored at zero net
## rate, with a colored marker (▲) at the current severity position — per
## economy_production_ui_handoff.md §7 Tab 2. Position AND marker color both encode severity
## (deliberate redundancy for colorblind accessibility, per that doc).
func _make_reserve_bar(severity: float) -> Control:
	var wrapper := Control.new()
	wrapper.custom_minimum_size = Vector2(0, 22)
	wrapper.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND

	var track := HBoxContainer.new()
	track.set_anchors_preset(Control.PRESET_TOP_WIDE)
	track.add_theme_constant_override("separation", 1)
	var band_colors: Array[Color] = [COLOR_RED, COLOR_AMBER, COLOR_NEUTRAL, COLOR_GREEN, COLOR_BLUE]
	for band_color: Color in band_colors:
		var seg := ColorRect.new()
		seg.color = band_color
		seg.custom_minimum_size = Vector2(0, 12)
		seg.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		track.add_child(seg)
	wrapper.add_child(track)

	# Marker position: clamp severity to [-0.3, 0.3] (a bit past the heavy bands at ±0.15) and
	# map linearly to [0, 1] across the track width.
	var t: float = clampf((severity + 0.3) / 0.6, 0.0, 1.0)
	var marker := Label.new()
	marker.text = "▲"
	marker.add_theme_font_size_override("font_size", 14)
	marker.add_theme_color_override("font_color", _severity_band_color(severity))
	marker.set_anchors_preset(Control.PRESET_TOP_LEFT)
	marker.anchor_left = t
	marker.anchor_right = t
	marker.offset_left = -7.0
	marker.offset_top = 10.0
	wrapper.add_child(marker)

	return wrapper


static func _severity_band_color(severity: float) -> Color:
	if severity <= SEVERITY_HEAVY_DEFICIT:
		return COLOR_RED
	if severity < SEVERITY_LIGHT_DEFICIT:
		return COLOR_AMBER
	if severity < SEVERITY_SLIGHT_SURPLUS:
		return COLOR_NEUTRAL
	if severity < SEVERITY_HEAVY_SURPLUS:
		return COLOR_GREEN
	return COLOR_BLUE


## Zero-demand (no production, no consumption, nothing banked) reads as a distinct label from
## genuinely-matched Neutral demand, per the doc's explicit "— no demand —" vs "(balanced)"
## distinction, even though both render at the same bar position.
static func _severity_band_label(severity: float, has_demand: bool) -> String:
	if not has_demand:
		return "— no demand —"
	if severity <= SEVERITY_HEAVY_DEFICIT:
		return "(heavy deficit)"
	if severity < SEVERITY_LIGHT_DEFICIT:
		return "(light deficit)"
	if severity < SEVERITY_SLIGHT_SURPLUS:
		return "(balanced)"
	if severity < SEVERITY_HEAVY_SURPLUS:
		return "(slight surplus)"
	return "(heavy surplus)"
