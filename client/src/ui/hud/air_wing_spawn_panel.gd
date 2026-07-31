extends PanelContainer

signal close_requested()

var _type_option: OptionButton
var _count_label: Label
var _btn_confirm: Button
var _count: int = 10

const SPAWNABLE_TYPES := ["fighter", "heavy_fighter", "cas_plane", "dive_bomber",
	"tactical_bomber", "strategic_bomber", "naval_bomber", "recon_plane"]


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
	title.text = "New Wing"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 14)
	vbox.add_child(title)

	var type_row: HBoxContainer = HBoxContainer.new()
	type_row.name = "TypeRow"
	vbox.add_child(type_row)

	var type_lbl: Label = Label.new()
	type_lbl.text = "Type: "
	type_row.add_child(type_lbl)

	_type_option = OptionButton.new()
	_type_option.name = "TypeOptionButton"
	_type_option.size_flags_horizontal = 3
	for i: int in range(SPAWNABLE_TYPES.size()):
		_type_option.add_item(SPAWNABLE_TYPES[i].replace("_", " ").capitalize(), i)
		_type_option.set_item_metadata(i, SPAWNABLE_TYPES[i])
	type_row.add_child(_type_option)

	var count_row: HBoxContainer = HBoxContainer.new()
	count_row.name = "CountRow"
	vbox.add_child(count_row)

	var btn_minus: Button = Button.new()
	btn_minus.name = "BtnMinus"
	btn_minus.text = "−10"
	btn_minus.custom_minimum_size = Vector2(40, 0)
	btn_minus.pressed.connect(func() -> void:
		_count = max(0, _count - 10)
		_refresh_count_label()
	)
	count_row.add_child(btn_minus)

	_count_label = Label.new()
	_count_label.name = "CountLabel"
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_label.add_theme_font_size_override("font_size", 14)
	_count_label.size_flags_horizontal = 3
	_count_label.text = "10"
	count_row.add_child(_count_label)

	var btn_plus: Button = Button.new()
	btn_plus.name = "BtnPlus"
	btn_plus.text = "+10"
	btn_plus.custom_minimum_size = Vector2(40, 0)
	btn_plus.pressed.connect(func() -> void:
		_count += 10
		_refresh_count_label()
	)
	count_row.add_child(btn_plus)

	var capital_row: HBoxContainer = HBoxContainer.new()
	capital_row.name = "CapitalRow"
	vbox.add_child(capital_row)

	var capital_lbl: Label = Label.new()
	capital_lbl.text = "Spawns at: " + _resolve_capital_display()
	capital_lbl.add_theme_font_size_override("font_size", 11)
	capital_lbl.add_theme_color_override("font_color", Color(0.55, 0.55, 0.55, 1))
	capital_row.add_child(capital_lbl)

	var footer: HBoxContainer = HBoxContainer.new()
	footer.name = "Footer"
	footer.alignment = BoxContainer.ALIGNMENT_END
	vbox.add_child(footer)

	_btn_confirm = Button.new()
	_btn_confirm.name = "BtnConfirm"
	_btn_confirm.text = "Confirm"
	_btn_confirm.pressed.connect(_on_confirm_pressed)
	footer.add_child(_btn_confirm)

	var btn_cancel: Button = Button.new()
	btn_cancel.name = "BtnCancel"
	btn_cancel.text = "Cancel"
	btn_cancel.pressed.connect(func() -> void: close_requested.emit())
	footer.add_child(btn_cancel)


func open_spawn_modal() -> void:
	_count = 10
	_refresh_count_label()
	if _type_option != null:
		_type_option.select(0)


func _refresh_count_label() -> void:
	if _count_label != null:
		_count_label.text = str(_count)


func _on_confirm_pressed() -> void:
	if _type_option == null:
		return
	var aircraft_type: String = _type_option.get_item_metadata(_type_option.selected)
	var wing_id: String = "wing_" + str(Time.get_unix_time_from_system()) + "_" + str(randi())
	var my_nation: String = GameState.get_my_nation_id()
	var capital_province_id: String = _resolve_capital_province_id(my_nation)
	if capital_province_id.is_empty():
		return
	CommandQueue.submit("CREATE_WING", {
		"wing_id": wing_id,
		"aircraft_type": aircraft_type,
		"count": _count,
		"home_airbase_province_id": capital_province_id,
	})
	close_requested.emit()


func _resolve_capital_province_id(nation_id: String) -> String:
	for pid in GameState.provinces:
		var p = GameState.provinces[pid]
		if p.get("owner_id", "") == nation_id:
			return pid
	return ""


func _resolve_capital_display() -> String:
	var my_nation: String = GameState.get_my_nation_id()
	var pid: String = _resolve_capital_province_id(my_nation)
	if not pid.is_empty():
		return pid
	return "unknown"
