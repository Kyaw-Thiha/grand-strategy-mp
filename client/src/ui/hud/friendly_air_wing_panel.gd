extends PanelContainer
## Bottom selection bar panel — shows stats for selected friendly air wing.

var _wing_id_label: Label
var _aircraft_type_label: Label
var _lifecycle_label: Label
var _mission_label: Label
var _readiness_bar: ProgressBar
var _readiness_pct: Label
var _weapon_label: Label
var _target_label: Label
var _airbase_label: Label

var _current_wing_id: String = ""

const LIFECYCLE_COLOR: Dictionary = {
	"idle":    Color(0.5, 0.5, 0.5),
	"transit": Color(0.267, 0.533, 1.0),
	"engaged": Color(1.0, 0.267, 0.267),
	"loiter":  Color(1.0, 0.533, 0.0),
	"rtb":     Color(0.667, 0.267, 1.0),
	"refuel":  Color(0.0, 0.8, 0.8),
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
	EventBus.air_wing_updated.connect(_on_air_wing_updated)


func populate(wing_id: String, data: Dictionary) -> void:
	_current_wing_id = wing_id
	_refresh_stats(data)


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
		_readiness_pct.text = str(int(float(data.get("combat_readiness", 1.0)) * 100.0)) + "%"
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
