extends Node2D

# Must be kept in sync with server constants in air_wing_lifecycle_system.ts
const FUEL_DECAY_PER_TICK  := 0.065
const FUEL_RTB_THRESHOLD   := 0.10
const WING_SPEED_DEG_PER_MS := 0.0002
const TICK_MS              := 1000.0

const CIRCLE_POINTS := 64
const FILL_ALPHA    := 0.10
const BORDER_ALPHA  := 0.60
const BORDER_WIDTH  := 1.5
const WARNING_ALPHA := 0.55

var _map_loader: Node = null

var _wing_lng: float = 0.0
var _wing_lat: float = 0.0
var _fuel: float = 1.0
var _display_fuel: float = 1.0  # client-interpolated between server ticks
var _nation_color: Color = Color(0.5, 0.5, 0.5)
var _active: bool = false


func setup(map_loader: Node) -> void:
	_map_loader = map_loader


func show_for_wing(wing_lng: float, wing_lat: float, fuel: float, nation_color: Color) -> void:
	_wing_lng     = wing_lng
	_wing_lat     = wing_lat
	_nation_color = nation_color
	if not _active or absf(fuel - _fuel) > 0.001:
		_display_fuel = fuel
	_fuel   = fuel
	_active = true
	queue_redraw()


func hide_overlay() -> void:
	if _active:
		_active = false
		queue_redraw()


func tick_interpolate(delta: float) -> void:
	if not _active:
		return
	_display_fuel -= (FUEL_DECAY_PER_TICK / TICK_MS) * delta * 1000.0
	_display_fuel = maxf(_display_fuel, 0.0)
	queue_redraw()


func _draw() -> void:
	if not _active or _map_loader == null:
		return

	var center: Vector2 = _map_loader.project_lng_lat(_wing_lng, _wing_lat)

	if _display_fuel <= FUEL_RTB_THRESHOLD:
		# Out of usable range — warning ring at wing position
		draw_arc(center, 20.0, 0.0, TAU, 32, Color(0.9, 0.2, 0.1, WARNING_ALPHA), BORDER_WIDTH)
		return

	var ticks_remaining: float = (_display_fuel - FUEL_RTB_THRESHOLD) / FUEL_DECAY_PER_TICK
	var radius_deg: float = ticks_remaining * WING_SPEED_DEG_PER_MS * TICK_MS

	# Convert radius from degrees to screen pixels using a longitude offset at the wing's latitude
	var edge: Vector2 = _map_loader.project_lng_lat(_wing_lng + radius_deg, _wing_lat)
	var radius_px: float = center.distance_to(edge)

	var fill_color   := Color(_nation_color.r, _nation_color.g, _nation_color.b, FILL_ALPHA)
	var border_color := Color(_nation_color.r, _nation_color.g, _nation_color.b, BORDER_ALPHA)

	var pts := PackedVector2Array()
	for i in range(CIRCLE_POINTS):
		var angle: float = float(i) / float(CIRCLE_POINTS) * TAU
		pts.append(center + Vector2(cos(angle), sin(angle)) * radius_px)

	draw_colored_polygon(pts, fill_color)
	var border_pts := PackedVector2Array(pts)
	border_pts.append(pts[0])
	draw_polyline(border_pts, border_color, BORDER_WIDTH)
