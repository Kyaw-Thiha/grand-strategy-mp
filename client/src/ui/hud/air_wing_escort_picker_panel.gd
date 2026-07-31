extends PanelContainer

signal close_requested()

var _escort_wing_id: String = ""
var _selected_bomber_id: String = ""
var _list_container: VBoxContainer
var _btn_confirm: Button

const BOMBER_TYPES := ["strategic_bomber", "tactical_bomber", "cas_plane", "dive_bomber", "naval_bomber"]


func _ready() -> void:
	var margin: MarginContainer = MarginContainer.new()
	margin.name = "Margin"
	margin.add_theme_constant_override("margin_left", 12)
	margin.add_theme_constant_override("margin_top", 12)
	margin.add_theme_constant_override("margin_right", 12)
	margin.add_theme_constant_override("margin_bottom", 12)
	margin.size_flags_horizontal = 3
	margin.size_flags_vertical = 3
	add_child(margin)

	var vbox: VBoxContainer = VBoxContainer.new()
	vbox.name = "VBox"
	vbox.size_flags_horizontal = 3
	vbox.size_flags_vertical = 3
	margin.add_child(vbox)

	var title: Label = Label.new()
	title.text = "Choose Bomber to Escort"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 14)
	vbox.add_child(title)

	var scroll: ScrollContainer = ScrollContainer.new()
	scroll.name = "Scroll"
	scroll.size_flags_horizontal = 3
	scroll.size_flags_vertical = 3
	scroll.custom_minimum_size = Vector2(300, 200)
	vbox.add_child(scroll)

	_list_container = VBoxContainer.new()
	_list_container.name = "ListContainer"
	_list_container.size_flags_horizontal = 3
	_list_container.size_flags_vertical = 3
	scroll.add_child(_list_container)

	var footer: HBoxContainer = HBoxContainer.new()
	footer.name = "Footer"
	footer.alignment = BoxContainer.ALIGNMENT_END
	vbox.add_child(footer)

	_btn_confirm = Button.new()
	_btn_confirm.name = "BtnConfirm"
	_btn_confirm.text = "Confirm"
	_btn_confirm.disabled = true
	_btn_confirm.pressed.connect(_on_confirm_pressed)
	footer.add_child(_btn_confirm)

	var btn_cancel: Button = Button.new()
	btn_cancel.name = "BtnCancel"
	btn_cancel.text = "Cancel"
	btn_cancel.pressed.connect(func() -> void: close_requested.emit())
	footer.add_child(btn_cancel)


func open_for_wing(wing_id: String) -> void:
	_escort_wing_id = wing_id
	_selected_bomber_id = ""
	if _btn_confirm != null:
		_btn_confirm.disabled = true
	_rebuild_list()


func _rebuild_list() -> void:
	if _list_container == null:
		return
	for child: Node in _list_container.get_children():
		_list_container.remove_child(child)
		child.queue_free()

	var my_nation: String = GameState.get_my_nation_id()
	for wing_data: Dictionary in GameState.get_air_wings_for_nation(my_nation):
		if not wing_data.get("aircraft_type", "") in BOMBER_TYPES:
			continue
		var ls: String = wing_data.get("lifecycle_state", "")
		if ls == "idle" or ls == "refuel":
			continue
		_list_container.add_child(_make_bomber_card(wing_data))


func _make_bomber_card(wing_data: Dictionary) -> PanelContainer:
	var card := PanelContainer.new()
	var label := Label.new()
	var wing_id: String = wing_data.get("wing_id", "")
	label.text = "%s x%d — %s %s" % [
		wing_data.get("aircraft_type", "").to_upper(),
		int(wing_data.get("count", 0)),
		wing_data.get("lifecycle_state", "").to_upper(),
		wing_data.get("home_airbase_province_id", ""),
	]
	card.add_child(label)
	card.gui_input.connect(func(event: InputEvent) -> void:
		var mb := event as InputEventMouseButton
		if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			_selected_bomber_id = wing_id
			if _btn_confirm != null:
				_btn_confirm.disabled = false
	)
	return card


func _on_confirm_pressed() -> void:
	if _escort_wing_id.is_empty() or _selected_bomber_id.is_empty():
		return
	CommandQueue.submit("ASSIGN_WING_MISSION", {
		"wing_id": _escort_wing_id,
		"mission": "escort",
		"target_id": _selected_bomber_id,
	})
	close_requested.emit()
