extends PanelContainer
## Diplomacy panel — side-docked, with Nations and Alliance sub-tabs.
## Nations tab lists all nations (player first, then AI) with flag + name.
## Alliance tab is placeholder for Phase 10.
## Purple accent (#7a4fb0) per UI wireframe.

var _nation_definitions: Array[Dictionary] = []
var _nation_by_id: Dictionary = {}
var _map_id: String = "western_europe_6"

signal nation_selected(nation_id: String)


func _ready() -> void:
	_load_nation_definitions()
	_populate_nations_list()


func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null("Margin/TabBar")
	if tabs_node == null:
		return
	if not tabs_node is TabContainer:
		push_warning("DiplomacyPanel: Margin/TabBar is not a TabContainer")
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_child_count()
	if count <= 1:
		return
	var current: int = tabs.current_tab
	var next: int = current + (1 if forward else -1)
	tabs.current_tab = posmod(next, count)


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


func _populate_nations_list() -> void:
	var list_container: VBoxContainer = get_node_or_null("Margin/TabBar/Nations/Scroll/ListContainer")
	if list_container == null:
		return

	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	var my_nation_id: String = GameState.get_my_nation_id()
	var sorted: Array[Dictionary] = []
	var others: Array[Dictionary] = []

	for def: Dictionary in _nation_definitions:
		if def.get("id", "") == my_nation_id:
			sorted.append(def)
		else:
			others.append(def)

	others.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return a.get("name", "") < b.get("name", "")
	)
	sorted.append_array(others)

	for def: Dictionary in sorted:
		var nation_id: String = def.get("id", "")
		var nation_name: String = def.get("name", nation_id)
		var flag_path: String = def.get("flag_path", "")
		var is_player: bool = (nation_id == my_nation_id)

		var item: Control = _make_nation_item(nation_id, nation_name, flag_path, is_player)
		list_container.add_child(item)


func _make_nation_item(nation_id: String, nation_name: String, flag_path: String, is_player: bool) -> Control:
	var container: HBoxContainer = HBoxContainer.new()
	container.custom_minimum_size.y = 40
	container.add_theme_constant_override("separation", 8)
	container.layout_mode = 2
	container.size_flags_horizontal = 3

	var flag_rect: TextureRect = TextureRect.new()
	flag_rect.custom_minimum_size = Vector2(48, 32)
	flag_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	flag_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	if not flag_path.is_empty() and ResourceLoader.exists(flag_path):
		flag_rect.texture = load(flag_path) as Texture2D
	else:
		flag_rect.modulate = Color(0.5, 0.5, 0.5, 1.0)
	container.add_child(flag_rect)

	var name_lbl: Label = Label.new()
	name_lbl.text = nation_name + (" (You)" if is_player else "")
	name_lbl.size_flags_horizontal = 3
	name_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	container.add_child(name_lbl)

	var btn: Button = Button.new()
	btn.add_theme_stylebox_override("normal", StyleBoxEmpty.new())
	btn.layout_mode = 2
	btn.size_flags_horizontal = 3
	btn.size_flags_vertical = 3
	btn.pressed.connect(func() -> void:
		nation_selected.emit(nation_id)
	)

	if container.get_parent() != null:
		container.get_parent().remove_child(container)
	btn.add_child(container)
	container.layout_mode = 2
	container.size_flags_horizontal = 3

	return btn