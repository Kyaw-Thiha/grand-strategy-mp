extends Node
## Headless test for SupplyLineOverlay (Batch 7): selection-gated own-unit lines,
## fog-gated foreign-unit lines, in-place update vs. duplication, the degraded-status
## color/pulse/width gradient, hidden-status suppression, and pulse animation purity
## (visual-only mutation, no GameState writes).
##
## This worktree's bundled western_europe_6 map fixture is broken (pre-existing, unrelated
## to Batch 7), so this test never calls MapLoader.load_map(). Instead it builds a MapLoader
## instance and injects synthetic subprovince geometry directly into its internal
## dictionaries, bypassing load_map() entirely. GDScript does not enforce the underscore
## convention as real privacy, so this is a legitimate and supported way to seed fake
## polygon data for a test (see supply_line_overlay.gd's task brief).

var _failed: bool = false


func _ready() -> void:
	var loader := _build_synthetic_loader()

	GameState.divisions.clear()
	GameState.supply_routes.clear()
	GameState.nations.clear()
	AuthManager.user_id = "test_player"
	GameState.nations["home_nation"] = {"player_id": "test_player", "is_ready": true}
	GameState.divisions["div_own_1"] = {"nation_id": "home_nation"}
	GameState.divisions["div_own_2"] = {"nation_id": "home_nation"}
	GameState.divisions["div_foreign_1"] = {"nation_id": "other_nation"}

	_case_1_selection_creates_line(loader)
	_case_2_multi_selection_shows_all(loader)
	_case_3_active_emphasis(loader)
	_case_4_deselect_removes_line(loader)
	_case_5_in_place_update(loader)
	_case_6_own_persists_through_fog(loader)
	_case_7_foreign_gated_by_fog(loader)
	_case_8_degraded_gradient(loader)
	_case_9_hidden_statuses(loader)
	_case_10_pulse_purity(loader)

	GameState.divisions.clear()
	GameState.supply_routes.clear()
	GameState.nations.clear()
	AuthManager.user_id = ""
	loader.queue_free()

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return
	print("[PASS] test_supply_line_overlay: all tests passed")
	get_tree().quit(0)


## Builds a MapLoader with synthetic subprovince geometry injected directly, bypassing
## load_map() entirely (see class doc / task brief for why). Four well-separated cells
## spread across a 0-10 lng/lat bounds so resolved centroids differ measurably between
## routes using different subprovinceIds.
func _build_synthetic_loader() -> MapLoader:
	var loader := MapLoader.new()
	add_child(loader)
	loader._projection = MapProjection.new(
		{"min_lng": 0.0, "max_lng": 10.0, "min_lat": 0.0, "max_lat": 10.0})
	loader._subprovince_data["sp_a"] = {
		"raw_polygon": [[[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.0]]],
	}
	loader._subprovince_data["sp_b"] = {
		"raw_polygon": [[[6.0, 6.0], [7.0, 6.0], [7.0, 7.0], [6.0, 7.0]]],
	}
	loader._subprovince_data["sp_c"] = {
		"raw_polygon": [[[1.0, 8.0], [2.0, 8.0], [2.0, 9.0], [1.0, 9.0]]],
	}
	loader._subprovince_data["sp_d"] = {
		"raw_polygon": [[[8.0, 1.0], [9.0, 1.0], [9.0, 2.0], [8.0, 2.0]]],
	}
	return loader


func _make_overlay(loader: MapLoader) -> SupplyLineOverlay:
	var overlay := SupplyLineOverlay.new()
	add_child(overlay)
	overlay.setup(loader)
	return overlay


func _route(division_id: String, subprovince_ids: Array, status: String,
		throughput_ratio: float = 1.0) -> Dictionary:
	return {
		"divisionId": division_id,
		"sourceHubId": null,
		"subprovinceIds": subprovince_ids,
		"status": status,
		"throughputRatio": throughput_ratio,
		"blockedSubprovinceId": null,
	}


# ── Case 1 ───────────────────────────────────────────────────────────────────

