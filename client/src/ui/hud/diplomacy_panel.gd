extends PanelContainer
## Diplomacy panel — side-docked Nations and Alliance views.
## Displays server-owned GameState relations and submits intents through DiplomacySystem.

signal nation_selected(nation_id: String)
signal close_requested()

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"
const _NATIONS_LIST_PATH: String = "Margin/VBox/ContentBody/TabBar/Nations/Scroll/ListContainer"
const _ALLIANCE_LIST_PATH: String = "Margin/VBox/ContentBody/TabBar/Alliance/Scroll/ListContainer"
const _TRADE_ROUTES_LIST_PATH: String = "Margin/VBox/ContentBody/TabBar/TradeRoutes/Scroll/ListContainer"
const _MAX_ALLIANCE_SIZE: int = 5

var _nation_definitions: Array[Dictionary] = []
var _nation_by_id: Dictionary = {}
var _map_id: String = "western_europe_6"

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_load_nation_definitions()
	if has_node("/root/EventBus"):
		EventBus.relation_changed.connect(func(_from_id: String, _to_id: String) -> void:
			_populate_pages()
		)
		EventBus.lobby_state_updated.connect(_populate_pages)
		EventBus.phase_changed.connect(func(_phase: String) -> void:
			_populate_pages()
		)
		EventBus.trade_routes_updated.connect(_populate_trade_routes_page)
	_populate_pages()


## Wires custom tab buttons to the hidden TabContainer.
## Parameters: none.
## Returns: nothing.
func _setup_tab_buttons() -> void:
	var tabs: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	var tab_buttons: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tabs == null or tab_buttons == null:
		return
	var button_group: ButtonGroup = ButtonGroup.new()
	for index: int in range(tab_buttons.get_child_count()):
		var button: Button = tab_buttons.get_child(index) as Button
		button.button_group = button_group
		button.pressed.connect(_on_tab_button_pressed.bind(index))
	tabs.tab_changed.connect(_sync_tab_button)
	_sync_tab_button(tabs.current_tab)


func _on_tab_button_pressed(index: int) -> void:
	var tabs: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	if tabs != null:
		tabs.current_tab = index


func _sync_tab_button(index: int) -> void:
	var tab_buttons: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tab_buttons == null or index >= tab_buttons.get_child_count():
		return
	var button: Button = tab_buttons.get_child(index) as Button
	button.button_pressed = true


## Cycles between Nations and Alliance tabs.
## Parameters:
## - forward: true to move right, false to move left.
## Returns: nothing.
func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null(_CONTENT_PATH + "/TabBar")
	if tabs_node == null:
		return
	if not tabs_node is TabContainer:
		push_warning("DiplomacyPanel: ContentBody/TabBar is not a TabContainer")
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	var current: int = tabs.current_tab
	var next: int = current + (1 if forward else -1)
	tabs.current_tab = posmod(next, count)


## Loads static nation metadata used for names and flags.
## Parameters: none.
## Returns: nothing.
func _load_nation_definitions() -> void:
	_nation_definitions.clear()
	_nation_by_id.clear()

	var path: String = "res://assets/data/%s/nations.json" % _map_id
	if not FileAccess.file_exists(path):
		push_warning("DiplomacyPanel: missing nation metadata: " + path)
		return

	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		push_warning("DiplomacyPanel: invalid nation metadata: " + path)
		return

	var raw_definitions: Array = parsed
	for raw_definition: Variant in raw_definitions:
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty():
			continue
		_nation_definitions.append(definition)
		_nation_by_id[nation_id] = definition


## Rebuilds both diplomacy pages from current GameState.
## Parameters: none.
## Returns: nothing.
func _populate_pages() -> void:
	_populate_nations_page()
	_populate_alliance_page()
	_populate_trade_routes_page()


