extends PanelContainer
## Production panel — side-docked, Templates/Reserve/Naval sub-tabs.
## All three tabs are empty placeholders this branch (Phase 9 Branch A) — Templates and
## Reserve get real content in Branch C, Naval stays a placeholder for the whole phase
## (naval combat isn't implemented yet).

signal close_requested()

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()


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
