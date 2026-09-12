extends Control
class_name ResearchTreeCanvas
## Full Tree's pan/zoom wrapper. A plain UI-space `Control` whose `position`/`scale` are
## directly manipulated on drag/wheel — NOT a Camera2D/SubViewport (this canvas lives in
## Control-space, not world-space; see phase-11-task-c-ui-interaction.md's Critical Pre-Read).
## Reuses only the *idiom* of client/src/systems/map/camera_system.gd (drag-threshold click/
## pan arbitration, cursor-anchored zoom, smoothstep ease for animated snaps), not its code.

signal viewport_changed()

const ZOOM_STEP: float = 0.15
# Tuned against research_tree_view.gd's card layout constants (CARD_WIDTH 200 / CARD_HEIGHT 130,
# CARD_H_GAP 36 / CARD_V_GAP 48 — one path "tree" column-cell is ~236x178px) and the Full Tree
# panel's CanvasViewport, which fills most of the FULL_CENTER panel body (~900-1000px wide in
# practice). ZOOM_MIN keeps roughly 3 columns' worth of tree (~3 * 236 ≈ 700px of content) inside
# a ~900px-wide viewport at once, instead of the old 0.3 (which shrank a card to 60x39px and
# left the canvas mostly empty space). ZOOM_MAX makes one 200x130 card render at ~800x520px —
# "fills most of the screen" without letting it balloon to many times the viewport, which the
# old 2.5 (500x325px card) undershot and which an unbounded/very high max would overshoot.
const ZOOM_MIN: float = 0.55
const ZOOM_MAX: float = 4.0
const DRAG_THRESHOLD_PX: float = 8.0
const FIT_TWEEN_DURATION: float = 0.35

var _target_zoom: float = 1.0
var _drag_start_mouse: Vector2 = Vector2.ZERO
var _drag_start_position: Vector2 = Vector2.ZERO
var _dragging: bool = false
var _drag_confirmed: bool = false
var _fit_tween: Tween = null


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS
	pivot_offset = Vector2.ZERO


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb: InputEventMouseButton = event
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_zoom_at(mb.position, ZOOM_STEP)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_zoom_at(mb.position, -ZOOM_STEP)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT or mb.button_index == MOUSE_BUTTON_RIGHT:
			if mb.pressed:
				_dragging = true
				_drag_confirmed = false
				_drag_start_mouse = mb.position
				_drag_start_position = position
			else:
				_dragging = false
	elif event is InputEventMouseMotion and _dragging:
		var mm: InputEventMouseMotion = event
		if not _drag_confirmed:
			if mm.position.distance_to(_drag_start_mouse) > DRAG_THRESHOLD_PX:
				_drag_confirmed = true
		if _drag_confirmed:
			position += mm.relative
			viewport_changed.emit()
			accept_event()


## Cursor-anchored zoom: adjusts position so the point under the cursor stays visually fixed
## as scale changes, matching camera_system.gd's cursor-anchored zoom math at UI scale.
## Parameters:
## - mouse_pos: pointer position local to this canvas's parent (viewport-clip) space.
## - delta: signed zoom step to apply.
## Returns: nothing.
func _zoom_at(mouse_pos: Vector2, delta: float) -> void:
	var before: Vector2 = (mouse_pos - position) / scale
	_target_zoom = clampf(_target_zoom + delta, ZOOM_MIN, ZOOM_MAX)
	scale = Vector2(_target_zoom, _target_zoom)
	position = mouse_pos - before * scale
	viewport_changed.emit()


## Directly sets zoom (used by the [-]/[+] buttons), cursor-anchored to the canvas's own
## current visual center rather than a mouse position.
## Parameters:
## - delta: signed zoom step to apply.
## - viewport_size: the clipping viewport's size, used as the anchor point.
## Returns: nothing.
func step_zoom(delta: float, viewport_size: Vector2) -> void:
	_zoom_at(viewport_size * 0.5, delta)