func _populate_nations_page() -> void:
	var list_container: VBoxContainer = get_node_or_null(_NATIONS_LIST_PATH) as VBoxContainer
	if list_container == null:
		return
	_clear_container(list_container)

	var my_nation_id: String = GameState.get_my_nation_id()
	if my_nation_id.is_empty():
		_add_empty_label(list_container, "SELECT A NATION")
		return

	var alliance_ids: Array[String] = _get_sorted_nation_ids(_get_alliance_for(my_nation_id), my_nation_id)
	var neutral_ids: Array[String] = []
	var enemy_ids: Array[String] = []

	for definition: Dictionary in _nation_definitions:
		var nation_id: String = definition.get("id", "")
		if nation_id == my_nation_id or alliance_ids.has(nation_id):
			continue
		var stance: String = _get_stance(my_nation_id, nation_id)
		if stance == "war":
			enemy_ids.append(nation_id)
		else:
			neutral_ids.append(nation_id)

	neutral_ids = _get_sorted_nation_ids(neutral_ids)
	enemy_ids = _get_sorted_nation_ids(enemy_ids)

	_add_section_header(
		list_container,
		"ALLIANCE %d / %d" % [alliance_ids.size(), _MAX_ALLIANCE_SIZE],
		[{"label": "Quit", "action": "quit_alliance", "target": "", "disabled": alliance_ids.size() <= 1}]
	)
	for nation_id: String in alliance_ids:
		var actions: Array[Dictionary] = []
		if nation_id != my_nation_id:
			actions.append({"label": "Kick", "action": "kick", "target": nation_id})
		_add_nation_row(list_container, nation_id, nation_id == my_nation_id, actions)

	_add_section_header(list_container, "NEUTRAL", [])
	for nation_id: String in neutral_ids:
		_add_nation_row(list_container, nation_id, false, [
			{"label": "Ally", "action": "invite", "target": nation_id},
			{"label": "War", "action": "declare_war", "target": nation_id},
		])

	_add_section_header(list_container, "ENEMY", [])
	for nation_id: String in enemy_ids:
		_add_nation_row(list_container, nation_id, false, [
			{"label": "Peace", "action": "make_peace", "target": nation_id},
		])


func _populate_alliance_page() -> void:
	var list_container: VBoxContainer = get_node_or_null(_ALLIANCE_LIST_PATH) as VBoxContainer
	if list_container == null:
		return
	_clear_container(list_container)

	var my_nation_id: String = GameState.get_my_nation_id()
	if my_nation_id.is_empty():
		_add_empty_label(list_container, "SELECT A NATION")
		return

	var groups: Array[Array] = _get_alliance_groups()
	var my_group: Array[String] = []
	var other_groups: Array[Array] = []
	for group: Array in groups:
		if group.has(my_nation_id):
			my_group.assign(group)
		else:
			other_groups.append(group)

	other_groups.sort_custom(func(group_a: Array, group_b: Array) -> bool:
		var stance_a: String = _get_stance(my_nation_id, str(group_a[0]))
		var stance_b: String = _get_stance(my_nation_id, str(group_b[0]))
		if stance_a != stance_b:
			return _stance_sort_rank(stance_a) < _stance_sort_rank(stance_b)
		return _get_nation_name(str(group_a[0])) < _get_nation_name(str(group_b[0]))
	)

	_add_section_header(
		list_container,
		"MY ALLIANCE %d / %d" % [my_group.size(), _MAX_ALLIANCE_SIZE],
		[{"label": "Quit", "action": "quit_alliance", "target": "", "disabled": my_group.size() <= 1}]
	)
	for nation_id: String in my_group:
		var actions: Array[Dictionary] = []
		if nation_id != my_nation_id:
			actions.append({"label": "Kick", "action": "kick", "target": nation_id})
		_add_nation_row(list_container, nation_id, nation_id == my_nation_id, actions)

	var alliance_number: int = 1
	for group: Array in other_groups:
		if group.is_empty():
			continue
		var representative_id: String = str(group[0])
		var stance: String = _get_stance(my_nation_id, representative_id)
		var header_actions: Array[Dictionary] = []
		if stance == "war":
			header_actions.append({"label": "Peace", "action": "make_peace", "target": representative_id})
		else:
			header_actions.append({"label": "War", "action": "declare_war", "target": representative_id})
		_add_section_header(
			list_container,
			"ALLIANCE %d (%s)" % [alliance_number, stance.to_upper()],
			header_actions
		)
		for raw_nation_id: Variant in group:
			var nation_id: String = str(raw_nation_id)
			var actions: Array[Dictionary] = []
			if stance != "war":
				actions.append({"label": "Ally", "action": "invite", "target": nation_id})
			_add_nation_row(list_container, nation_id, false, actions)
		alliance_number += 1


