extends PanelContainer
## Military panel — side-docked, with Land/Air/Naval sub-tabs.
## Land tab tracks REAL division instances only (DEPLOYING = marshalling, DEPLOYED = fielded).
## Division Templates (the blueprint side) live in the Production panel instead, per
## economy_production_ui_handoff.md §7/§8 — this panel used to also show the template list,
## but that's been relocated, not duplicated (Phase 9 Task C amendment).
## Air and Naval tabs are placeholders for Phase 12/13.

signal close_requested()
signal division_clicked(division_id: String)

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

@onready var _close_button: Button = %CloseButton
@onready var _deploying_list: VBoxContainer = %DeployingList


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_inject_land_header()
	_inject_air_header()
	_refresh_deployed_list()
	_refresh_air_list()
	EventBus.air_wing_added.connect(func(_id: String) -> void: _refresh_air_list())
	EventBus.air_wing_updated.connect(func(_id: String) -> void: _refresh_air_list())
	EventBus.air_wing_removed.connect(func(_id: String) -> void: _refresh_air_list())
	EventBus.marshalling_updated.connect(_refresh_deploying)
	_refresh_deploying()

	EventBus.division_added.connect(func(_id: String) -> void: _refresh_deployed_list())
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_deployed_list())
	EventBus.division_removed.connect(func(_id: String) -> void: _refresh_deployed_list())

	_await_map_ready_then_refresh_deployed()


## The initial _refresh_deployed_list() above resolves every division to "Unknown Location" when
## this panel is built before the map has finished loading (the common case — game start divisions
## exist before the player ever interacts with anything). Two things have to actually be true for
## get_province_at_world_position() to work, not just "MapLoader loaded": (1) MapLoader.
## is_map_loaded() — confirmed synchronously first since load_map() is fully synchronous and an
## await on the signal alone would hang forever if it already fired; and (2) at least one physics
## frame has processed since the province click-area Area2D shapes were added to the tree — Godot's
## physics broadphase doesn't index newly-added collision shapes until the next physics step, so a
## same-frame intersect_point() query can miss them even with the map otherwise fully loaded. This
## is exactly why province grouping "started working" only once something else (raising a
## division) happened to trigger a refresh late enough for both conditions to be true by accident.
func _await_map_ready_then_refresh_deployed() -> void:
	var map_loader: Node = _get_map_loader()
	if map_loader == null:
		return
	if map_loader.has_method("is_map_loaded") and not map_loader.is_map_loaded():
		if not map_loader.has_signal("map_loaded"):
			return
		await map_loader.map_loaded
	await get_tree().physics_frame
	if not is_inside_tree():
		return
	_refresh_deployed_list()


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


# ── Land header ────────────────────────────────────────────────────────────

func _inject_land_header() -> void:
	var title_lbl: Label = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Header/HBox/Title") as Label
	if title_lbl != null:
		title_lbl.text = "LAND FORCES"


# ── Deploying divisions ────────────────────────────────────────────────────

func _refresh_deploying() -> void:
	for child in _deploying_list.get_children():
		child.queue_free()
	if GameState.marshalling_divisions.is_empty():
		var empty_label := Label.new()
		empty_label.text = "No divisions currently marshalling.\nRaise one from the Production panel."
		_deploying_list.add_child(empty_label)
		return
	for mid: String in GameState.marshalling_divisions:
		_deploying_list.add_child(_make_deploying_item(mid, GameState.marshalling_divisions[mid]))


## Card styling matches _make_division_item's DEPLOYED rows underneath, so the Land tab reads as
## one consistent list rather than two visually different sections. Reuses the same
## ProvincePickerButton component as the Production panel's per-template Raise row — the home
## province chosen at raise time is freely overridable up until FORCE_DEPLOY (see
## unit_production_system.ts's updateMarshallingProvince — MARSHALLING_RATE is flat/national, so
## changing province has no effect on fill rate, only on where the division appears once
## deployed).
func _make_deploying_item(mid: String, data: Dictionary) -> Control:
	var pct: float = float(data.get("aggregate_hp_pct", 0.0)) * 100.0

	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 2)
	card.add_child(vbox)

	var by_type: Dictionary = {}
	for slot: Dictionary in data.get("slots", []):
		if float(slot.get("current_hp", 0.0)) >= 100.0:
			continue
		var ut: String = slot.get("unit_type", "")
		by_type[ut] = by_type.get(ut, 0) + 1
	var missing_parts: Array[String] = []
	for ut: String in by_type:
		missing_parts.append("%dx %s" % [by_type[ut], ut])

	var title_lbl := Label.new()
	title_lbl.text = "%s   %d%% agg. HP" % [data.get("template_id", ""), int(pct)]
	title_lbl.add_theme_font_size_override("font_size", 13)
	vbox.add_child(title_lbl)

	var missing_lbl := Label.new()
	missing_lbl.text = "Missing: %s" % (", ".join(missing_parts) if missing_parts.size() > 0 else "none")
	missing_lbl.add_theme_font_size_override("font_size", 11)
	missing_lbl.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	vbox.add_child(missing_lbl)

	var action_row := HBoxContainer.new()

	var province_picker := ProvincePickerButton.new()
	province_picker.selected_province_id = data.get("home_province_id", "")
	province_picker.custom_minimum_size = Vector2(100, 24)
	province_picker.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	province_picker.province_changed.connect(func(pid: String) -> void:
		CommandQueue.submit("UPDATE_MARSHALLING_PROVINCE", {"marshalling_id": mid, "home_province_id": pid})
	)
	action_row.add_child(province_picker)

	var btn_cancel := Button.new()
	btn_cancel.text = "Cancel"
	btn_cancel.pressed.connect(func() -> void:
		CommandQueue.submit("CANCEL_MARSHALLING", {"marshalling_id": mid})
	)
	action_row.add_child(btn_cancel)

	var btn_deploy := Button.new()
	btn_deploy.text = "Force Deploy"
	btn_deploy.disabled = pct < 50.0
	btn_deploy.pressed.connect(func() -> void:
		CommandQueue.submit("FORCE_DEPLOY", {"marshalling_id": mid})
	)
	action_row.add_child(btn_deploy)

	vbox.add_child(action_row)
	return card


