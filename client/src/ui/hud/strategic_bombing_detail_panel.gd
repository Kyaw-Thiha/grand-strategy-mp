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

const MISSION_DISPLAY = {
	"area":      "Area Bombing",
	"industry":  "Industry Bombing",
	"oil":       "Oil Bombing",
	"logistics": "Logistics Strike",
}

var _title_label: Label
var _content_vbox: VBoxContainer
var _close_called: bool = false


func _ready() -> void:
	_setup_ui()
	_close_called = false


func _setup_ui() -> void:
	custom_minimum_size = Vector2(440, 0)

	var outer := MarginContainer.new()
	outer.add_theme_constant_override("margin_left",   20)
	outer.add_theme_constant_override("margin_right",  20)
	outer.add_theme_constant_override("margin_top",    20)
	outer.add_theme_constant_override("margin_bottom", 20)
	add_child(outer)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	outer.add_child(vbox)

	var header := HBoxContainer.new()
	vbox.add_child(header)

	var icon_bg := Panel.new()
	icon_bg.custom_minimum_size = Vector2(26, 26)
	icon_bg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var icon_style := StyleBoxFlat.new()
	icon_style.bg_color = Color(0.55, 0.20, 0.75, 1.0)
	icon_style.corner_radius_top_left     = 13
	icon_style.corner_radius_top_right    = 13
	icon_style.corner_radius_bottom_left  = 13
	icon_style.corner_radius_bottom_right = 13
	icon_bg.add_theme_stylebox_override("panel", icon_style)
	header.add_child(icon_bg)

	var icon := TextureRect.new()
	icon.texture = load("res://assets/icons/jet-fighter-up-solid-full.svg")
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 4)
	icon.modulate = Color(1.0, 1.0, 1.0, 0.95)
	icon_bg.add_child(icon)

	_title_label = Label.new()
	_title_label.text = "STRATEGIC BOMBING"
	header.add_child(_title_label)

	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)

	var close_btn := Button.new()
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
	_close_called = false

	var combats: Array = data.get("combats", [])
	if combats.is_empty():
		combats = [data]

	if combats.size() > 1:
		_title_label.text = "STRATEGIC BOMBING ×%d" % combats.size()
	else:
		_title_label.text = "STRATEGIC BOMBING"

	for i in range(combats.size()):
		if i > 0:
			_content_vbox.add_child(HSeparator.new())
		_add_run_section(combats[i])


func _add_run_section(run: Dictionary) -> void:
	var section := VBoxContainer.new()
	section.add_theme_constant_override("separation", 6)
	_content_vbox.add_child(section)

	var nation_a: String = run.get("attacker_nation_id", "")
	var nation_b: String = run.get("defender_nation_id", "")
	var prov_id: String  = run.get("province_id", "")
	var mission: String  = run.get("mission", "")
	var ac_type: String  = run.get("aircraft_type", "")
	var count: int       = int(run.get("count", 0))

	var heading := Label.new()
	var province_name: String = prov_id
	var ml: Node = _get_map_loader()
	if ml != null and ml.has_method("get_province_data"):
		var pd: Dictionary = ml.get_province_data(prov_id)
		if not pd.is_empty():
			province_name = pd.get("name", prov_id)
	heading.text = "%s  ·  %s → %s" % [province_name, nation_a.to_upper(), nation_b.to_upper()]
	section.add_child(heading)

	var detail := Label.new()
	var type_name: String = _AIRCRAFT_DISPLAY.get(ac_type, ac_type.capitalize())
	var mission_name: String = MISSION_DISPLAY.get(mission, mission.capitalize())
	detail.text = "%d × %s  (%s)\nMission: %s" % [count, type_name, nation_a.to_upper(), mission_name]
	section.add_child(detail)

	var last := Label.new()
	last.text = ""

	var industry:        float = float(run.get("industry", 0))
	var population:      float = float(run.get("population", 0))
	var infrastructure:  float = float(run.get("infrastructure", 0))
	var industry_b:      float = float(run.get("industry_before", industry))
	var population_b:    float = float(run.get("population_before", population))
	var infrastructure_b: float = float(run.get("infrastructure_before", infrastructure))

	last.text += _scalar_row("Industry",       industry_b,       industry)
	last.text += "\n" + _scalar_row("Population",     population_b,     population)
	last.text += "\n" + _scalar_row("Infrastructure", infrastructure_b, infrastructure)

	var oil_until: float = float(run.get("oil_bombed_until_ms", 0))
	var now_ms := Time.get_unix_time_from_system() * 1000.0
	if oil_until > 0.0 and now_ms < oil_until:
		last.text += "\nOil supply: DISRUPTED"
	else:
		last.text += "\nOil supply: OK"

	section.add_child(last)


func _scalar_row(label: String, before: float, after: float) -> String:
	if abs(before - after) < 0.001:
		return "%s  %d  (unchanged)" % [label, int(after)]
	var diff := int(before - after)
	return "%s  %d  →  %d  (−%d)" % [label, int(before), int(after), diff]


func _close() -> void:
	if _close_called:
		return
	_close_called = true
	EventBus.strategic_bombing_detail_closed.emit()


func _unhandled_key_input(event: InputEvent) -> void:
	if visible and event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE:
			_close()
			get_viewport().set_input_as_handled()


func _get_map_loader() -> Node:
	# MapLoader is nested under the "Game" scene root (game.tscn: Game > MapLoader), not a direct
	# child of the true scene tree root — a one-level get_children() scan never finds it.
	# find_child(recursive=true) is the correct lookup, matching bombing_detail_panel.gd's
	# already-correct version of this same pattern.
	var ml2: MainLoop = Engine.get_main_loop()
	if ml2 == null:
		return null
	var root_node: Window = ml2.root
	var ml: Node = root_node.find_child("MapLoader", true, false)
	if ml == null:
		ml = preload("res://src/systems/map/map_loader.gd").new()
	return ml
