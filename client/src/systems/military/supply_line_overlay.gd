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
## Foreign-division lines are gated by the same fog-of-war reveal/hide signals
## `military_system.gd` uses for division icons; an own division's line persists regardless
## of fog. This node reads `GameState` only — it never writes to it.

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


var _map_loader: MapLoader = null
# division_id → _RouteLineState. Deliberately not named `_route_overlays` — that name is
# already used by military_system.gd for movement-order preview lines, an unrelated concept.
var _route_lines: Dictionary = {}

var _active_division_id: String = ""
var _selected_division_ids: Array[String] = []


## Configures the draw layer and connects the one-time signal wiring. Godot only calls
## `_init()` once per object, so this never double-connects across `setup()` calls.
## Parameters: none.
## Returns: nothing.
func _init() -> void:
	z_as_relative = false
	# Strictly between VisionRenderLayers.SUPPLY_ROUTE_Z (22) and WORLD_MARKER_Z (30).
	z_index = 26
	_connect_signals()


## Registers the MapLoader used to resolve subprovince centroids, then syncs any supply
## routes GameState already cached before this overlay was set up (e.g. a late scene load
## after the server already sent updates).
## Parameters:
## - loader: loaded MapLoader providing subprovince geometry lookups.
## Returns: nothing.
func setup(loader: MapLoader) -> void:
	_map_loader = loader
	_sync_existing_routes()


func _process(delta: float) -> void:
	for division_id: Variant in _route_lines.keys():
		_advance_pulse(String(division_id), delta)


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
	_apply_route(division_id, route)


func _apply_route(division_id: String, route: Dictionary) -> void:
	var state: _RouteLineState = _route_lines.get(division_id) as _RouteLineState
	if state == null:
		state = _RouteLineState.new()
		state.wrapper = Node2D.new()
		state.wrapper.name = "SupplyRoute_" + division_id
		state.line = Line2D.new()
		state.line.antialiased = true
		state.line.z_as_relative = false
		state.wrapper.add_child(state.line)
		add_child(state.wrapper)
		_route_lines[division_id] = state

	state.line.points = _polyline_for_route(route)
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


## Converts a route's `subprovinceIds` into a screen-space polyline. `MapLoader.
## get_subprovince_polygon()` already returns fully-projected points (it calls
## `MapProjection.project_ring()` internally), so this only averages them into a centroid —
## re-projecting here would double-project. Cells that don't resolve to a polygon are
## skipped rather than inserting `Vector2.ZERO`.
## Parameters:
## - route: the SupplyRoute dict whose `subprovinceIds` to trace.
## Returns: the resolved screen-space polyline (may be shorter than `subprovinceIds` if
## some cells didn't resolve).
func _polyline_for_route(route: Dictionary) -> PackedVector2Array:
	var subprovince_ids: Array = route.get("subprovinceIds", [])
	var points := PackedVector2Array()
	for raw_id: Variant in subprovince_ids:
		var polygon: PackedVector2Array = _map_loader.get_subprovince_polygon(String(raw_id))
		if polygon.is_empty():
			continue
		points.append(_centroid(polygon))
	return points


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
## Adds its line if GameState already has a cached route for it and that route's status is
## displayable. Own divisions already have their line regardless, so this is a no-op for
## them beyond the redundant (harmless) refresh.
## Parameters:
## - division_id: the division that became visible.
## Returns: nothing.
func _on_division_revealed(division_id: String) -> void:
	_sync_division_line(division_id)


func _on_division_appeared(division_id: String) -> void:
	_sync_division_line(division_id)


func _sync_division_line(division_id: String) -> void:
	if not GameState.supply_routes.has(division_id):
		return
	_on_supply_route_updated(division_id, GameState.supply_routes[division_id])


## A foreign division left view (fog reclaimed it, or it vanished). Removes its line —
## but only for foreign divisions; an own unit's supply line persists regardless of fog.
## Parameters:
## - division_id: the division that left visibility.
## Returns: nothing.
func _on_division_hidden(division_id: String) -> void:
	if _is_own_unit(division_id):
		return
	_remove_route_line(division_id)


func _on_division_vanishing(division_id: String) -> void:
	if _is_own_unit(division_id):
		return
	_remove_route_line(division_id)


# ── Selection emphasis ───────────────────────────────────────────────────────

func _on_division_selection_changed(division_ids: Array[String]) -> void:
	_selected_division_ids = division_ids.duplicate()


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

	var alpha: float = lerpf(PULSE_ALPHA_MIN, PULSE_ALPHA_MAX, pulse)
	alpha *= _emphasis_alpha_mult(division_id)
	var width: float = state.base_width \
			* lerpf(1.0 - PULSE_WIDTH_AMPLITUDE, 1.0 + PULSE_WIDTH_AMPLITUDE, pulse) \
			* _emphasis_width_mult(division_id)

	var color: Color = state.base_color
	color.a = alpha
	state.line.default_color = color
	state.line.width = width