# ── Deployed divisions ──────────────────────────────────────────────────────
# Real, currently-fielded division instances — the battlefield-instance counterpart to
# Production's Templates tab (economy_production_ui_handoff.md §8). Reuses the Scroll/
# ListContainer node the template list previously rendered into, now vacated since templates
# moved to the Production panel. Clicking a row centers/selects it on the strategic map,
# consistent with STRATEGIC_COMBAT.md's existing division-dot click behavior, rather than
# opening another overlay.

func _refresh_deployed_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer")
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()
	var div_ids: Array = GameState.get_my_nation_divisions()
	if div_ids.is_empty():
		var empty_label := Label.new()
		empty_label.text = "No divisions currently fielded."
		list_container.add_child(empty_label)
		return

	# Primary grouping is by current location (province), per-province subheading, so the
	# player can see at a glance where their forces actually are — a "Stack (N)" sub-grouping
	# still applies within a province for divisions sharing a stack there.
	var by_province: Dictionary = {}
	for div_id: String in div_ids:
		var div_data: Dictionary = GameState.get_division(div_id)
		if div_data.is_empty():
			continue
		if div_data.get("combat_state", "") == "destroyed":
			continue
		var pid: String = _resolve_division_province(div_data)
		if not by_province.has(pid):
			by_province[pid] = []
		by_province[pid].append({ "id": div_id, "data": div_data })

	var province_ids: Array = by_province.keys()
	province_ids.sort_custom(func(a: String, b: String) -> bool:
		return _resolve_province_name(a) < _resolve_province_name(b)
	)
	for pid: String in province_ids:
		var province_margin := MarginContainer.new()
		province_margin.add_theme_constant_override("margin_top", 10)
		province_margin.add_theme_constant_override("margin_bottom", 4)
		var province_lbl := Label.new()
		province_lbl.text = _resolve_province_name(pid)
		province_lbl.add_theme_font_size_override("font_size", 15)
		province_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
		province_margin.add_child(province_lbl)
		list_container.add_child(province_margin)
		_add_grouped_division_items(list_container, by_province[pid])


## Splits one province's members into stack groups (with a "Stack (N)" sub-label) and solo
## entries, same shape _refresh_deployed_list used before province-grouping was added.
func _add_grouped_division_items(list_container: VBoxContainer, members_in_province: Array) -> void:
	var stacks_map: Dictionary = {}
	var solo: Array = []
	for entry: Dictionary in members_in_province:
		var sid: String = entry.data.get("stack_id", "")
		if sid.is_empty():
			solo.append(entry)
		else:
			if not stacks_map.has(sid):
				stacks_map[sid] = []
			stacks_map[sid].append(entry)
	for sid: String in stacks_map:
		var members: Array = stacks_map[sid]
		members.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return int(a.data.get("stack_position", 0)) < int(b.data.get("stack_position", 0))
		)
		var group_lbl: Label = Label.new()
		group_lbl.text = "Stack (%d)" % members.size()
		group_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
		group_lbl.add_theme_font_size_override("font_size", 11)
		list_container.add_child(group_lbl)
		for member: Dictionary in members:
			var item: Button = _make_division_item(member.id, member.data)
			list_container.add_child(item)
	for entry: Dictionary in solo:
		var item: Button = _make_division_item(entry.id, entry.data)
		list_container.add_child(item)


