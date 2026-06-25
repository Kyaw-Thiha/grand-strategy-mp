extends Node
## Owns the Camera2D. Nothing else touches zoom or pan.
## WASD movement with acceleration ramp and instant stop on key release.
## Smooth rounded-edge scroll with WASD priority.
## Smooth zoom via lerp for both scroll wheel and Ctrl++/Ctrl+-.

signal zoom_changed(level: float)

const BASE_SPEED     := 600.0
const MAX_SPEED      := 3000.0
const ACCELERATION   := 1000.0
const EDGE_SCROLL_BAND := 120.0
const EDGE_MIN_SPEED := 180.0
const EDGE_MAX_SPEED := 1400.0
const EDGE_SPEED_CURVE := 1.35
const EDGE_CORNER_RADIUS := 180.0
const ZOOM_STEP      := 0.15
const ZOOM_KB_STEP   := 0.25
const ZOOM_SPEED     := 8.0
const MIN_ZOOM       := 0.2
const MAX_ZOOM       := 4.0
const NATION_LABEL_ZOOM_THRESHOLD := 0.6

var _camera: Camera2D = null
var _move_speed: float = 0.0
var _target_zoom: float = 1.0
var _edge_scroll_enabled: bool = true
var _map_loader: Node = null
var _label_region_active := false  # true when zoom < threshold
var _map_bounds: Rect2 = Rect2()
var _bounds_ready: bool = false


func setup(camera: Camera2D, map_loader: Node) -> void:
	_camera = camera
	_map_loader = map_loader
	_target_zoom = camera.zoom.x


func _process(delta: float) -> void:
	if _camera == null:
		return
	if not _bounds_ready and _map_loader != null:
		var b: Rect2 = _map_loader.get_map_bounds()
		if b.size != Vector2.ZERO:
			_map_bounds = b
			_bounds_ready = true
	_handle_movement(delta)
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), ZOOM_SPEED * delta)
	_clamp_position()
	var now_in_label_region := _camera.zoom.x < NATION_LABEL_ZOOM_THRESHOLD
	if now_in_label_region != _label_region_active:
		_label_region_active = now_in_label_region
		zoom_changed.emit(_camera.zoom.x)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed:
			if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
				_target_zoom = clampf(_target_zoom + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM)
			elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				_target_zoom = clampf(_target_zoom - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM)

	if event is InputEventKey:
		var ke := event as InputEventKey
		if ke.pressed and ke.ctrl_pressed:
			if ke.keycode == KEY_EQUAL or ke.keycode == KEY_KP_ADD:
				_target_zoom = clampf(_target_zoom + ZOOM_KB_STEP, MIN_ZOOM, MAX_ZOOM)
				get_viewport().set_input_as_handled()
			elif ke.keycode == KEY_MINUS or ke.keycode == KEY_KP_SUBTRACT:
				_target_zoom = clampf(_target_zoom - ZOOM_KB_STEP, MIN_ZOOM, MAX_ZOOM)
				get_viewport().set_input_as_handled()


func pan_to_province(province_id: String) -> void:
	if _map_loader == null:
		return
	var focus_position: Vector2 = _map_loader.get_province_focus_position(province_id)
	if focus_position != Vector2.INF:
		pan_to_position(focus_position)
		return
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node:
		pan_to_position(node.position)


func pan_to_position(pos: Vector2) -> void:
	if _camera:
		_camera.position = pos
		_clamp_position()


func set_zoom(level: float) -> void:
	_target_zoom = clampf(level, MIN_ZOOM, MAX_ZOOM)


func enable_edge_scroll(enabled: bool) -> void:
	_edge_scroll_enabled = enabled


# ── internal ──────────────────────────────────────────────────────────────────

func _handle_movement(delta: float) -> void:
	var wasd_dir := Vector2.ZERO
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		wasd_dir.y -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		wasd_dir.y += 1.0
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		wasd_dir.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		wasd_dir.x += 1.0

	var wasd_active := wasd_dir != Vector2.ZERO

	if wasd_active:
		if _move_speed == 0.0:
			_move_speed = BASE_SPEED
		_move_speed = move_toward(_move_speed, MAX_SPEED, ACCELERATION * delta)
		_camera.position += wasd_dir.normalized() * _move_speed * delta / _camera.zoom.x
		_clamp_position()
		return

	_move_speed = 0.0

	if _edge_scroll_enabled:
		var mouse: Vector2 = _camera.get_viewport().get_mouse_position()
		var viewport_size: Vector2 = _camera.get_viewport().get_visible_rect().size
		var edge_velocity: Vector2 = _get_edge_scroll_velocity(mouse, viewport_size)

		if edge_velocity != Vector2.ZERO:
			_camera.position += edge_velocity * delta / _camera.zoom.x
			_clamp_position()


