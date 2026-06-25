extends PanelContainer
## Research panel — full-center overlay, with Infantry/Artillery/Armoured/Air/Naval/Economy sub-tabs.
## Content will be replaced when Phase 10 implements the research tree.


func _ready() -> void:
	_setup_tab_buttons()


func _setup_tab_buttons() -> void:
	var tc: TabContainer = get_node_or_null("Margin/TabBar") as TabContainer
	var tab_btns: HBoxContainer = get_node_or_null("Margin/TabButtons") as HBoxContainer
	if tc == null or tab_btns == null:
		return
	var btn_group := ButtonGroup.new()
	for i: int in range(tab_btns.get_child_count()):
		var btn: Button = tab_btns.get_child(i) as Button
		btn.button_group = btn_group
		btn.pressed.connect(_on_tab_button_pressed.bind(i))
	tc.tab_changed.connect(_sync_tab_button)


func _on_tab_button_pressed(idx: int) -> void:
	var tc: TabContainer = get_node_or_null("Margin/TabBar") as TabContainer
	if tc != null:
		tc.current_tab = idx


func _sync_tab_button(idx: int) -> void:
	var tab_btns: HBoxContainer = get_node_or_null("Margin/TabButtons") as HBoxContainer
	if tab_btns == null or idx >= tab_btns.get_child_count():
		return
	(tab_btns.get_child(idx) as Button).button_pressed = true


func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null("Margin/TabBar")
	if tabs_node == null:
		return
	if not tabs_node is TabContainer:
		push_warning("ResearchPanel: Margin/TabBar is not a TabContainer")
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	var current: int = tabs.current_tab
	var next: int = current + (1 if forward else -1)
	tabs.current_tab = posmod(next, count)