## Smoothstep-eased tween of position/scale to fit content_bounds within viewport_size, with
## a small margin so nothing touches the viewport edge. Mirrors camera_system.gd's ease shape
## (t*t*(3-2t)) via Godot's built-in EASE_IN_OUT cubic-ish TRANS_QUINT/TRANS_CUBIC curve —
## Tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT) approximates the same smooth
## start/stop shape as a hand-rolled smoothstep.
## Parameters:
## - content_bounds: local-space rect (in this canvas's own coordinate space) to fit.
## - viewport_size: size of the clipping viewport this canvas is displayed within.
## Returns: nothing.
func snap_to_fit(content_bounds: Rect2, viewport_size: Vector2) -> void:
	if content_bounds.size.x <= 0.0 or content_bounds.size.y <= 0.0:
		return
	const MARGIN_RATIO: float = 0.88
	var zoom_x: float = (viewport_size.x * MARGIN_RATIO) / content_bounds.size.x
	var zoom_y: float = (viewport_size.y * MARGIN_RATIO) / content_bounds.size.y
	var fit_zoom: float = clampf(minf(zoom_x, zoom_y), ZOOM_MIN, ZOOM_MAX)
	var fit_position: Vector2 = (viewport_size * 0.5) - (content_bounds.get_center() * fit_zoom)
	_animate_to(fit_position, fit_zoom)


## Snaps directly (no animation) to a given position/zoom — used for the initial "researched
## frontier" default view on open, where an animated fly-in isn't warranted.
## Parameters:
## - target_position: canvas position to set immediately.
## - target_zoom: canvas zoom to set immediately.
## Returns: nothing.
func snap_immediate(target_position: Vector2, target_zoom: float) -> void:
	if _fit_tween != null and _fit_tween.is_valid():
		_fit_tween.kill()
	_target_zoom = clampf(target_zoom, ZOOM_MIN, ZOOM_MAX)
	scale = Vector2(_target_zoom, _target_zoom)
	position = target_position
	viewport_changed.emit()


## Opens zoomed to researched + directly-adjacent-available nodes only, NOT the full overview
## — per RESEARCH_UI_HANDOFF.md §4.2's explicit rationale (avoid the Path-of-Exile "intimidating
## full tree" failure mode). Falls back to fitting the whole tree if the frontier bounds are
## degenerate (e.g. nothing researched yet and no adjacency computed).
## Parameters:
## - frontier_bounds: local-space rect covering the researched/adjacent-available node set.
## - viewport_size: size of the clipping viewport this canvas is displayed within.
## Returns: nothing.
func default_frontier_view(frontier_bounds: Rect2, viewport_size: Vector2) -> void:
	if frontier_bounds.size.x <= 0.0 or frontier_bounds.size.y <= 0.0:
		snap_immediate(Vector2.ZERO, 1.0)
		return
	const MARGIN_RATIO: float = 0.7
	var zoom_x: float = (viewport_size.x * MARGIN_RATIO) / maxf(frontier_bounds.size.x, 1.0)
	var zoom_y: float = (viewport_size.y * MARGIN_RATIO) / maxf(frontier_bounds.size.y, 1.0)
	var frontier_zoom: float = clampf(minf(zoom_x, zoom_y), ZOOM_MIN, 1.15)
	var frontier_position: Vector2 = (viewport_size * 0.5) - (frontier_bounds.get_center() * frontier_zoom)
	snap_immediate(frontier_position, frontier_zoom)


func _animate_to(target_position: Vector2, target_zoom: float) -> void:
	if _fit_tween != null and _fit_tween.is_valid():
		_fit_tween.kill()
	_target_zoom = target_zoom
	_fit_tween = create_tween()
	_fit_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_fit_tween.set_parallel(true)
	_fit_tween.tween_property(self, "position", target_position, FIT_TWEEN_DURATION)
	_fit_tween.tween_property(self, "scale", Vector2(target_zoom, target_zoom), FIT_TWEEN_DURATION)
	_fit_tween.chain().tween_callback(viewport_changed.emit)
