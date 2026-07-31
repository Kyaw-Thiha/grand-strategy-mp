extends PanelContainer

var _wing_id_label: Label
var _aircraft_type_label: Label
var _lifecycle_label: Label
var _mission_label: Label
var _fuel_bar: ProgressBar
var _fuel_pct: Label
var _readiness_bar: ProgressBar
var _readiness_pct: Label
var _weapon_label: Label
var _target_label: Label
var _airbase_label: Label

var _mission_option: OptionButton
var _escort_row: HBoxContainer
var _escort_target_label: Label
var _btn_pick_target: Button
var _size_value_label: Label
var _btn_size_minus: Button
var _btn_size_plus: Button
var _btn_retreat: Button

var _current_wing_id: String = ""

const LIFECYCLE_COLOR: Dictionary = {
	"idle":     Color(0.5, 0.5, 0.5),
	"transit":  Color(0.267, 0.533, 1.0),
	"engaged":  Color(1.0, 0.267, 0.267),
	"loiter":   Color(1.0, 0.533, 0.0),
	"rtb":      Color(0.667, 0.267, 1.0),
	"refuel":   Color(0.0, 0.8, 0.8),
	"relocate": Color(0.0, 0.75, 0.85),
}


func _ready() -> void:
	_wing_id_label     = get_node_or_null("Margin/HBox/IdentityBlock/WingId")
	_aircraft_type_label = get_node_or_null("Margin/HBox/IdentityBlock/AircraftType")
	_lifecycle_label   = get_node_or_null("Margin/HBox/StatusBlock/LifecycleLabel")
	_mission_label     = get_node_or_null("Margin/HBox/StatusBlock/MissionLabel")
	_readiness_bar     = get_node_or_null("Margin/HBox/ReadinessBlock/ReadinessBar")
	_readiness_pct     = get_node_or_null("Margin/HBox/ReadinessBlock/ReadinessBar/ReadinessPct")
	_weapon_label      = get_node_or_null("Margin/HBox/StatusBlock/WeaponLabel")
	_target_label      = get_node_or_null("Margin/HBox/TargetBlock/TargetLabel")
	_airbase_label     = get_node_or_null("Margin/HBox/TargetBlock/AirbaseLabel")

	_mission_option      = get_node_or_null("Margin/HBox/ActionsBlock/MissionRow/MissionOptionButton")
	_escort_row           = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow")
	_escort_target_label  = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow/EscortTargetLabel")
	_btn_pick_target       = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow/BtnPickTarget")
	_size_value_label      = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/SizeValueLabel")
	_btn_size_minus        = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/BtnSizeMinus")
	_btn_size_plus         = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/BtnSizePlus")
	_btn_retreat           = get_node_or_null("Margin/HBox/ActionsBlock/BtnRetreat")

	var readiness_block: Node = get_node_or_null("Margin/HBox/ReadinessBlock")
	if readiness_block and _readiness_bar:
		_fuel_bar = ProgressBar.new()
		_fuel_bar.min_value = 0.0
		_fuel_bar.max_value = 100.0
		_fuel_bar.value = 100.0
		_fuel_bar.show_percentage = false
		_fuel_bar.custom_minimum_size = _readiness_bar.custom_minimum_size
		_fuel_pct = Label.new()
		_fuel_pct.text = "100%"
		_fuel_pct.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_fuel_pct.add_theme_font_size_override("font_size", 10)
		_fuel_bar.add_child(_fuel_pct)
		readiness_block.add_child(_fuel_bar)
		readiness_block.move_child(_fuel_bar, _readiness_bar.get_index())

	EventBus.air_wing_updated.connect(_on_air_wing_updated)


func populate(wing_id: String, data: Dictionary) -> void:
	_current_wing_id = wing_id
	_refresh_stats(data)
	_refresh_mission_dropdown(data)
	_refresh_escort_row(data)
	_refresh_size_row(data)
	var ls: String = data.get("lifecycle_state", "idle")
	if _btn_retreat != null:
		_btn_retreat.visible = ls in ["transit", "engaged", "loiter"]
	_rewire_buttons(wing_id)


func _rewire_buttons(wing_id: String) -> void:
	for btn: Button in [_btn_retreat, _btn_pick_target, _btn_size_minus, _btn_size_plus]:
		if btn == null:
			continue
		if btn.pressed.get_connections().size() > 0:
			for conn: Dictionary in btn.pressed.get_connections():
				btn.pressed.disconnect(conn["callable"])

	if _btn_retreat != null:
		_btn_retreat.pressed.connect(func() -> void:
			CommandQueue.submit("RETREAT_WING", { "wing_id": wing_id })
		)
	if _btn_pick_target != null:
		_btn_pick_target.pressed.connect(func() -> void:
			EventBus.air_wing_escort_picker_open_requested.emit(wing_id)
		)
	if _btn_size_minus != null:
		_btn_size_minus.pressed.connect(func() -> void:
			CommandQueue.submit("ADJUST_WING_SIZE", { "wing_id": wing_id, "delta": -10 })
		)
	if _btn_size_plus != null:
		_btn_size_plus.pressed.connect(func() -> void:
			CommandQueue.submit("ADJUST_WING_SIZE", { "wing_id": wing_id, "delta": 10 })
		)

	if _mission_option != null:
		if _mission_option.item_selected.is_connected(_on_mission_selected):
			_mission_option.item_selected.disconnect(_on_mission_selected)
		_mission_option.item_selected.connect(_on_mission_selected)


