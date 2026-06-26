extends PanelContainer
## Military panel — side-docked, with Land/Air/Naval sub-tabs.
## Land tab lists the player's land divisions from GameState.
## Air and Naval tabs are placeholders for Phase 12/13.

signal division_clicked(division_id: String)
signal close_requested()

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

var _division_items: Array[Dictionary] = []

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_refresh_land_list()
	EventBus.division_added.connect(func(_id: String) -> void: _refresh_land_list())
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_land_list())
	EventBus.division_removed.connect(func(_id: String) -> void: _refresh_land_list())


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
	if tabs_node == null:
		return
	if not tabs_node is TabContainer:
		push_warning("MilitaryPanel: ContentBody/TabBar is not a TabContainer")
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	var current: int = tabs.current_tab
	var next: int = current + (1 if forward else -1)
	tabs.current_tab = posmod(next, count)


func _refresh_land_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer")
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	var div_ids: Array = GameState.get_my_nation_divisions()
	for div_id: String in div_ids:
		var div_data: Dictionary = GameState.get_division(div_id)
		if div_data.is_empty():
			continue
		var item: Button = _make_division_item(div_id, div_data)
		list_container.add_child(item)


func _make_division_item(div_id: String, div_data: Dictionary) -> Button:
	var btn: Button = Button.new()
	btn.custom_minimum_size.y = 48
	btn.layout_mode = 2
	btn.size_flags_horizontal = 3
	btn.size_flags_vertical = 3

	var div_type: String = div_data.get("division_type", "infantry")
	var hp: float = float(div_data.get("hp", 100.0))
	var max_hp: float = float(div_data.get("max_hp", 100.0))
	var hp_pct: float = hp / max_hp if max_hp > 0 else 1.0

	var label_text: String = "%s [%s]\nHP: %.0f%%" % [div_id, div_type.capitalize(), hp_pct * 100.0]
	var lbl: Label = Label.new()
	lbl.text = label_text
	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl.layout_mode = 2
	lbl.size_flags_vertical = 3
	btn.add_child(lbl)

	btn.pressed.connect(func() -> void:
		division_clicked.emit(div_id)
		EventBus.division_selected.emit(div_id)
	)

	return btn