## Selection creates a route line for the selected division (cached-route replay path via
## setup() -> _sync_existing_routes()).
func _case_1_selection_creates_line(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	var overlay := _make_overlay(loader)

	_assert_true(not overlay._route_lines.has("div_own_1"),
		"case 1: no line before selection, route not yet displayable")
	var selected: Array[String] = ["div_own_1"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"),
		"case 1: selecting an own division with a cached route must create a line")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 2 ───────────────────────────────────────────────────────────────────

## Multiple selection displays every selected division's route.
func _case_2_multi_selection_shows_all(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	GameState.supply_routes["div_own_2"] = _route("div_own_2", ["sp_c", "sp_d"], "open")
	var overlay := _make_overlay(loader)

	var selected: Array[String] = ["div_own_1", "div_own_2"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"), "case 2: div_own_1 must have a line")
	_assert_true(overlay._route_lines.has("div_own_2"), "case 2: div_own_2 must have a line")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 3 ───────────────────────────────────────────────────────────────────

## The active division's route renders with the emphasized style vs. merely selected ones.
func _case_3_active_emphasis(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	GameState.supply_routes["div_own_2"] = _route("div_own_2", ["sp_c", "sp_d"], "open")
	var overlay := _make_overlay(loader)

	var selected: Array[String] = ["div_own_1", "div_own_2"]
	EventBus.division_selection_changed.emit(selected)
	EventBus.division_active_changed.emit("div_own_1")

	_assert_true(is_equal_approx(overlay._emphasis_alpha_mult("div_own_1"),
			SupplyLineOverlay.ACTIVE_ALPHA_MULT),
		"case 3: active division must use ACTIVE_ALPHA_MULT")
	_assert_true(is_equal_approx(overlay._emphasis_alpha_mult("div_own_2"),
			SupplyLineOverlay.SELECTED_ALPHA_MULT),
		"case 3: merely-selected division must use SELECTED_ALPHA_MULT")
	_assert_true(is_equal_approx(overlay._emphasis_width_mult("div_own_1"),
			SupplyLineOverlay.ACTIVE_WIDTH_MULT),
		"case 3: active division must use ACTIVE_WIDTH_MULT")
	_assert_true(is_equal_approx(overlay._emphasis_width_mult("div_own_2"),
			SupplyLineOverlay.SELECTED_WIDTH_MULT),
		"case 3: merely-selected division must use SELECTED_WIDTH_MULT")
	_assert_true(not is_equal_approx(overlay._emphasis_alpha_mult("div_own_1"),
			overlay._emphasis_alpha_mult("div_own_2")),
		"case 3: active vs. selected alpha mult must differ")
	_assert_true(not is_equal_approx(overlay._emphasis_width_mult("div_own_1"),
			overlay._emphasis_width_mult("div_own_2")),
		"case 3: active vs. selected width mult must differ")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 4 ───────────────────────────────────────────────────────────────────

## Deselecting a division removes its route line.
func _case_4_deselect_removes_line(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	var overlay := _make_overlay(loader)

	var selected: Array[String] = ["div_own_1"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"), "case 4: line must exist before deselection")

	var empty_selection: Array[String] = []
	EventBus.division_selection_changed.emit(empty_selection)
	_assert_true(not overlay._route_lines.has("div_own_1"),
		"case 4: deselecting an own division must remove its line")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 5 ───────────────────────────────────────────────────────────────────

## An in-place route update updates the existing line rather than duplicating.
func _case_5_in_place_update(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	var overlay := _make_overlay(loader)

	var selected: Array[String] = ["div_own_1"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"), "case 5: line must exist before update")
	var size_before: int = overlay._route_lines.size()
	var state_before: SupplyLineOverlay._RouteLineState = overlay._route_lines["div_own_1"]
	var wrapper_before: Node2D = state_before.wrapper

	var new_route := _route("div_own_1", ["sp_c", "sp_d"], "degraded", 0.5)
	EventBus.supply_route_updated.emit("div_own_1", new_route)

	_assert_true(overlay._route_lines.size() == size_before,
		"case 5: an in-place update must not create a new key (size unchanged)")
	var state_after: SupplyLineOverlay._RouteLineState = overlay._route_lines["div_own_1"]
	_assert_true(state_after == state_before,
		"case 5: the same _RouteLineState object must be reused, not replaced")
	_assert_true(state_after.wrapper == wrapper_before,
		"case 5: the same wrapper node instance must be reused")

	var expected_points: PackedVector2Array = PackedVector2Array()
	expected_points.append(overlay._centroid(loader.get_subprovince_polygon("sp_c")))
	expected_points.append(overlay._centroid(loader.get_subprovince_polygon("sp_d")))
	_assert_true(state_after.line.points.size() == 2,
		"case 5: updated line must have 2 points for the new subprovinceIds")
	_assert_true(state_after.line.points[0].is_equal_approx(expected_points[0])
			and state_after.line.points[1].is_equal_approx(expected_points[1]),
		"case 5: updated line points must reflect the new subprovinceIds")
	_assert_true(state_after.status == "degraded",
		"case 5: updated status must reflect the new route data")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 6 ───────────────────────────────────────────────────────────────────

## Own routes persist through simulated fog: division_hidden must not remove an own unit's
## line (only deselection does, per case 4).
func _case_6_own_persists_through_fog(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	var overlay := _make_overlay(loader)

	var selected: Array[String] = ["div_own_1"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"), "case 6: line must exist before fog event")

	EventBus.division_hidden.emit("div_own_1")
	_assert_true(overlay._route_lines.has("div_own_1"),
		"case 6: division_hidden must not remove an own unit's supply line")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 7 ───────────────────────────────────────────────────────────────────

## Foreign routes disappear on hidden/vanishing and reappear on revealed/appeared.
func _case_7_foreign_gated_by_fog(loader: MapLoader) -> void:
	var overlay := _make_overlay(loader)

	# In production NetManager writes GameState.supply_routes before emitting the signal; the
	# overlay itself never writes GameState, so the test must mirror that write here for the
	# later revealed/appeared cache-replay path to have anything to replay from.
	var route := _route("div_foreign_1", ["sp_a", "sp_b"], "open")
	GameState.supply_routes["div_foreign_1"] = route
	EventBus.supply_route_updated.emit("div_foreign_1", route)
	_assert_true(not overlay._route_lines.has("div_foreign_1"),
		"case 7: a foreign division's route must not draw a line before visibility is granted")

	EventBus.division_revealed.emit("div_foreign_1")
	_assert_true(overlay._route_lines.has("div_foreign_1"),
		"case 7: division_revealed must create the line from the already-cached route")

	EventBus.division_hidden.emit("div_foreign_1")
	_assert_true(not overlay._route_lines.has("div_foreign_1"),
		"case 7: division_hidden must remove a foreign division's line")

	EventBus.division_appeared.emit("div_foreign_1")
	_assert_true(overlay._route_lines.has("div_foreign_1"),
		"case 7: division_appeared must re-create the line from the still-cached route, "
		+ "with no new supply_route_updated required")

	EventBus.division_vanishing.emit("div_foreign_1")
	_assert_true(not overlay._route_lines.has("div_foreign_1"),
		"case 7: division_vanishing must remove a foreign division's line")

	overlay.free()
	GameState.supply_routes.erase("div_foreign_1")


# ── Case 8 ───────────────────────────────────────────────────────────────────

## Degraded styling is a real function of throughputRatio: compute the expected
## color/pulse_rate/base_width using the exact same formula the overlay uses, and confirm
## the mild (ratio=0.9) and severe (ratio=0.1) ends produce genuinely different results.
func _case_8_degraded_gradient(loader: MapLoader) -> void:
	var overlay := _make_overlay(loader)

	var mild_style: Dictionary = SupplyLineOverlay.ROUTE_STYLE["degraded_mild"]
	var severe_style: Dictionary = SupplyLineOverlay.ROUTE_STYLE["degraded_severe"]

	var selected: Array[String] = ["div_own_1", "div_own_2"]
	EventBus.division_selection_changed.emit(selected)

	var ratio_mild := 0.9
	var t_mild: float = 1.0 - clampf(ratio_mild, 0.0, 1.0)
	var expected_color_mild: Color = (mild_style["color"] as Color).lerp(
		severe_style["color"] as Color, t_mild)
	var expected_pulse_mild: float = lerpf(mild_style["pulse_rate"], severe_style["pulse_rate"], t_mild)
	var expected_width_mild: float = lerpf(mild_style["width"], severe_style["width"], t_mild)
	EventBus.supply_route_updated.emit(
		"div_own_1", _route("div_own_1", ["sp_a", "sp_b"], "degraded", ratio_mild))
	var state_mild: SupplyLineOverlay._RouteLineState = overlay._route_lines["div_own_1"]
	_assert_true(state_mild.base_color.is_equal_approx(expected_color_mild),
		"case 8: mild-degraded (ratio=0.9) color must match the interpolation formula, "
		+ "expected %s got %s" % [expected_color_mild, state_mild.base_color])
	_assert_true(absf(state_mild.pulse_rate - expected_pulse_mild) < 0.001,
		"case 8: mild-degraded pulse_rate must match, expected %f got %f"
		% [expected_pulse_mild, state_mild.pulse_rate])
	_assert_true(absf(state_mild.base_width - expected_width_mild) < 0.001,
		"case 8: mild-degraded base_width must match, expected %f got %f"
		% [expected_width_mild, state_mild.base_width])

	var ratio_severe := 0.1
	var t_severe: float = 1.0 - clampf(ratio_severe, 0.0, 1.0)
	var expected_color_severe: Color = (mild_style["color"] as Color).lerp(
		severe_style["color"] as Color, t_severe)
	var expected_pulse_severe: float = lerpf(mild_style["pulse_rate"], severe_style["pulse_rate"], t_severe)
	var expected_width_severe: float = lerpf(mild_style["width"], severe_style["width"], t_severe)
	EventBus.supply_route_updated.emit(
		"div_own_2", _route("div_own_2", ["sp_c", "sp_d"], "degraded", ratio_severe))
	var state_severe: SupplyLineOverlay._RouteLineState = overlay._route_lines["div_own_2"]
	_assert_true(state_severe.base_color.is_equal_approx(expected_color_severe),
		"case 8: severe-degraded (ratio=0.1) color must match the interpolation formula, "
		+ "expected %s got %s" % [expected_color_severe, state_severe.base_color])
	_assert_true(absf(state_severe.pulse_rate - expected_pulse_severe) < 0.001,
		"case 8: severe-degraded pulse_rate must match, expected %f got %f"
		% [expected_pulse_severe, state_severe.pulse_rate])
	_assert_true(absf(state_severe.base_width - expected_width_severe) < 0.001,
		"case 8: severe-degraded base_width must match, expected %f got %f"
		% [expected_width_severe, state_severe.base_width])

	_assert_true(not state_mild.base_color.is_equal_approx(state_severe.base_color),
		"case 8: mild and severe degraded colors must genuinely differ")
	_assert_true(absf(state_mild.pulse_rate - state_severe.pulse_rate) > 0.1,
		"case 8: mild and severe degraded pulse rates must genuinely differ")
	_assert_true(absf(state_mild.base_width - state_severe.base_width) > 0.01,
		"case 8: mild and severe degraded widths must genuinely differ")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 9 ───────────────────────────────────────────────────────────────────

## cut_off and encircled routes render no line, both for a division with no existing line
## (a) and for a transition away from a currently-displayed line (b).
func _case_9_hidden_statuses(loader: MapLoader) -> void:
	var overlay := _make_overlay(loader)
	var selected: Array[String] = ["div_own_1", "div_own_2"]
	EventBus.division_selection_changed.emit(selected)

	# (a) No existing line -> cut_off / encircled must not create one.
	EventBus.supply_route_updated.emit(
		"div_own_1", _route("div_own_1", ["sp_a", "sp_b"], "cut_off"))
	_assert_true(not overlay._route_lines.has("div_own_1"),
		"case 9a: cut_off with no existing line must not create a line")

	EventBus.supply_route_updated.emit(
		"div_own_2", _route("div_own_2", ["sp_c", "sp_d"], "encircled"))
	_assert_true(not overlay._route_lines.has("div_own_2"),
		"case 9a: encircled with no existing line must not create a line")

	# (b) Existing displayed line -> transition to cut_off / encircled must remove it.
	EventBus.supply_route_updated.emit(
		"div_own_1", _route("div_own_1", ["sp_a", "sp_b"], "open"))
	_assert_true(overlay._route_lines.has("div_own_1"),
		"case 9b: sanity check, open route must display a line before the transition")
	EventBus.supply_route_updated.emit(
		"div_own_1", _route("div_own_1", ["sp_a", "sp_b"], "cut_off"))
	_assert_true(not overlay._route_lines.has("div_own_1"),
		"case 9b: transitioning a displayed line to cut_off must remove it")

	EventBus.supply_route_updated.emit(
		"div_own_2", _route("div_own_2", ["sp_c", "sp_d"], "degraded", 0.7))
	_assert_true(overlay._route_lines.has("div_own_2"),
		"case 9b: sanity check, degraded route must display a line before the transition")
	EventBus.supply_route_updated.emit(
		"div_own_2", _route("div_own_2", ["sp_c", "sp_d"], "encircled"))
	_assert_true(not overlay._route_lines.has("div_own_2"),
		"case 9b: transitioning a displayed line to encircled must remove it")

	overlay.free()
	GameState.supply_routes.clear()


# ── Case 10 ──────────────────────────────────────────────────────────────────

## The pulse animation does not mutate GameState or any gameplay value across sampled
## frames -- only visual properties (Line2D default_color / width) change.
func _case_10_pulse_purity(loader: MapLoader) -> void:
	GameState.supply_routes["div_own_1"] = _route("div_own_1", ["sp_a", "sp_b"], "open")
	var overlay := _make_overlay(loader)
	var selected: Array[String] = ["div_own_1"]
	EventBus.division_selection_changed.emit(selected)
	_assert_true(overlay._route_lines.has("div_own_1"), "case 10: line must exist before sampling")

	var divisions_snapshot: Dictionary = GameState.divisions.duplicate(true)
	var routes_snapshot: Dictionary = GameState.supply_routes.duplicate(true)

	var state: SupplyLineOverlay._RouteLineState = overlay._route_lines["div_own_1"]
	var color_before: Color = state.line.default_color
	var width_before: float = state.line.width

	var colors_seen: Array[Color] = [color_before]
	var widths_seen: Array[float] = [width_before]
	for delta_value: float in [0.05, 0.13, 0.2]:
		overlay._process(delta_value)
		colors_seen.append(state.line.default_color)
		widths_seen.append(state.line.width)

	_assert_true(divisions_snapshot == GameState.divisions,
		"case 10: pulse animation must not mutate GameState.divisions")
	_assert_true(routes_snapshot == GameState.supply_routes,
		"case 10: pulse animation must not mutate GameState.supply_routes")

	var color_changed := false
	var width_changed := false
	for i in range(1, colors_seen.size()):
		if not colors_seen[i].is_equal_approx(colors_seen[0]):
			color_changed = true
		if not is_equal_approx(widths_seen[i], widths_seen[0]):
			width_changed = true
	_assert_true(color_changed or width_changed,
		"case 10: the pulse must actually be live -- color and/or width must change across "
		+ "sampled _process calls, not just remain static")

	overlay.free()
	GameState.supply_routes.clear()


func _assert_true(condition: bool, message: String) -> void:
	if not condition:
		_failed = true
		push_error("ASSERT FAILED: %s" % message)
