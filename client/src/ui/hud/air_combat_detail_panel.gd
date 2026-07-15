extends PanelContainer

const _AIRCRAFT_DISPLAY = {
	"fighter":          "Fighter",
	"heavy_fighter":    "Heavy Fighter",
	"cas_plane":        "CAS",
	"dive_bomber":      "Dive Bomber",
	"tactical_bomber":  "Tac. Bomber",
	"strategic_bomber": "Strat. Bomber",
	"naval_bomber":     "Naval Bomber",
}

var _title_label: Label
var _content_vbox: VBoxContainer


func _ready() -> void:
	_setup_ui()
	hide()


func _setup_ui() -> void:
	custom_minimum_size = Vector2(440, 0)

	var outer:= MarginContainer.new()
	outer.add_theme_constant_override("margin_left",   20)
	outer.add_theme_constant_override("margin_right",  20)
	outer.add_theme_constant_override("margin_top",    20)
	outer.add_theme_constant_override("margin_bottom", 20)
	add_child(outer)

	var vbox:= VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	outer.add_child(vbox)

	var header:= HBoxContainer.new()
	vbox.add_child(header)

	var icon_bg:= Panel.new()
	icon_bg.custom_minimum_size = Vector2(26, 26)
	icon_bg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var icon_style:= StyleBoxFlat.new()
	icon_style.bg_color = Color(0.25, 0.55, 0.85, 1.0)
	icon_style.corner_radius_top_left     = 13
	icon_style.corner_radius_top_right    = 13
	icon_style.corner_radius_bottom_left  = 13
	icon_style.corner_radius_bottom_right = 13
	icon_bg.add_theme_stylebox_override("panel", icon_style)
	header.add_child(icon_bg)

	var icon:= TextureRect.new()
	icon.texture = load("res://assets/icons/jet-fighter-up-solid-full.svg")
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 4)
	icon.modulate = Color(1.0, 1.0, 1.0, 0.95)
	icon_bg.add_child(icon)

	_title_label = Label.new()
	_title_label.text = "AIR COMBAT"
	header.add_child(_title_label)

	var spacer:= Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)

	var close_btn:= Button.new()
	close_btn.text = "✕"
	close_btn.pressed.connect(_close)
	header.add_child(close_btn)

	vbox.add_child(HSeparator.new())

	_content_vbox = VBoxContainer.new()
	_content_vbox.add_theme_constant_override("separation", 12)
	vbox.add_child(_content_vbox)


func populate(data: Dictionary) -> void:
	for child in _content_vbox.get_children():
		child.queue_free()

	var combats: Array = data.get("combats", [])
	if combats.is_empty():
		combats = [data]

	if combats.size() > 1:
		_title_label.text = "AIR COMBAT ×%d" % combats.size()
	else:
		_title_label.text = "AIR COMBAT"

	for i in range(combats.size()):
		if i > 0:
			_content_vbox.add_child(HSeparator.new())
		_add_combat_section(combats[i])

	show()


func _wing_label(nation_id: String, wing_id: String, aircraft_type: String) -> String:
	var parts:= wing_id.split("_")
	var num_str:= parts[-1].lstrip("0") if parts.size() > 0 else ""
	var wing_num:= "Wing %s" % (num_str if num_str != "" else "1")
	var type_name: String = _AIRCRAFT_DISPLAY.get(aircraft_type, aircraft_type.capitalize())
	var bottom_line:= (wing_num + ": " + type_name) if type_name != "" else wing_num
	if nation_id != "":
		return "%s\n%s" % [nation_id.replace("_", " ").to_upper(), bottom_line]
	return bottom_line


func _add_combat_section(combat: Dictionary) -> void:
	var section:= VBoxContainer.new()
	section.add_theme_constant_override("separation", 6)
	_content_vbox.add_child(section)

	var nation_a: String  = combat.get("wing_a_nation_id", "")
	var nation_b: String  = combat.get("wing_b_nation_id", "")
	var type_a: String    = combat.get("wing_a_aircraft_type", "")
	var type_b: String    = combat.get("wing_b_aircraft_type", "")
	var wing_a_id: String = combat.get("wing_a_id", "")
	var wing_b_id: String = combat.get("wing_b_id", "")
	var lost_a: int       = int(combat.get("wing_a_planes_lost", 0))
	var lost_b: int       = int(combat.get("wing_b_planes_lost", 0))
	var destroyed_a: bool = bool(combat.get("attacker_destroyed", false))
	var destroyed_b: bool = bool(combat.get("target_destroyed", false))
	var is_surprise: bool = bool(combat.get("is_surprise", false))

	var wings_row:= HBoxContainer.new()
	section.add_child(wings_row)
	var lbl_wa:= Label.new()
	lbl_wa.text = _wing_label(nation_a, wing_a_id, type_a)
	lbl_wa.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wings_row.add_child(lbl_wa)
	var lbl_wb:= Label.new()
	lbl_wb.text = _wing_label(nation_b, wing_b_id, type_b)
	lbl_wb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wings_row.add_child(lbl_wb)

	var lost_row:= HBoxContainer.new()
	section.add_child(lost_row)
	var lbl_la:= Label.new()
	if destroyed_a:
		lbl_la.text = "Wing destroyed"
	elif lost_a > 0:
		lbl_la.text = "%d planes lost" % lost_a
	else:
		lbl_la.text = "No losses"
	lbl_la.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lost_row.add_child(lbl_la)
	var lbl_lb:= Label.new()
	if destroyed_b:
		lbl_lb.text = "Wing destroyed"
	elif lost_b > 0:
		lbl_lb.text = "%d planes lost" % lost_b
	else:
		lbl_lb.text = "No losses"
	lbl_lb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lost_row.add_child(lbl_lb)

	if is_surprise:
		var surprise_lbl:= Label.new()
		surprise_lbl.text = "* Surprise attack"
		section.add_child(surprise_lbl)

	var spacer:= Control.new()
	spacer.custom_minimum_size = Vector2(0, 14)
	section.add_child(spacer)

	var result_lbl:= Label.new()
	result_lbl.text = _result_line(destroyed_a, destroyed_b, lost_a, lost_b)
	section.add_child(result_lbl)


func _result_line(destroyed_a: bool, destroyed_b: bool, lost_a: int, lost_b: int) -> String:
	if destroyed_a and destroyed_b:
		return "MUTUAL DESTRUCTION"
	elif destroyed_b:
		return "VICTORY: enemy wing destroyed"
	elif destroyed_a:
		return "DEFEAT: own wing destroyed"
	elif lost_a == 0 and lost_b == 0:
		return "SKIRMISH: no losses on either side"
	elif lost_a < lost_b:
		return "VICTORY: %d vs %d aircraft lost" % [lost_a, lost_b]
	elif lost_b < lost_a:
		return "DEFEAT: %d vs %d aircraft lost" % [lost_a, lost_b]
	return "EXCHANGE: %d aircraft lost each" % lost_a


func _close() -> void:
	EventBus.air_combat_detail_closed.emit()
	hide()


func _unhandled_key_input(event: InputEvent) -> void:
	if visible and event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE:
			_close()
			get_viewport().set_input_as_handled()
