extends Node
## Owns the Camera2D. Nothing else touches zoom or pan.
## WASD movement with acceleration ramp and instant stop on key release.
## Right-button drag panning with click/drag arbitration for map commands.
## Smooth zoom via lerp for both scroll wheel and Ctrl++/Ctrl+-.

signal zoom_changed(level: float)
signal right_click_requested(screen_position: Vector2, shift_pressed: bool)

const BASE_SPEED     := 350.0
const MAX_SPEED      := 900.0
const ACCELERATION   := 600.0
const RIGHT_DRAG_THRESHOLD_PX := 8.0
const ZOOM_STEP      := 0.15
const ZOOM_KB_STEP   := 0.25
const ZOOM_SPEED     := 8.0
const MIN_ZOOM       := 0.2
const MAX_ZOOM       := 4.0
const NATION_LABEL_ZOOM_THRESHOLD := 0.6

var _camera: Camera2D = null
var _move_speed: float = 0.0
var _target_zoom: float = 1.0
var _player_input_enabled: bool = true
var _pause_input_blocked: bool = false
var _chat_input_blocked: bool = false
var _ui_pointer_blocking: bool = false
var _ui_text_input_focused: bool = false
var _map_loader: Node = null
var _label_region_active: bool = false  # true when zoom < threshold
var _map_bounds: Rect2 = Rect2()
var _bounds_ready: bool = false
var _right_drag_tracking: bool = false
var _right_drag_active: bool = false
var _right_drag_start_screen: Vector2 = Vector2.ZERO
var _zoom_anchor_active: bool = false
var _zoom_anchor_screen: Vector2 = Vector2.ZERO
var _zoom_anchor_world: Vector2 = Vector2.ZERO


func setup(camera: Camera2D, map_loader: Node) -> void:
	_camera = camera
	_map_loader = map_loader
	_target_zoom = camera.zoom.x
	if not EventBus.pause_menu_blocking_changed.is_connected(_on_pause_menu_blocking_changed):
		EventBus.pause_menu_blocking_changed.connect(_on_pause_menu_blocking_changed)
	if not EventBus.chat_input_focus_changed.is_connected(_on_chat_input_focus_changed):
		EventBus.chat_input_focus_changed.connect(_on_chat_input_focus_changed)
	if not EventBus.ui_pointer_blocking_changed.is_connected(_on_ui_pointer_blocking_changed):
		EventBus.ui_pointer_blocking_changed.connect(_on_ui_pointer_blocking_changed)
	if not EventBus.ui_text_input_focus_changed.is_connected(_on_ui_text_input_focus_changed):
		EventBus.ui_text_input_focus_changed.connect(_on_ui_text_input_focus_changed)


func _process(delta: float) -> void:
	if _camera == null:
		return
	if not _bounds_ready and _map_loader != null:
		var b: Rect2 = _map_loader.get_map_bounds()
		if b.size != Vector2.ZERO:
			_map_bounds = b
			_bounds_ready = true
	_handle_movement(delta)
	var next_zoom: float = lerpf(
		_camera.zoom.x,
		_target_zoom,
		minf(ZOOM_SPEED * delta, 1.0)
	)
	if is_equal_approx(next_zoom, _target_zoom):
		next_zoom = _target_zoom
	if _zoom_anchor_active:
		_apply_cursor_anchored_zoom(next_zoom)
	else:
		_camera.zoom = Vector2(next_zoom, next_zoom)
	_clamp_position()
	if next_zoom == _target_zoom:
		_reset_zoom_anchor()
	var now_in_label_region: bool = _camera.zoom.x < NATION_LABEL_ZOOM_THRESHOLD
	if now_in_label_region != _label_region_active:
		_label_region_active = now_in_label_region
		zoom_changed.emit(_camera.zoom.x)