## Computes smooth camera edge-scroll velocity for a viewport-space mouse position.
## Parameters:
## - viewport_mouse: mouse position in viewport coordinates.
## - viewport_size: visible viewport size in pixels.
## Returns: world-space pixels per second before zoom scaling.
func _get_edge_scroll_velocity(viewport_mouse: Vector2, viewport_size: Vector2) -> Vector2:
	if viewport_size.x <= 0.0 or viewport_size.y <= 0.0:
		return Vector2.ZERO

	var rounded_corner_vector: Vector2 = _get_rounded_corner_scroll_vector(viewport_mouse, viewport_size)
	var scroll_vector: Vector2 = rounded_corner_vector
	if scroll_vector == Vector2.ZERO:
		scroll_vector = Vector2(
			_get_axis_edge_strength(viewport_mouse.x, viewport_size.x),
			_get_axis_edge_strength(viewport_mouse.y, viewport_size.y)
		)

	var scroll_strength: float = clampf(scroll_vector.length(), 0.0, 1.0)
	if scroll_strength <= 0.0:
		return Vector2.ZERO

	var scroll_speed: float = lerpf(EDGE_MIN_SPEED, EDGE_MAX_SPEED, scroll_strength)
	return scroll_vector.normalized() * scroll_speed


## Returns signed smooth edge strength for one viewport axis.
## Parameters:
## - mouse_axis: mouse coordinate on the axis.
## - viewport_axis_size: viewport size on the axis.
## Returns: -1.0 to 1.0, where sign is scroll direction.
func _get_axis_edge_strength(mouse_axis: float, viewport_axis_size: float) -> float:
	var band_size: float = minf(EDGE_SCROLL_BAND, viewport_axis_size * 0.5)
	if band_size <= 0.0:
		return 0.0

	if mouse_axis < band_size:
		var left_strength: float = clampf((band_size - mouse_axis) / band_size, 0.0, 1.0)
		return -pow(left_strength, EDGE_SPEED_CURVE)
	if mouse_axis > viewport_axis_size - band_size:
		var right_strength: float = clampf((mouse_axis - (viewport_axis_size - band_size)) / band_size, 0.0, 1.0)
		return pow(right_strength, EDGE_SPEED_CURVE)
	return 0.0


## Returns a diagonal scroll vector when the mouse leaves the rounded safe corner.
## Parameters:
## - mouse: mouse position in viewport coordinates.
## - viewport_size: visible viewport size in pixels.
## Returns: signed vector whose length is the corner scroll strength.
func _get_rounded_corner_scroll_vector(mouse: Vector2, viewport_size: Vector2) -> Vector2:
	var band_size: float = minf(EDGE_SCROLL_BAND, minf(viewport_size.x, viewport_size.y) * 0.5)
	var radius: float = minf(EDGE_CORNER_RADIUS, minf(viewport_size.x, viewport_size.y) * 0.5 - band_size)
	if band_size <= 0.0 or radius <= 0.0:
		return Vector2.ZERO

	var corner_centers: Array[Vector2] = [
		Vector2(band_size + radius, band_size + radius),
		Vector2(viewport_size.x - band_size - radius, band_size + radius),
		Vector2(band_size + radius, viewport_size.y - band_size - radius),
		Vector2(viewport_size.x - band_size - radius, viewport_size.y - band_size - radius),
	]

	for corner_center: Vector2 in corner_centers:
		var from_corner_center: Vector2 = mouse - corner_center
		var outward_sign: Vector2 = Vector2(
			signf(corner_center.x - viewport_size.x * 0.5),
			signf(corner_center.y - viewport_size.y * 0.5)
		)
		var is_in_corner_quadrant: bool = (
			from_corner_center.x * outward_sign.x > 0.0
			and from_corner_center.y * outward_sign.y > 0.0
		)
		if not is_in_corner_quadrant:
			continue

		var distance_from_corner_center: float = from_corner_center.length()
		if distance_from_corner_center <= radius:
			continue

		var viewport_corner: Vector2 = Vector2(
			0.0 if corner_center.x < viewport_size.x * 0.5 else viewport_size.x,
			0.0 if corner_center.y < viewport_size.y * 0.5 else viewport_size.y
		)
		var maximum_distance: float = maxf((viewport_corner - corner_center).length() - radius, 1.0)
		var corner_strength: float = clampf((distance_from_corner_center - radius) / maximum_distance, 0.0, 1.0)
		return from_corner_center.normalized() * pow(corner_strength, EDGE_SPEED_CURVE)

	return Vector2.ZERO


func _clamp_position() -> void:
	if not _bounds_ready:
		return
	var b := _map_bounds
	_camera.position.x = clampf(_camera.position.x, b.position.x, b.end.x)
	_camera.position.y = clampf(_camera.position.y, b.position.y, b.end.y)