## Resolves a division's current province directly from its position (position_lng/lat, already
## reliably synced — the same fields military_system.gd uses to place map icons), via
## MapLoader.get_province_at_world_position(). Deliberately NOT going through
## division.subprovince_id/get_subprovince_data() any more: subprovince_id is only ever
## broadcast to the client on the tick it actually changes (see GameRoom.ts's gameTick()
## subprovinceChanged tracking), which is fragile for this purpose and left every division
## reading as unresolved. Position-based lookup uses the exact same physics query already
## powering province click detection (map_interaction.gd) — no separate data path to go stale.
func _resolve_division_province(div_data: Dictionary) -> String:
	var lng: float = float(div_data.get("position_lng", 0.0))
	var lat: float = float(div_data.get("position_lat", 0.0))
	var map_loader: Node = _get_map_loader()
	if map_loader == null or not map_loader.has_method("project_lng_lat") or not map_loader.has_method("get_province_at_world_position"):
		return ""
	var world_pos: Vector2 = map_loader.project_lng_lat(lng, lat)
	return map_loader.get_province_at_world_position(world_pos)


func _resolve_province_name(province_id: String) -> String:
	if province_id.is_empty():
		return "Unknown Location"
	var map_loader: Node = _get_map_loader()
	if map_loader != null and map_loader.has_method("get_province_data"):
		var pd: Dictionary = map_loader.get_province_data(province_id)
		if not pd.is_empty():
			return pd.get("name", province_id)
	return province_id


## Same fallback lookup pattern used elsewhere (see production_panel.gd's ProvincePickerButton
## and strategic_bombing_detail_panel.gd) for resolving a MapLoader reference outside of a scene
## that already owns one.
func _get_map_loader() -> Node:
	# MapLoader is nested under the "Game" scene root (game.tscn: Game > MapLoader), not a direct
	# child of the true scene tree root — find_child(recursive=true) is required, matching
	# bombing_detail_panel.gd's version of this same lookup. A one-level get_children() scan
	# (the pattern this used to copy from strategic_bombing_detail_panel.gd) never finds it,
	# which is why province grouping was always showing "Unknown Location."
	var main_loop: MainLoop = Engine.get_main_loop()
	if main_loop == null:
		return null
	return main_loop.root.find_child("MapLoader", true, false)


func _make_division_item(div_id: String, div_data: Dictionary) -> Button:
	var btn: Button = Button.new()
	btn.custom_minimum_size.y = 48
	btn.layout_mode = 2
	btn.size_flags_horizontal = 3
	btn.size_flags_vertical = 3
	var div_type: String = div_data.get("division_type", "infantry")
	var hp: float = float(div_data.get("hp", 100.0))
	var label_text: String = "%s [%s]\nHP: %.0f%%" % [div_id, div_type.capitalize(), hp]
	var lbl: Label = Label.new()
	lbl.text = label_text
	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl.layout_mode = 2
	lbl.size_flags_vertical = 3
	btn.add_child(lbl)
	btn.pressed.connect(func() -> void:
		division_clicked.emit(div_id)
		EventBus.division_center_camera_requested.emit(div_id)
		EventBus.division_selected.emit(div_id)
	)
	return btn


# ── Air tab ────────────────────────────────────────────────────────────────

func _inject_air_header() -> void:
	var hbox: HBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Air/HeaderAir/HBoxAir") as HBoxContainer
	if hbox == null:
		return
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(spacer)
	var add_btn := Button.new()
	add_btn.text = "+"
	add_btn.custom_minimum_size = Vector2(28, 28)
	add_btn.tooltip_text = "Spawn new air wing"
	add_btn.pressed.connect(func() -> void:
		EventBus.air_wing_spawn_open_requested.emit("")
	)
	hbox.add_child(add_btn)


func _refresh_air_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Air/ScrollAir/ListContainerAir") as VBoxContainer
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	var my_nation: String = GameState.get_my_nation_id()
	var by_airbase: Dictionary = {}
	for wing_data: Dictionary in GameState.get_air_wings_for_nation(my_nation):
		var base_id: String = wing_data.get("home_airbase_province_id", "")
		if not by_airbase.has(base_id):
			by_airbase[base_id] = []
		by_airbase[base_id].append(wing_data)

	var sorted_bases: Array = by_airbase.keys()
	sorted_bases.sort()
	for base_id: String in sorted_bases:
		var group_lbl := Label.new()
		group_lbl.text = base_id
		group_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
		group_lbl.add_theme_font_size_override("font_size", 11)
		list_container.add_child(group_lbl)
		for wing_data: Dictionary in by_airbase[base_id]:
			list_container.add_child(_make_air_wing_item(wing_data))


func _make_air_wing_item(wing_data: Dictionary) -> Button:
	var btn := Button.new()
	btn.custom_minimum_size.y = 40
	btn.size_flags_horizontal = 3
	var wing_id: String = wing_data.get("wing_id", "")
	var readiness: float = float(wing_data.get("combat_readiness", 1.0))
	btn.text = "%s x%d   %.0f%%" % [
		wing_data.get("aircraft_type", "").to_upper(),
		int(wing_data.get("count", 0)),
		readiness * 100.0,
	]
	btn.pressed.connect(func() -> void:
		EventBus.air_wing_selected.emit(wing_id)
	)
	return btn


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
