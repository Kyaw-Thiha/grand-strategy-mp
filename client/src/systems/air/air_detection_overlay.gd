extends Node2D

const CIRCLE_POINTS := 48
const FILL_ALPHA := 0.07
const BORDER_ALPHA := 0.40
const BORDER_WIDTH := 1.2

const PASSIVE_RADIUS_DEG := 0.1
const RECON_RADIUS_DEG := 1.0

var _map_loader: Node = null
var _nation_color: Color = Color(0.4, 0.7, 1.0)
var _wing_entries: Dictionary = {}
var _radar_entries: Dictionary = {}


func setup(map_loader: Node, nation_color: Color) -> void:
	_map_loader = map_loader
	_nation_color = nation_color
	queue_redraw()


func set_wing_entry(wing_id: String, lng: float, lat: float, mission: String) -> void:
	_wing_entries[wing_id] = { "lng": lng, "lat": lat, "mission": mission }
	queue_redraw()


func remove_wing_entry(wing_id: String) -> void:
	if _wing_entries.erase(wing_id):
		queue_redraw()


func set_radar_entry(key: String, lng: float, lat: float, radius_deg: float) -> void:
	if radius_deg <= 0.0:
		if _radar_entries.erase(key):
			queue_redraw()
		return
	_radar_entries[key] = { "lng": lng, "lat": lat, "radius_deg": radius_deg }
	queue_redraw()


func clear() -> void:
	_wing_entries.clear()
	_radar_entries.clear()
	queue_redraw()


func _draw() -> void:
	if _map_loader == null:
		return

	var fill: Color = Color(_nation_color.r, _nation_color.g, _nation_color.b, FILL_ALPHA)
	var border: Color = Color(_nation_color.r, _nation_color.g, _nation_color.b, BORDER_ALPHA)
	for entry in _wing_entries.values():
		var radius_deg: float = RECON_RADIUS_DEG if entry["mission"] == "recon" else PASSIVE_RADIUS_DEG
		_draw_circle_deg(float(entry["lng"]), float(entry["lat"]), radius_deg, fill, border)
	for entry in _radar_entries.values():
		_draw_circle_deg(float(entry["lng"]), float(entry["lat"]), float(entry["radius_deg"]), fill, border)


func _draw_circle_deg(lng: float, lat: float, radius_deg: float, fill: Color, border: Color) -> void:
	var center: Vector2 = _map_loader.project_lng_lat(lng, lat)
	var edge: Vector2 = _map_loader.project_lng_lat(lng + radius_deg, lat)
	var radius_px: float = center.distance_to(edge)
	if radius_px < 1.0:
		return

	var pts := PackedVector2Array()
	for i in range(CIRCLE_POINTS):
		var angle: float = float(i) / float(CIRCLE_POINTS) * TAU
		pts.append(center + Vector2(cos(angle), sin(angle)) * radius_px)

	draw_colored_polygon(pts, fill)
	var border_pts := PackedVector2Array(pts)
	border_pts.append(pts[0])
	draw_polyline(border_pts, border, BORDER_WIDTH)
