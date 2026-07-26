class_name NavalContactMarkerSystem
extends Node2D
## Renders naval contact markers as translucent circles on the map.
## Only own-nation markers are received from the server (nation filtering is server-side).

const C_NAVAL := Color(0.10, 0.62, 0.62, 1.0)
const ICON_SIZE := Vector2(14, 14)

## Quality → icon texture path
const QUALITY_ICONS := {
	"maritime_patrol": "res://assets/icons/jet-fighter-up-solid-full.svg",
	"cargo_sinking":   "res://assets/icons/fire-solid-full.svg",
	"flotilla_scout":  "res://assets/icons/clock-solid-full.svg",
}

var _markers: Dictionary = {}
var _map_loader  # set via setup(), not get_node

func setup(map_loader) -> void:
	_map_loader = map_loader

func _ready() -> void:
	EventBus.naval_contact_marker_added.connect(_on_marker_added)
	EventBus.naval_contact_marker_expired.connect(_on_marker_expired)

func _on_marker_added(data: Dictionary) -> void:
	var mid: String = data.get("marker_id", "")
	if not _markers.has(mid):
		_spawn_marker(data)

func _spawn_marker(data: Dictionary) -> void:
	var node := _MarkerCircle.new()
	node.setup(data, _map_loader)
	add_child(node)
	_markers[data["marker_id"]] = { "data": data, "node": node }

func _on_marker_expired(data: Dictionary) -> void:
	var mid: String = data.get("marker_id", "")
	if _markers.has(mid):
		_markers[mid]["node"].queue_free()
		_markers.erase(mid)

## Inner class — one circle node per marker
class _MarkerCircle extends Node2D:
	var _radius_px: float = 0.0
	var _expires_at_ms: float = 0.0
	var _icon_tex: Texture2D = null
	var _quality: String = ""

	func setup(data: Dictionary, map_loader) -> void:
		var center := map_loader.project_lng_lat(
			data["position_lng"], data["position_lat"])
		position = center
		var edge := map_loader.project_lng_lat(
			data["position_lng"] + data["radius_deg"], data["position_lat"])
		_radius_px = center.distance_to(edge)
		_expires_at_ms = float(data["expires_at_ms"])
		_quality = data.get("quality", "")
		var icon_path: String = NavalContactMarkerSystem.QUALITY_ICONS.get(_quality, "")
		if icon_path != "":
			_icon_tex = load(icon_path)
		queue_redraw()

	func _process(_delta: float) -> void:
		queue_redraw()

	func _draw() -> void:
		var now_ms := Time.get_unix_time_from_system() * 1000.0
		var remaining := _expires_at_ms - now_ms
		var alpha := clampf(remap(remaining, 0.0, 60_000.0, 0.05, 0.4), 0.05, 0.4)
		var color := Color(C_NAVAL.r, C_NAVAL.g, C_NAVAL.b, alpha)
		draw_circle(Vector2.ZERO, _radius_px, color)
		draw_arc(Vector2.ZERO, _radius_px, 0.0, TAU, 48,
				 Color(C_NAVAL.r, C_NAVAL.g, C_NAVAL.b, alpha + 0.2), 1.5)
		if _icon_tex:
			var rect := Rect2(-ICON_SIZE * 0.5, ICON_SIZE)
			draw_texture_rect(_icon_tex, rect, false,
							  Color(0.08, 0.05, 0.02, minf(alpha * 3.0, 0.9)))