func _on_mission_selected(index: int) -> void:
	if _mission_option == null or _current_wing_id.is_empty():
		return
	var mission: String = _mission_option.get_item_metadata(index)
	CommandQueue.submit("ASSIGN_WING_MISSION", {
		"wing_id": _current_wing_id,
		"mission": mission,
		"target_id": "",
	})


func _refresh_mission_dropdown(data: Dictionary) -> void:
	if _mission_option == null:
		return
	var aircraft_type: String = data.get("aircraft_type", "")
	var eligible: Array = AirWingConstants.get_eligible_missions(aircraft_type, data)
	_mission_option.clear()
	var current_mission: String = data.get("mission", "")
	var select_index := 0
	for i: int in range(eligible.size()):
		var m: String = eligible[i]
		_mission_option.add_item(AirWingConstants.mission_label(m), i)
		_mission_option.set_item_metadata(i, m)
		if m == current_mission:
			select_index = i
	_mission_option.select(select_index)


func _refresh_escort_row(data: Dictionary) -> void:
	if _escort_row == null:
		return
	var mission: String = data.get("mission", "")
	_escort_row.visible = mission == AirWingConstants.MISSION_ESCORT
	if _escort_target_label != null:
		var target_id: String = data.get("target_id", "")
		_escort_target_label.text = "Escort target: " + (target_id if not target_id.is_empty() else "none yet")


func _refresh_size_row(data: Dictionary) -> void:
	if _size_value_label != null:
		_size_value_label.text = str(int(data.get("count", 0)))


func _refresh_stats(data: Dictionary) -> void:
	var ls: String = data.get("lifecycle_state", "idle")
	if _wing_id_label:
		_wing_id_label.text = data.get("wing_id", "")
	if _aircraft_type_label:
		var ac: String = data.get("aircraft_type", "")
		var cnt: int = data.get("count", 0)
		_aircraft_type_label.text = ac.to_upper() + " x " + str(cnt)
	if _lifecycle_label:
		_lifecycle_label.text = ls.to_upper()
		_lifecycle_label.add_theme_color_override(
			"font_color", LIFECYCLE_COLOR.get(ls, Color(1.0, 1.0, 1.0))
		)
	if _mission_label:
		_mission_label.text = "Mission: " + data.get("mission", "").replace("_", " ")
	if _fuel_bar:
		var f: float = float(data.get("fuel", 1.0))
		_fuel_bar.value = f * 100.0
		var fuel_color: Color
		if f >= 0.5:
			fuel_color = Color(0.2, 0.55, 1.0)
		elif f >= 0.25:
			fuel_color = Color(0.9, 0.7, 0.1)
		else:
			fuel_color = Color(0.9, 0.2, 0.1)
		_fuel_bar.modulate = fuel_color
	if _fuel_pct:
		_fuel_pct.text = "Fuel " + str(int(float(data.get("fuel", 1.0)) * 100.0)) + "%"
	if _readiness_bar:
		var r: float = float(data.get("combat_readiness", 1.0))
		_readiness_bar.value = r * 100.0
		var bar_color: Color
		if r >= 0.7:
			bar_color = Color(0.2, 0.85, 0.2)
		elif r >= 0.4:
			bar_color = Color(0.9, 0.8, 0.1)
		else:
			bar_color = Color(0.9, 0.2, 0.1)
		_readiness_bar.modulate = bar_color
	if _readiness_pct:
		_readiness_pct.text = "Rdy " + str(int(float(data.get("combat_readiness", 1.0)) * 100.0)) + "%"
	if _weapon_label:
		var wr: bool = data.get("weapon_ready", true)
		_weapon_label.text = "Weapons: " + ("READY" if wr else "RELOADING")
		_weapon_label.add_theme_color_override(
			"font_color", Color(0.2, 0.85, 0.2) if wr else Color(0.9, 0.8, 0.1)
		)
	if _target_label:
		var t: String = data.get("target_id", "")
		_target_label.text = "Target: " + (t if not t.is_empty() else "none")
	if _airbase_label:
		_airbase_label.text = "Base: " + data.get("home_airbase_province_id", "")


func _on_air_wing_updated(wing_id: String) -> void:
	if wing_id == _current_wing_id:
		var data: Dictionary = GameState.get_air_wing(wing_id)
		if not data.is_empty():
			_refresh_stats(data)
			_refresh_mission_dropdown(data)
			_refresh_escort_row(data)
			_refresh_size_row(data)
