extends Node
## Owns the Camera2D. Nothing else touches zoom or pan.
## WASD movement with acceleration ramp and instant stop on key release.
## Edge scroll at constant speed with WASD priority.
## Smooth zoom via lerp for both scroll wheel and Ctrl++/Ctrl+-.

signal zoom_changed(level: float)

const BASE_SPEED     := 600.0
const MAX_SPEED      := 3000.0
const ACCELERATION   := 1000.0
const EDGE_SPEED     := 900.0
const EDGE_MARGIN    := 20.0
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


func setup(camera: Camera2D, map_loader: Node) -> void:
	_camera = camera
	_map_loader = map_loader
	_target_zoom = camera.zoom.x


func _process(delta: float) -> void:
	if _camera == null:
		return
	_handle_movement(delta)
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), ZOOM_SPEED * delta)
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
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node:
		pan_to_position(node.position)


func pan_to_position(pos: Vector2) -> void:
	if _camera:
		_camera.position = pos


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
		_move_speed = move_toward(_move_speed, MAX_SPEED, ACCELERATION * delta)
		_camera.position += wasd_dir.normalized() * _move_speed * delta
		return

	_move_speed = 0.0

	if _edge_scroll_enabled:
		var mouse := _camera.get_viewport().get_mouse_position()
		var vsize := _camera.get_viewport().get_visible_rect().size
		var edge_dir := Vector2.ZERO

		if mouse.x < EDGE_MARGIN:
			edge_dir.x = -1.0
		elif mouse.x > vsize.x - EDGE_MARGIN:
			edge_dir.x = 1.0
		if mouse.y < EDGE_MARGIN:
			edge_dir.y = -1.0
		elif mouse.y > vsize.y - EDGE_MARGIN:
			edge_dir.y = 1.0

		if edge_dir != Vector2.ZERO:
			_camera.position += edge_dir.normalized() * EDGE_SPEED * delta