## Captures right-button map gestures before province and unit input can act on them.
## A release below the drag threshold is forwarded as a gameplay right-click request.
## Parameters:
## - event: raw viewport mouse input.
## Returns: nothing.
func _input(event: InputEvent) -> void:
	if _camera == null:
		return

	if event is InputEventMouseButton:
		var mouse_button: InputEventMouseButton = event as InputEventMouseButton
		if mouse_button.button_index != MOUSE_BUTTON_RIGHT:
			return

		if mouse_button.pressed:
			if not _player_input_enabled or _ui_pointer_blocking:
				return
			_right_drag_tracking = true
			_right_drag_active = false
			_right_drag_start_screen = mouse_button.position
			get_viewport().set_input_as_handled()
			return

		if not _right_drag_tracking:
			return

		var completed_drag: bool = _right_drag_active
		_reset_right_drag()
		get_viewport().set_input_as_handled()
		if not completed_drag and _player_input_enabled:
			right_click_requested.emit(mouse_button.position, mouse_button.shift_pressed)
		return

	if event is InputEventMouseMotion and _right_drag_tracking:
		var mouse_motion: InputEventMouseMotion = event as InputEventMouseMotion
		if (
			not _right_drag_active
			and _right_drag_start_screen.distance_to(mouse_motion.position)
				>= RIGHT_DRAG_THRESHOLD_PX
		):
			_right_drag_active = true

		if _right_drag_active:
			_reset_zoom_anchor()
			_camera.position -= mouse_motion.relative / _camera.zoom.x
			_clamp_position()
		get_viewport().set_input_as_handled()


func _unhandled_input(event: InputEvent) -> void:
	if not _player_input_enabled:
		return

	if event is InputEventMouseButton:
		if _ui_pointer_blocking:
			return
		var mb: InputEventMouseButton = event as InputEventMouseButton
		if mb.pressed:
			if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
				var next_target_zoom: float = clampf(
					_target_zoom + ZOOM_STEP,
					MIN_ZOOM,
					MAX_ZOOM
				)
				if next_target_zoom != _target_zoom:
					_capture_zoom_anchor(mb.position)
					_target_zoom = next_target_zoom
			elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				var next_target_zoom: float = clampf(
					_target_zoom - ZOOM_STEP,
					MIN_ZOOM,
					MAX_ZOOM
				)
				if next_target_zoom != _target_zoom:
					_capture_zoom_anchor(mb.position)
					_target_zoom = next_target_zoom

	if event is InputEventKey:
		var ke: InputEventKey = event as InputEventKey
		if ke.pressed and ke.ctrl_pressed:
			if ke.keycode == KEY_EQUAL or ke.keycode == KEY_KP_ADD:
				_reset_zoom_anchor()
				_target_zoom = clampf(_target_zoom + ZOOM_KB_STEP, MIN_ZOOM, MAX_ZOOM)
				get_viewport().set_input_as_handled()
			elif ke.keycode == KEY_MINUS or ke.keycode == KEY_KP_SUBTRACT:
				_reset_zoom_anchor()
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
		_reset_zoom_anchor()
		_camera.position = pos
		_clamp_position()


func set_zoom(level: float) -> void:
	_reset_zoom_anchor()
	_target_zoom = clampf(level, MIN_ZOOM, MAX_ZOOM)


## Enables or disables player-driven camera controls without stopping camera updates.
## Parameters:
## - enabled: true when player keyboard, wheel, and right-drag input should move the camera.
## Returns: nothing.
func set_player_input_enabled(enabled: bool) -> void:
	_player_input_enabled = enabled
	if not enabled:
		_move_speed = 0.0
		_reset_right_drag()


# ── internal ──────────────────────────────────────────────────────────────────

