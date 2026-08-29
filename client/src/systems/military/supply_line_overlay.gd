class_name SupplyLineOverlay
extends Node2D
## Renders `GameState.supply_routes` as polylines over the map (Batch 7, client-only
## visualization).
##
## Draws one `Line2D` per division with a currently-displayable supply route, connecting
## the centroids of the route's `subprovinceIds` in order. Never recomputes route data:
## every visual field (points, color, pulse) is derived purely from the server-authoritative
## `SupplyRoute` dict last received for that division. `cut_off` and `encircled` routes are
## deliberately not drawn here at all — `division_icon.gd` already renders an encirclement
## ring / cut-off badge from the live, different `DivisionState.supply_status` field; this
## overlay must not duplicate that.
##
## Own-division lines are gated by selection: only a division currently in
## `EventBus.division_selection_changed`'s multi-selection shows a line, and deselecting it
## removes the line immediately — but once selected, it persists regardless of fog (own units
## are never hidden from their own player). Foreign-division lines are instead gated by the
## same fog-of-war reveal/hide signals `military_system.gd` uses for division icons, tracked
## locally in `_visible_foreign_ids` rather than assumed from the server. This node reads
## `GameState` only — it never writes to it.

## Route line color/pulse table, mirroring `map_renderer.gd`'s `NATION_PALETTE` convention:
## a centralized style Dictionary instead of inline magic numbers. Values are illustrative/
## tunable, consistent with how other untested density/timing constants are marked elsewhere
## in this codebase (see `subprovince_renderer.gd`'s `CAPTURE_FADE_DURATION`).
## "degraded" has no single entry: it interpolates continuously between "degraded_mild" (at
## throughputRatio near 1.0) and "degraded_severe" (at throughputRatio near 0.0). "cut_off"
## and "encircled" have no entries at all — those statuses render nothing (see class doc).
const ROUTE_STYLE: Dictionary = {
	"open": {"color": Color(0.2, 0.8, 0.9), "pulse_rate": 2.0, "width": 4.0},
	"degraded_mild": {"color": Color(0.9, 0.7, 0.2), "pulse_rate": 1.0, "width": 4.0},
	"degraded_severe": {"color": Color(0.85, 0.2, 0.2), "pulse_rate": 3.5, "width": 3.0},
}

## Pulse alpha oscillates between these two bounds at each line's `pulse_rate` (full cycles
## per second). Tunable.
const PULSE_ALPHA_MIN := 0.55
const PULSE_ALPHA_MAX := 1.0
## Width breathes by +/- this fraction of the base width across the same cycle. Tunable.
const PULSE_WIDTH_AMPLITUDE := 0.15

## Selection emphasis multipliers, mirroring the active/selected distinction
## `EventBus.division_active_changed` / `division_selection_changed` drive in
## `military_system.gd`. Tunable.
const ACTIVE_ALPHA_MULT := 1.0
const ACTIVE_WIDTH_MULT := 1.0
const SELECTED_ALPHA_MULT := 0.55
const SELECTED_WIDTH_MULT := 0.75

## Statuses this overlay never draws a line for — the encirclement/cut-off badges already
## live on the division icon from a different, live field. See class doc.
const HIDDEN_STATUSES: PackedStringArray = ["cut_off", "encircled"]

## Visual-redesign constants (follow-up to the initial flat-line styling): a "flow" band travels
## along the line from the far/hub end (points[-1]) toward the division end (points[0]) — the
## direction supplies actually move — instead of the whole line breathing uniformly. Tunable,
## illustrative, same convention as ROUTE_STYLE above.
const FLOW_BAND_WIDTH := 0.22
const FLOW_DIM_ALPHA_MULT := 0.35
const FLOW_BRIGHT_ALPHA_MULT := 1.15
## Width tapers from narrow at the division end (points[0]) to full width at the far/hub end
## (points[-1]), reinforcing the same hub→division flow direction without extra draw calls.
const WIDTH_TAPER_NEAR_MULT := 0.55
const WIDTH_TAPER_FAR_MULT := 1.0