## Trade Routes tab — the one and only place trade routes are created, accepted, rejected,
## or ended. Economy → My Trade only mirrors this read-only.
func _populate_trade_routes_page() -> void:
	var list_container: VBoxContainer = get_node_or_null(_TRADE_ROUTES_LIST_PATH) as VBoxContainer
	if list_container == null:
		return
	_clear_container(list_container)

	var my_nation_id: String = GameState.get_my_nation_id()
	if my_nation_id.is_empty():
		_add_empty_label(list_container, "SELECT A NATION")
		return

	_add_section_header(list_container, "MY TRADE ROUTES", [])
	var my_routes: Array = GameState.get_my_trade_routes()
	if my_routes.is_empty():
		_add_empty_label(list_container, "No trade routes yet.")
	else:
		for route: Dictionary in my_routes:
			_add_trade_route_row(list_container, route, my_nation_id)

	var propose_margin := MarginContainer.new()
	propose_margin.add_theme_constant_override("margin_top", 10)
	var propose_btn := Button.new()
	propose_btn.text = "+ Propose New Route"
	propose_btn.pressed.connect(func() -> void: EventBus.propose_trade_route_open_requested.emit())
	propose_margin.add_child(propose_btn)
	list_container.add_child(propose_margin)


func _add_trade_route_row(parent: VBoxContainer, route: Dictionary, my_nation_id: String) -> void:
	var route_id: String = str(route.get("route_id", ""))
	var status: String = str(route.get("status", ""))
	var is_recipient: bool = route.get("nation_b_id", "") == my_nation_id
	var partner_id: String = route.get("nation_b_id", "") if route.get("nation_a_id", "") == my_nation_id else route.get("nation_a_id", "")

	var row: HBoxContainer = HBoxContainer.new()
	row.custom_minimum_size = Vector2(0, 36)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)

	var label: Label = Label.new()
	label.text = "%s   %s %d/t <-> %s %d/t   %s" % [
		_get_nation_name(partner_id),
		str(route.get("a_sends_resource", "")).capitalize(), int(route.get("a_sends_rate", 0)),
		str(route.get("b_sends_resource", "")).capitalize(), int(route.get("b_sends_rate", 0)),
		status.capitalize(),
	]
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)

	if status == "proposed" and is_recipient:
		var accept_btn := Button.new()
		accept_btn.text = "Accept"
		accept_btn.pressed.connect(func() -> void:
			CommandQueue.submit("RESPOND_TRADE_ROUTE", {"route_id": route_id, "accept": true})
		)
		row.add_child(accept_btn)
		var reject_btn := Button.new()
		reject_btn.text = "Reject"
		reject_btn.pressed.connect(func() -> void:
			CommandQueue.submit("RESPOND_TRADE_ROUTE", {"route_id": route_id, "accept": false})
		)
		row.add_child(reject_btn)
	elif status == "proposed":
		var cancel_btn := Button.new()
		cancel_btn.text = "Cancel"
		cancel_btn.pressed.connect(func() -> void:
			CommandQueue.submit("END_TRADE_ROUTE", {"route_id": route_id})
		)
		row.add_child(cancel_btn)
	else:
		var end_btn := Button.new()
		end_btn.text = "End"
		end_btn.pressed.connect(func() -> void:
			CommandQueue.submit("END_TRADE_ROUTE", {"route_id": route_id})
		)
		row.add_child(end_btn)


func _add_section_header(parent: VBoxContainer, title: String, action_specs: Array[Dictionary]) -> void:
	var panel: PanelContainer = PanelContainer.new()
	panel.custom_minimum_size = Vector2(0, 34)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(panel)

	var row: HBoxContainer = HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	panel.add_child(row)

	var accent: ColorRect = ColorRect.new()
	accent.custom_minimum_size = Vector2(3, 22)
	accent.color = Color(0.48, 0.31, 0.69, 1.0)
	row.add_child(accent)

	var label: Label = Label.new()
	label.text = title
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 13)
	row.add_child(label)

	for action_spec: Dictionary in action_specs:
		row.add_child(_make_action_button(action_spec))


