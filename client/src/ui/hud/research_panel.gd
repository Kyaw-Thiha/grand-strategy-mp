extends PanelContainer
## Research panel — full-center overlay, with Infantry/Artillery/Armoured/Air/Naval/Economy sub-tabs.
## Content will be replaced when Phase 10 implements the research tree.
## Uses manual show/hide on the Pages Control (no TabContainer).


func _ready() -> void:
	_setup_tab_buttons()


func _setup_tab_buttons() -> void:
	var tab_btns: HBoxContainer = get_node_or_null("Margin/TabButtons") as HBoxContainer
	if tab_btns == null:
		return
	var btn_group := ButtonGroup.new()
	for i: int in range(tab_btns.get_child_count()):
		var btn: Button = tab_btns.get_child(i) as Button
		btn.button_group = btn_group
		btn.pressed.connect(_on_tab_button_pressed.bind(i))


func _on_tab_button_pressed(idx: int) -> void:
	var pages: Control = get_node_or_null("Margin/Pages") as Control
	if pages == null:
		return
	for i: int in range(pages.get_child_count()):
		(pages.get_child(i) as Control).visible = (i == idx)


func cycle_sub_tab(forward: bool) -> void:
	var pages: Control = get_node_or_null("Margin/Pages") as Control
	if pages == null:
		return
	var count: int = pages.get_child_count()
	if count <= 1:
		return
	var current: int = 0
	for i: int in range(count):
		if (pages.get_child(i) as Control).visible:
			current = i
			break
	var next: int = posmod(current + (1 if forward else -1), count)
	_on_tab_button_pressed(next)
	var tab_btns: HBoxContainer = get_node_or_null("Margin/TabButtons") as HBoxContainer
	if tab_btns != null and next < tab_btns.get_child_count():
		(tab_btns.get_child(next) as Button).button_pressed = true