## Road-snap + off-road smoothing constants (follow-up visual pass). While a route crosses a
## road-kind cell with resolved geometry (MapLoader.get_road_geometry_points()), the drawn line
## follows the literal road curve exactly — these constants only affect the off-road stretches.
## Off-road anchor points (cell centroids) get a small, deterministic per-cell offset so the line
## reads as a natural wandering trail instead of a rigid centroid-to-centroid zigzag, then a
## Catmull-Rom spline is fit through the (wandered) anchors for a smooth curve. Tunable.
const OFFROAD_WANDER_FRACTION := 0.08 # fraction of a cell's bounding-box shorter side
const OFFROAD_SPLINE_SAMPLES_PER_SEGMENT := 5


## Per-division render state: the wrapper/line nodes plus the pulse animation phase and the
## resolved base style (post degraded-gradient interpolation) that _process() animates from
## every frame. Pure presentation state — never read by or written from GameState.
class _RouteLineState:
	extends RefCounted
	var wrapper: Node2D
	var line: Line2D
	var status: String = ""
	var base_color: Color = Color.WHITE
	var base_width: float = 4.0
	var pulse_rate: float = 2.0
	var pulse_phase: float = 0.0
	# The subprovinceIds the currently-displayed line.points was built from — lets _apply_route
	# skip re-running the wander+spline pipeline on a status-only update (e.g. throughputRatio
	# ticking slightly without the path itself changing), which the server broadcasts on a fixed
	# cadence regardless of whether the path changed (see GameRoom.ts's SUPPLY_TICK_INTERVAL).
	var last_subprovince_ids: Array = []
	# Owned Gradient driving the traveling flow band (see FLOW_BAND_WIDTH's doc comment); rebuilt
	# in-place every frame rather than reassigned, to avoid a per-frame resource allocation.
	var gradient: Gradient = null


var _map_loader: MapLoader = null
# Source of live, per-frame division screen positions (military_system.gd's
# get_division_world_position). Used only to keep a displayed route's first point glued to a
# moving division between server SUPPLY_ROUTE_UPDATE pushes — never to recompute the route itself.
var _military_system: Node = null
# division_id → _RouteLineState. Deliberately not named `_route_overlays` — that name is
# already used by military_system.gd for movement-order preview lines, an unrelated concept.
var _route_lines: Dictionary = {}

var _active_division_id: String = ""
var _selected_division_ids: Array[String] = []
# division_id → true for every foreign (non-own) division currently known-visible via
# division_revealed/division_appeared and not yet re-hidden. Own-unit display is instead
# gated by selection membership (_selected_division_ids) — see _should_display().
var _visible_foreign_ids: Dictionary = {}


## Configures the draw layer and connects the one-time signal wiring. Godot only calls
## `_init()` once per object, so this never double-connects across `setup()` calls.
## Parameters: none.
## Returns: nothing.
func _init() -> void:
	z_as_relative = false
	# Strictly between VisionRenderLayers.SUPPLY_ROUTE_Z (22) and WORLD_MARKER_Z (30).
	z_index = 26
	_connect_signals()


## Registers the MapLoader used to resolve subprovince centroids and the MilitarySystem used to
## read live division positions, then syncs any supply routes GameState already cached before
## this overlay was set up (e.g. a late scene load after the server already sent updates).
## Parameters:
## - loader: loaded MapLoader providing subprovince geometry lookups.
## - military_system: MilitarySystem instance exposing get_division_world_position(); may be null
##   (e.g. in a test harness), in which case live-position tracking is simply skipped.
## Returns: nothing.
func setup(loader: MapLoader, military_system: Node = null) -> void:
	_map_loader = loader
	_military_system = military_system
	_sync_existing_routes()


func _process(delta: float) -> void:
	for division_id: Variant in _route_lines.keys():
		_advance_pulse(String(division_id), delta)
		_sync_live_start_point(String(division_id))


# ── Signal wiring ────────────────────────────────────────────────────────────