func _add_nation_row(parent: VBoxContainer, nation_id: String, is_player: bool, action_specs: Array[Dictionary]) -> void:
	var row: HBoxContainer = HBoxContainer.new()
	row.custom_minimum_size = Vector2(0, 42)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)

	var flag_rect: TextureRect = TextureRect.new()
	flag_rect.custom_minimum_size = Vector2(42, 28)
	flag_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	flag_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	var flag_path: String = _get_nation_flag_path(nation_id)
	if not flag_path.is_empty() and ResourceLoader.exists(flag_path):
		flag_rect.texture = load(flag_path) as Texture2D
	else:
		flag_rect.modulate = Color(0.5, 0.5, 0.5, 1.0)
	row.add_child(flag_rect)

	var name_label: Label = Label.new()
	name_label.text = _get_nation_name(nation_id) + (" (You)" if is_player else "")
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(name_label)

	for action_spec: Dictionary in action_specs:
		row.add_child(_make_action_button(action_spec))


func _make_action_button(action_spec: Dictionary) -> Button:
	var button: Button = Button.new()
	button.custom_minimum_size = Vector2(56, 28)
	button.text = action_spec.get("label", "")
	button.disabled = bool(action_spec.get("disabled", false))
	var action: String = action_spec.get("action", "")
	var target: String = action_spec.get("target", "")
	button.pressed.connect(func() -> void:
		DiplomacySystem.submit_action(action, target)
	)
	return button


func _add_empty_label(parent: VBoxContainer, message: String) -> void:
	var label: Label = Label.new()
	label.text = message
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	label.add_theme_font_size_override("font_size", 14)
	parent.add_child(label)


func _clear_container(container: Node) -> void:
	for child: Node in container.get_children():
		child.queue_free()


func _get_alliance_for(nation_id: String) -> Array[String]:
	var alliance: Array[String] = [nation_id]
	var visited: Dictionary = {nation_id: true}
	var stack: Array[String] = [nation_id]
	while not stack.is_empty():
		var current: String = stack.pop_back()
		for definition: Dictionary in _nation_definitions:
			var candidate_id: String = definition.get("id", "")
			if candidate_id.is_empty() or visited.has(candidate_id):
				continue
			if _get_stance(current, candidate_id) == "alliance":
				visited[candidate_id] = true
				alliance.append(candidate_id)
				stack.append(candidate_id)
	return alliance


func _get_alliance_groups() -> Array[Array]:
	var groups: Array[Array] = []
	var visited: Dictionary = {}
	for definition: Dictionary in _nation_definitions:
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty() or visited.has(nation_id):
			continue
		var group: Array[String] = _get_alliance_for(nation_id)
		for group_nation_id: String in group:
			visited[group_nation_id] = true
		group = _get_sorted_nation_ids(group)
		groups.append(group)
	return groups


func _get_sorted_nation_ids(nation_ids: Array, priority_nation_id: String = "") -> Array[String]:
	var sorted_ids: Array[String] = []
	for raw_id: Variant in nation_ids:
		var nation_id: String = str(raw_id)
		if not nation_id.is_empty():
			sorted_ids.append(nation_id)
	sorted_ids.sort_custom(func(a: String, b: String) -> bool:
		if a == priority_nation_id:
			return true
		if b == priority_nation_id:
			return false
		return _get_nation_name(a) < _get_nation_name(b)
	)
	return sorted_ids


func _get_stance(from_id: String, to_id: String) -> String:
	if from_id == to_id:
		return "alliance"
	var relation: Dictionary = GameState.get_relation(from_id, to_id)
	return str(relation.get("stance", "neutral"))


func _stance_sort_rank(stance: String) -> int:
	if stance == "neutral":
		return 0
	if stance == "war":
		return 1
	return 2


func _get_nation_name(nation_id: String) -> String:
	var definition: Dictionary = _nation_by_id.get(nation_id, {})
	return definition.get("name", nation_id)


func _get_nation_flag_path(nation_id: String) -> String:
	var definition: Dictionary = _nation_by_id.get(nation_id, {})
	return definition.get("flag_path", "")