func _handle_movement(delta: float) -> void:
	if not _player_input_enabled:
		_move_speed = 0.0
		return

	var wasd_dir: Vector2 = Vector2.ZERO
	if not _ui_text_input_focused:
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			wasd_dir.y -= 1.0
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			wasd_dir.y += 1.0
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			wasd_dir.x -= 1.0
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			wasd_dir.x += 1.0

	var wasd_active: bool = wasd_dir != Vector2.ZERO

	if wasd_active:
		_reset_zoom_anchor()
		if _move_speed == 0.0:
			_move_speed = BASE_SPEED
		_move_speed = move_toward(_move_speed, MAX_SPEED, ACCELERATION * delta)
		_camera.position += wasd_dir.normalized() * _move_speed * delta / _camera.zoom.x
		_clamp_position()
		return

	_move_speed = 0.0


## Clears right-button gesture state without emitting a gameplay click.
## Parameters: none.
## Returns: nothing.
func _reset_right_drag() -> void:
	_right_drag_tracking = false
	_right_drag_active = false
	_right_drag_start_screen = Vector2.ZERO


## Captures the world point beneath a mouse-wheel event for the smooth zoom animation.
## Parameters:
## - screen_position: cursor position in viewport coordinates.
## Returns: nothing.
func _capture_zoom_anchor(screen_position: Vector2) -> void:
	var viewport_rect: Rect2 = get_viewport().get_visible_rect()
	var viewport_center: Vector2 = viewport_rect.position + viewport_rect.size * 0.5
	_zoom_anchor_screen = screen_position
	_zoom_anchor_world = (
		_camera.position
		+ (screen_position - viewport_center) / _camera.zoom.x
	)
	_zoom_anchor_active = true


## Applies one smooth zoom step while preserving the captured cursor anchor.
## Parameters:
## - zoom_level: uniform zoom level for this frame.
## Returns: nothing.
func _apply_cursor_anchored_zoom(zoom_level: float) -> void:
	var viewport_rect: Rect2 = get_viewport().get_visible_rect()
	var viewport_center: Vector2 = viewport_rect.position + viewport_rect.size * 0.5
	var anchor_offset: Vector2 = (_zoom_anchor_screen - viewport_center) / zoom_level
	_camera.zoom = Vector2(zoom_level, zoom_level)
	_camera.position = _zoom_anchor_world - anchor_offset


## Clears any mouse-wheel zoom anchor without changing the target zoom.
## Parameters: none.
## Returns: nothing.
func _reset_zoom_anchor() -> void:
	_zoom_anchor_active = false
	_zoom_anchor_screen = Vector2.ZERO
	_zoom_anchor_world = Vector2.ZERO


func _clamp_position() -> void:
	if not _bounds_ready:
		return
	var b: Rect2 = _map_bounds
	_camera.position.x = clampf(_camera.position.x, b.position.x, b.end.x)
	_camera.position.y = clampf(_camera.position.y, b.position.y, b.end.y)


## Responds to pause menu input ownership changes.
## Parameters:
## - blocking: true when gameplay-facing player input should be ignored.
## Returns: nothing.
func _on_pause_menu_blocking_changed(blocking: bool) -> void:
	_pause_input_blocked = blocking
	_refresh_player_input_enabled()


## Responds to chat text input ownership changes.
## Parameters:
## - focused: true when chat text entry owns keyboard input.
## Returns: nothing.
func _on_chat_input_focus_changed(focused: bool) -> void:
	_chat_input_blocked = focused
	_refresh_player_input_enabled()


## Recomputes whether player-driven camera controls should be active.
## Parameters: none.
## Returns: nothing.
func _refresh_player_input_enabled() -> void:
	set_player_input_enabled(not (_pause_input_blocked or _chat_input_blocked))


## Responds to HUD/UI hover ownership changes.
## Parameters:
## - blocking: true when pointer-driven map camera controls should ignore the mouse.
## Returns: nothing.
func _on_ui_pointer_blocking_changed(blocking: bool) -> void:
	_ui_pointer_blocking = blocking


## Responds to text input focus changes in HUD/UI.
## Parameters:
## - focused: true when a text input owns keyboard input.
## Returns: nothing.
func _on_ui_text_input_focus_changed(focused: bool) -> void:
	_ui_text_input_focused = focused
	if focused:
		_move_speed = 0.0