func _connect_signals() -> void:
	if not EventBus.supply_route_updated.is_connected(_on_supply_route_updated):
		EventBus.supply_route_updated.connect(_on_supply_route_updated)
	if not EventBus.division_revealed.is_connected(_on_division_revealed):
		EventBus.division_revealed.connect(_on_division_revealed)
	if not EventBus.division_hidden.is_connected(_on_division_hidden):
		EventBus.division_hidden.connect(_on_division_hidden)
	if not EventBus.division_appeared.is_connected(_on_division_appeared):
		EventBus.division_appeared.connect(_on_division_appeared)
	if not EventBus.division_vanishing.is_connected(_on_division_vanishing):
		EventBus.division_vanishing.connect(_on_division_vanishing)
	if not EventBus.division_selection_changed.is_connected(_on_division_selection_changed):
		EventBus.division_selection_changed.connect(_on_division_selection_changed)
	if not EventBus.division_active_changed.is_connected(_on_division_active_changed):
		EventBus.division_active_changed.connect(_on_division_active_changed)


## Replays every route GameState already holds through the normal update path, so lines
## exist immediately after `setup()` without waiting for the next server broadcast.
## Parameters: none.
## Returns: nothing.
func _sync_existing_routes() -> void:
	for division_id: Variant in GameState.supply_routes.keys():
		var route: Dictionary = GameState.supply_routes[division_id]
		_on_supply_route_updated(String(division_id), route)


# ── Route updates ────────────────────────────────────────────────────────────

## Reacts to a freshly-received (or replayed) SupplyRoute for one division. Renders exactly
## what the server sent: no field is recomputed or approximated client-side. Updates an
## existing line in place rather than duplicating a node when one already exists.
## Parameters:
## - division_id: the division the route belongs to.
## - route: the SupplyRoute dict (see class doc for shape).
## Returns: nothing.
func _on_supply_route_updated(division_id: String, route: Dictionary) -> void:
	var status: String = String(route.get("status", ""))
	if HIDDEN_STATUSES.has(status):
		_remove_route_line(division_id)
		return
	if _map_loader == null:
		return
	if not _should_display(division_id):
		return
	_apply_route(division_id, route)


## Whether a division's supply line should currently be drawn at all, independent of its
## route status. Own units are gated by selection: only divisions in the current multi-
## selection show a line (deselecting an own division removes its line). Foreign units are
## gated by locally-tracked fog visibility (`_visible_foreign_ids`), set from
## division_revealed/division_appeared and cleared on division_hidden/division_vanishing —
## the client must not assume the server only sends supply_route_updated for divisions it
## already knows are visible.
## Parameters:
## - division_id: the division to check.
## Returns: true if a line should be created/kept for this division right now.
func _should_display(division_id: String) -> bool:
	if _is_own_unit(division_id):
		return _selected_division_ids.has(division_id)
	return _visible_foreign_ids.has(division_id)


func _apply_route(division_id: String, route: Dictionary) -> void:
	var state: _RouteLineState = _route_lines.get(division_id) as _RouteLineState
	if state == null:
		state = _RouteLineState.new()
		state.wrapper = Node2D.new()
		state.wrapper.name = "SupplyRoute_" + division_id
		state.line = Line2D.new()
		state.line.antialiased = true
		state.line.z_as_relative = false
		# Width tapers along the line instead of being uniform — see WIDTH_TAPER_*'s doc comment.
		var taper := Curve.new()
		taper.add_point(Vector2(0.0, WIDTH_TAPER_NEAR_MULT))
		taper.add_point(Vector2(1.0, WIDTH_TAPER_FAR_MULT))
		state.line.width_curve = taper
		state.gradient = Gradient.new()
		state.line.gradient = state.gradient
		state.wrapper.add_child(state.line)
		add_child(state.wrapper)
		_route_lines[division_id] = state

	var subprovince_ids: Array = route.get("subprovinceIds", [])
	if subprovince_ids != state.last_subprovince_ids:
		state.line.points = _polyline_for_route(route)
		state.last_subprovince_ids = subprovince_ids.duplicate()
	_resolve_style(state, route)


