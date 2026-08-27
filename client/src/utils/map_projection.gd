class_name MapProjection
extends RefCounted
## Shared Mercator projection used by the map generator (bake time), the runtime map
## loader, and any runtime-projected geometry (e.g. subprovince polygons).
## Single implementation so baked province geometry and runtime-projected polygons land
## in byte-identical screen space.

const CANVAS_WIDTH := 4096.0
const CANVAS_HEIGHT := 3000.0

var _proj_center: Vector2 = Vector2.ZERO
var _scale: float = 1.0


## Converts WGS84 (lng, lat) to raw Mercator radians.
static func mercator_raw(lng: float, lat: float) -> Vector2:
	var x := lng * PI / 180.0
	var y := log(tan(PI / 4.0 + lat * PI / 360.0))
	return Vector2(x, y)


func _init(bounds: Dictionary) -> void:
	_setup_from_bounds(bounds)


## Computes the projection center and canvas-fit scale from map bounds.
func _setup_from_bounds(bounds: Dictionary) -> void:
	var cx: float = (bounds.get("min_lng", 0.0) + bounds.get("max_lng", 0.0)) * 0.5
	var cy: float = (bounds.get("min_lat", 0.0) + bounds.get("max_lat", 0.0)) * 0.5
	_proj_center = MapProjection.mercator_raw(cx, cy)

	var tl := MapProjection.mercator_raw(bounds.get("min_lng", 0.0), bounds.get("max_lat", 0.0))
	var br := MapProjection.mercator_raw(bounds.get("max_lng", 0.0), bounds.get("min_lat", 0.0))
	var raw_width: float = abs(br.x - tl.x)
	var raw_height: float = abs(br.y - tl.y)
	_scale = min(CANVAS_WIDTH / raw_width, CANVAS_HEIGHT / raw_height)


## Converts WGS84 (lng, lat) to Godot screen-space Vector2.
func project(lng: float, lat: float) -> Vector2:
	var raw := MapProjection.mercator_raw(lng, lat)
	return Vector2(
		(raw.x - _proj_center.x) * _scale,
		-(raw.y - _proj_center.y) * _scale
	)


## Inverse of project(). Returns [lng, lat] for a world-space pixel position.
func unproject(world_pos: Vector2) -> Vector2:
	if _scale == 0.0:
		return Vector2.ZERO
	var raw_x: float = world_pos.x / _scale + _proj_center.x
	var raw_y: float = -world_pos.y / _scale + _proj_center.y
	var lng: float = raw_x * 180.0 / PI
	var lat: float = (atan(exp(raw_y)) - PI / 4.0) * 360.0 / PI
	return Vector2(lng, lat)


## Projects one [lng, lat] coordinate ring into a PackedVector2Array.
func project_ring(ring: Array) -> PackedVector2Array:
	var points := PackedVector2Array()
	points.resize(ring.size())
	for index: int in ring.size():
		var coordinate: Array = ring[index]
		points[index] = project(float(coordinate[0]), float(coordinate[1]))
	return points


func get_scale() -> float:
	return _scale