## Resolves a route's base color/pulse-rate/width from the style table. "open" reads its
## entry directly; "degraded" interpolates between "degraded_mild" and "degraded_severe" as
## a continuous function of `throughputRatio` (clamped to [0, 1]) — a real Color.lerp/lerpf
## interpolation, not a threshold switch to a discrete alternate style, per the design
## correction that degraded routes must read as a gradient, not a fixed amber color.
## Parameters:
## - state: the route's render state to update in place.
## - route: the SupplyRoute dict this update came from.
## Returns: nothing.
func _resolve_style(state: _RouteLineState, route: Dictionary) -> void:
	var status: String = String(route.get("status", ""))
	state.status = status
	if status == "degraded":
		var ratio: float = clampf(float(route.get("throughputRatio", 1.0)), 0.0, 1.0)
		# t = 0 at ratio 1.0 (mild anchor) → t = 1 at ratio 0.0 (severe anchor).
		var t: float = 1.0 - ratio
		var mild: Dictionary = ROUTE_STYLE["degraded_mild"]
		var severe: Dictionary = ROUTE_STYLE["degraded_severe"]
		state.base_color = (mild["color"] as Color).lerp(severe["color"] as Color, t)
		state.pulse_rate = lerpf(mild["pulse_rate"], severe["pulse_rate"], t)
		state.base_width = lerpf(mild["width"], severe["width"], t)
	else:
		# "open" (and any unrecognized/future status) falls back to the "open" style rather
		# than crashing on a missing table entry.
		var open_style: Dictionary = ROUTE_STYLE["open"]
		state.base_color = open_style["color"]
		state.pulse_rate = open_style["pulse_rate"]
		state.base_width = open_style["width"]


## Converts a route's `subprovinceIds` into a screen-space polyline. Road-kind cells with
## resolved geometry (`MapLoader.get_road_geometry_points()`) contribute their exact, literal
## road points; everything else (hinterland/town/capital, or a road cell with no resolved
## geometry) contributes its polygon centroid as an "off-road anchor" that later gets a small
## deterministic wander offset and Catmull-Rom smoothing (see `_smooth_offroad_runs`) — see
## class doc's road-snap/off-road-smoothing constants. `MapLoader.get_subprovince_polygon()` /
## `get_road_geometry_points()` both return fully-projected points already, so no re-projection
## happens here. Cells that don't resolve to any polygon at all are skipped rather than
## inserting `Vector2.ZERO`.
## Parameters:
## - route: the SupplyRoute dict whose `subprovinceIds` to trace.
## Returns: the resolved screen-space polyline (may be shorter than `subprovinceIds` if some
## cells didn't resolve, and longer than it once off-road stretches are spline-sampled).
func _polyline_for_route(route: Dictionary) -> PackedVector2Array:
	var subprovince_ids: Array = route.get("subprovinceIds", [])
	# is_road_flags[i] tags points[i] as belonging to an exact road segment (true) or an
	# off-road anchor awaiting smoothing (false) — kept as a parallel array since
	# PackedVector2Array can't carry per-point metadata.
	var points := PackedVector2Array()
	var is_road_flags: Array[bool] = []
	var anchor_ids: Array[String] = [] # subprovince_id per off-road anchor point; "" for road points

	for raw_id: Variant in subprovince_ids:
		var sid := String(raw_id)
		var data: Dictionary = _map_loader.get_subprovince_data(sid)
		var kind: String = String(data.get("kind", ""))
		var road_points: PackedVector2Array = PackedVector2Array()
		if kind == "road":
			road_points = _map_loader.get_road_geometry_points(sid)
		if not road_points.is_empty():
			if not points.is_empty() and points[points.size() - 1].distance_squared_to(road_points[road_points.size() - 1]) \
					< points[points.size() - 1].distance_squared_to(road_points[0]):
				road_points.reverse()
			for point: Vector2 in road_points:
				points.append(point)
				is_road_flags.append(true)
				anchor_ids.append("")
			continue
		var polygon: PackedVector2Array = _map_loader.get_subprovince_polygon(sid)
		if polygon.is_empty():
			continue
		points.append(_centroid(polygon))
		is_road_flags.append(false)
		anchor_ids.append(sid)

	return _smooth_offroad_runs(points, is_road_flags, anchor_ids)


## Arithmetic centroid of an already-projected polygon, mirroring the simple averaging
## pattern in `vision_system.gd`'s `_compute_province_centroid()`.
## Parameters:
## - polygon: non-empty projected point ring.
## Returns: the average of all points.
func _centroid(polygon: PackedVector2Array) -> Vector2:
	var sum := Vector2.ZERO
	for point: Vector2 in polygon:
		sum += point
	return sum / float(polygon.size())


## Splits `points` into alternating road-exact / off-road-anchor runs (per `is_road_flags`) and
## replaces each off-road run with a wandered + Catmull-Rom-smoothed curve, leaving road runs
## untouched. Boundary segments borrow the nearest adjacent fixed point (the last road point
## before the run, or the first after it) as extra Catmull-Rom control points so the curve
## connects smoothly into the adjoining road-exact run instead of kinking at the seam; a run at
## the very start/end of the route (no adjacent fixed point) duplicates its own first/last anchor
## instead, standard open-curve boundary handling.
## Parameters:
## - points: resolved points in route order (mix of exact road points and off-road centroids).
## - is_road_flags: parallel array tagging each point as road-exact (true) or an off-road anchor.
## - anchor_ids: parallel array giving each off-road anchor's subprovince_id (for the wander
##   offset's hash seed); empty string for road points.
## Returns: the final polyline with every off-road run replaced by its smoothed curve.
func _smooth_offroad_runs(points: PackedVector2Array, is_road_flags: Array[bool], anchor_ids: Array[String]) -> PackedVector2Array:
	var result := PackedVector2Array()
	var i := 0
	while i < points.size():
		if is_road_flags[i]:
			result.append(points[i])
			i += 1
			continue
		var run_start := i
		while i < points.size() and not is_road_flags[i]:
			i += 1
		var run_end := i # exclusive
		var wandered := PackedVector2Array()
		for j in range(run_start, run_end):
			var cap: float = _wander_cap_for_cell(anchor_ids[j])
			wandered.append(points[j] + _hash_wander_offset(anchor_ids[j], cap))

		if wandered.size() == 1:
			result.append(wandered[0])
			continue

		var control := PackedVector2Array()
		control.append(points[run_start - 1] if run_start > 0 else wandered[0])
		for point: Vector2 in wandered:
			control.append(point)
		control.append(points[run_end] if run_end < points.size() else wandered[wandered.size() - 1])
		var curve: PackedVector2Array = _catmull_rom_spline(control, OFFROAD_SPLINE_SAMPLES_PER_SEGMENT)
		for point: Vector2 in curve:
			result.append(point)
	return result


## Deterministic pseudo-random offset for one off-road anchor, seeded purely by its
## `subprovince_id` (stable across redraws/frames — never re-rolled). Direction and magnitude
## both derive from a hash of the id so the same cell always wanders the same way.
## Parameters:
## - subprovince_id: the cell whose anchor point to offset.
## - cap: maximum offset magnitude (see `_wander_cap_for_cell`).
## Returns: a 2D offset with magnitude in [0, cap].
func _hash_wander_offset(subprovince_id: String, cap: float) -> Vector2:
	var h: int = hash(subprovince_id)
	var angle: float = float(((h % 3600) + 3600) % 3600) / 3600.0 * TAU
	var magnitude_frac: float = float((absi(h / 3600)) % 1000) / 1000.0
	return Vector2(cos(angle), sin(angle)) * (cap * magnitude_frac)


## Caps an off-road anchor's wander offset to a small fraction of its own cell's bounding-box
## *shorter* side (not the diagonal), so the line never wanders outside the cell it's meant to
## represent — a long/thin/concave hinterland polygon's diagonal can be much larger than its
## actual width, which previously let the offset push points well outside the cell.
## Parameters:
## - subprovince_id: the off-road cell to measure.
## Returns: the maximum wander magnitude for that cell (0.0 if the cell has no polygon).
func _wander_cap_for_cell(subprovince_id: String) -> float:
	var polygon: PackedVector2Array = _map_loader.get_subprovince_polygon(subprovince_id)
	if polygon.is_empty():
		return 0.0
	var min_pos: Vector2 = polygon[0]
	var max_pos: Vector2 = polygon[0]
	for point: Vector2 in polygon:
		min_pos = min_pos.min(point)
		max_pos = max_pos.max(point)
	var size: Vector2 = max_pos - min_pos
	return minf(size.x, size.y) * OFFROAD_WANDER_FRACTION


## Floor on the distance term inside `_centripetal_catmull_rom_point`'s knot computation, so two
## coincident control points (e.g. a duplicate seam point) never produce a divide-by-zero.
const CATMULL_ROM_EPS := 0.0001

## Samples a smooth curve through `control` via a **centripetal** (alpha = 0.5) Catmull-Rom
## spline, not the naive uniform-parameter formula: off-road cell centroids vary a lot in
## spacing, and uniform Catmull-Rom is well known to overshoot/loop when consecutive control
## points are unevenly spaced — exactly the failure mode that produced stray lines cutting across
## unrelated terrain. `control[0]` and `control[control.size() - 1]` are used only as tangent
## padding (never emitted directly) — the curve interpolates exactly through
## `control[1 .. control.size() - 2]`, matching how `_smooth_offroad_runs` builds `control`
## (padding + the real wandered anchors). No-op (returns the padded-out anchors unchanged) if
## there are fewer than 2 real anchors to connect.
## Parameters:
## - control: [pad_start, anchor_0, ..., anchor_n, pad_end], size >= 4.
## - samples_per_segment: points sampled per anchor-to-anchor segment (t in [0, 1)).
## Returns: the sampled curve, including the final anchor point exactly once at the end.
func _catmull_rom_spline(control: PackedVector2Array, samples_per_segment: int) -> PackedVector2Array:
	var result := PackedVector2Array()
	if control.size() < 4:
		for i in range(1, control.size() - 1):
			result.append(control[i])
		return result
	for seg in range(1, control.size() - 2):
		var p0: Vector2 = control[seg - 1]
		var p1: Vector2 = control[seg]
		var p2: Vector2 = control[seg + 1]
		var p3: Vector2 = control[seg + 2]
		for sample in range(samples_per_segment):
			var t: float = float(sample) / float(samples_per_segment)
			result.append(_centripetal_catmull_rom_point(p0, p1, p2, p3, t))
	result.append(control[control.size() - 2])
	return result


## Evaluates one point on a centripetal Catmull-Rom curve between `p1` and `p2`, via the standard
## Barry-Goldman pyramidal blending formula: knot values are spaced by `sqrt(distance)` between
## consecutive control points (rather than a fixed 0,1,2,3), which is the well-established fix for
## uniform Catmull-Rom's overshoot/self-intersection problem with unevenly-spaced points.
## Parameters:
## - p0, p1, p2, p3: the four control points; the curve interpolates between p1 and p2.
## - t: normalized position within the p1->p2 segment, in [0, 1).
## Returns: the interpolated point.
func _centripetal_catmull_rom_point(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t0 := 0.0
	var t1: float = t0 + sqrt(maxf(p0.distance_to(p1), CATMULL_ROM_EPS))
	var t2: float = t1 + sqrt(maxf(p1.distance_to(p2), CATMULL_ROM_EPS))
	var t3: float = t2 + sqrt(maxf(p2.distance_to(p3), CATMULL_ROM_EPS))
	var tt: float = lerpf(t1, t2, t)

	var a1: Vector2 = p0 * ((t1 - tt) / (t1 - t0)) + p1 * ((tt - t0) / (t1 - t0))
	var a2: Vector2 = p1 * ((t2 - tt) / (t2 - t1)) + p2 * ((tt - t1) / (t2 - t1))
	var a3: Vector2 = p2 * ((t3 - tt) / (t3 - t2)) + p3 * ((tt - t2) / (t3 - t2))
	var b1: Vector2 = a1 * ((t2 - tt) / (t2 - t0)) + a2 * ((tt - t0) / (t2 - t0))
	var b2: Vector2 = a2 * ((t3 - tt) / (t3 - t1)) + a3 * ((tt - t1) / (t3 - t1))
	return b1 * ((t2 - tt) / (t2 - t1)) + b2 * ((tt - t1) / (t2 - t1))


func _remove_route_line(division_id: String) -> void:
	var state: _RouteLineState = _route_lines.get(division_id) as _RouteLineState
	if state == null:
		return
	state.wrapper.queue_free()
	_route_lines.erase(division_id)


# ── Fog-of-war visibility ────────────────────────────────────────────────────

## Mirrors military_system.gd's `_is_own_unit()` exactly: an empty `get_my_nation_id()`
## (standalone/debug mode with no auth) is treated as "own" so nothing is hidden locally.
## Parameters:
## - division_id: the division to check.
## Returns: true if the division belongs to the local player's nation (or no nation is set).
func _is_own_unit(division_id: String) -> bool:
	var my_nation: String = GameState.get_my_nation_id()
	if my_nation.is_empty():
		return true
	return GameState.get_division(division_id).get("nation_id", "") == my_nation


## A foreign division came into view (air/vision reveal, or newly appeared on the map).
## Marks it locally-visible, then adds its line if GameState already has a cached route for
## it and that route's status is displayable. Only meaningful for foreign divisions (own
## divisions are gated by selection, not this dict), but harmless to set either way.
## Parameters:
## - division_id: the division that became visible.
## Returns: nothing.
func _on_division_revealed(division_id: String) -> void:
	_visible_foreign_ids[division_id] = true
	_sync_division_line(division_id)


func _on_division_appeared(division_id: String) -> void:
	_visible_foreign_ids[division_id] = true
	_sync_division_line(division_id)


func _sync_division_line(division_id: String) -> void:
	if not GameState.supply_routes.has(division_id):
		return
	_on_supply_route_updated(division_id, GameState.supply_routes[division_id])


## A foreign division left view (fog reclaimed it, or it vanished). Clears its local
## visibility tracking and removes its line — but only for foreign divisions; an own unit's
## supply line is instead governed by selection membership and persists regardless of fog.
## Parameters:
## - division_id: the division that left visibility.
## Returns: nothing.
func _on_division_hidden(division_id: String) -> void:
	if _is_own_unit(division_id):
		return
	_visible_foreign_ids.erase(division_id)
	_remove_route_line(division_id)


func _on_division_vanishing(division_id: String) -> void:
	if _is_own_unit(division_id):
		return
	_visible_foreign_ids.erase(division_id)
	_remove_route_line(division_id)


# ── Selection emphasis ───────────────────────────────────────────────────────

## Reconciles displayed lines against the new multi-selection (own units only — foreign
## divisions never appear in `division_ids`, per military_system.gd's existing selection
## filter). A newly-selected own division with a cached, displayable route gets a line
## created; a division that was selected and no longer is loses its line immediately
## (distinct from the fog-persistence rule, which only protects against
## division_hidden/division_vanishing, not against deselection).
## Parameters:
## - division_ids: the full new multi-selection.
## Returns: nothing.
func _on_division_selection_changed(division_ids: Array[String]) -> void:
	var previous_ids: Array[String] = _selected_division_ids
	_selected_division_ids = division_ids.duplicate()

	for division_id: String in _selected_division_ids:
		if not previous_ids.has(division_id):
			_sync_division_line(division_id)

	for division_id: String in previous_ids:
		if not _selected_division_ids.has(division_id):
			_remove_route_line(division_id)


func _on_division_active_changed(division_id: String) -> void:
	_active_division_id = division_id


func _emphasis_alpha_mult(division_id: String) -> float:
	if division_id == _active_division_id:
		return ACTIVE_ALPHA_MULT
	if _selected_division_ids.has(division_id):
		return SELECTED_ALPHA_MULT
	return 1.0


func _emphasis_width_mult(division_id: String) -> float:
	if division_id == _active_division_id:
		return ACTIVE_WIDTH_MULT
	if _selected_division_ids.has(division_id):
		return SELECTED_WIDTH_MULT
	return 1.0


# ── Pulse animation ──────────────────────────────────────────────────────────

## Advances one line's pulse phase and writes the resulting color/width to its `Line2D`.
## Pure visual animation: reads no GameState value and writes none — only this node's own
## child nodes and its own `_RouteLineState` bookkeeping.
## Parameters:
## - division_id: the division whose line to animate.
## - delta: frame delta seconds.
## Returns: nothing.
func _advance_pulse(division_id: String, delta: float) -> void:
	var state: _RouteLineState = _route_lines.get(division_id) as _RouteLineState
	if state == null:
		return
	state.pulse_phase = fmod(state.pulse_phase + state.pulse_rate * delta, 1.0)
	var pulse: float = 0.5 + 0.5 * sin(state.pulse_phase * TAU)

	var emphasis_alpha: float = _emphasis_alpha_mult(division_id)
	var width: float = state.base_width \
			* lerpf(1.0 - PULSE_WIDTH_AMPLITUDE, 1.0 + PULSE_WIDTH_AMPLITUDE, pulse) \
			* _emphasis_width_mult(division_id)
	state.line.width = width

	_update_flow_gradient(state, emphasis_alpha)


## Rebuilds the traveling "flow" gradient in place for one frame: a bright band centered at
## `state.pulse_phase` (already advanced by _advance_pulse) against an otherwise-dim line, giving
## the impression of supplies moving along the route rather than the whole line breathing at once.
## Band position is measured from the line's far/hub end (gradient offset 1.0, points[-1]) toward
## the division end (gradient offset 0.0, points[0]) as pulse_phase increases, matching the
## direction supplies actually flow — see FLOW_BAND_WIDTH's doc comment.
## Parameters:
## - state: the route's render state (reads pulse_phase/base_color, writes into state.gradient).
## - emphasis_alpha: the active/selected emphasis alpha multiplier to apply on top of the band.
## Returns: nothing.
func _update_flow_gradient(state: _RouteLineState, emphasis_alpha: float) -> void:
	# Gradient.offsets must be strictly increasing (no two equal), so every clamp below leaves an
	# EPS margin from its neighbor rather than clamping flush against 0.0/1.0/each other.
	const EPS := 0.001
	var band_center: float = clampf(1.0 - state.pulse_phase, 2.0 * EPS, 1.0 - 2.0 * EPS)
	var half_band: float = FLOW_BAND_WIDTH * 0.5
	var band_start: float = clampf(band_center - half_band, EPS, band_center - EPS)
	var band_end: float = clampf(band_center + half_band, band_center + EPS, 1.0 - EPS)

	var dim_color: Color = state.base_color
	dim_color.a = FLOW_DIM_ALPHA_MULT * emphasis_alpha
	var bright_color: Color = state.base_color
	bright_color.a = minf(FLOW_BRIGHT_ALPHA_MULT * emphasis_alpha, 1.0)

	# Gradient offsets must be strictly increasing; when the band sits at an edge, band_start/
	# band_end collapse toward 0.0/1.0 respectively rather than crossing, so this stays valid.
	var offsets := PackedFloat32Array([0.0, band_start, band_center, band_end, 1.0])
	var colors := PackedColorArray([dim_color, dim_color, bright_color, dim_color, dim_color])
	state.gradient.offsets = offsets
	state.gradient.colors = colors


## Keeps a route's first point glued to the division's live, per-frame interpolated position
## instead of the static subprovince centroid it was built from — this is what makes the line
## track a moving unit smoothly between server SUPPLY_ROUTE_UPDATE pushes rather than only
## snapping into place on the next discrete update. Purely a display-time repositioning of the
## already-resolved first vertex; the rest of the polyline (and the route data itself) is
## untouched.
## Parameters:
## - division_id: the division whose displayed line's first point to refresh.
## Returns: nothing.
func _sync_live_start_point(division_id: String) -> void:
	if _military_system == null:
		return
	var state: _RouteLineState = _route_lines.get(division_id) as _RouteLineState
	if state == null or state.line.get_point_count() == 0:
		return
	var world_pos: Vector2 = _military_system.get_division_world_position(division_id)
	if not is_finite(world_pos.x) or not is_finite(world_pos.y):
		return
	var local_pos: Vector2 = state.wrapper.to_local(world_pos)
	state.line.set_point_position(0, local_pos)
