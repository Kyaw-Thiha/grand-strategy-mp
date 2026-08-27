extends Node
## Headless test for the preview SubprovinceRenderer: node build, zoom-gated borders,
## and fill colors resolved from the ownership data source.

const MAP_ID := "western_europe_6"
const VisionRenderLayers := preload("res://src/systems/map/vision_render_layers.gd")

var _failed: bool = false
var _loaded: bool = false
var _load_error: String = ""


func _ready() -> void:
	var loader := MapLoader.new()
	add_child(loader)
	loader.map_loaded.connect(func(_count: int) -> void: _loaded = true)
	loader.map_load_failed.connect(func(error: String) -> void: _load_error = error)
	loader.load_map(MAP_ID)
	if not _loaded:
		_assert_true(false, "map_loaded must fire (error: %s)" % _load_error)
		get_tree().quit(1)
		return

	# The renderer is map-load-free; stub an owner source returning "france" everywhere.
	var renderer := SubprovinceRenderer.new()
	add_child(renderer)
	renderer.setup(loader, _StubOwnerSource.new("france"))
	renderer.on_map_loaded(loader.get_subprovince_count())

	# Node counts must match the loader geometry exactly.
	var ring_total := 0
	var bordered_cells := 0
	for id: String in loader.get_all_subprovince_ids():
		var rings: Array[PackedVector2Array] = loader.get_subprovince_rings(String(id))
		ring_total += rings.size()
		if rings.size() > 0:
			bordered_cells += 1
	_assert_true(renderer.get_fill_node_count() == ring_total,
		"fill node count %d must equal ring total %d" % [renderer.get_fill_node_count(), ring_total])
	_assert_true(renderer.get_border_node_count() == bordered_cells,
		"border node count %d must equal ringed cells %d" % [renderer.get_border_node_count(), bordered_cells])
	_assert_true(renderer.get_fill_node_count() > 5000,
		"full-map renderer must build thousands of fills, got %d" % renderer.get_fill_node_count())

	# Fill color resolves through the palette with the preview alpha.
	var fills: Node2D = renderer.get_node("SubprovinceFills")
	var first_group: Node2D = fills.get_child(0) as Node2D
	var first_fill: Polygon2D = first_group.get_child(0) as Polygon2D if first_group != null else null
	if first_fill != null:
		var expected := SubprovinceRenderer.NATION_PALETTE["france"] as Color
		expected.a = SubprovinceRenderer.FILL_ALPHA
		_assert_true(first_fill.color.is_equal_approx(expected),
			"fill color %s must equal palette alpha color %s" % [first_fill.color, expected])

	# Borders are close-zoom only, with a smooth fade. Fade-in sets visible immediately;
	# fade-out defers hiding until the tween completes.
	var borders: Node2D = renderer.get_node("SubprovinceBorders")
	var full_map: Rect2 = loader.get_map_bounds()
	renderer.apply_view(0.75, full_map)
	_assert_true(not borders.visible, "borders must hide at strategic zoom (0.75)")
	renderer.apply_view(1.19, full_map)
	_assert_true(not borders.visible, "borders must hide just below the threshold (1.19)")
	renderer.apply_view(1.2, full_map)
	_assert_true(borders.visible, "borders must show at the threshold (1.2)")
	await get_tree().create_timer(SubprovinceRenderer.BORDER_FADE_SECONDS + 0.05).timeout
	_assert_true(borders.modulate.a >= 1.0, "borders must fully fade in")
	renderer.apply_view(1.75, full_map)
	_assert_true(borders.visible, "borders must show at close zoom (1.75)")

	renderer.apply_view(0.75, full_map)
	_assert_true(borders.visible, "borders must stay visible while fading out")
	await get_tree().create_timer(SubprovinceRenderer.BORDER_FADE_SECONDS + 0.1).timeout
	_assert_true(not borders.visible, "borders must hide after the fade-out completes")
	_assert_true(borders.modulate.a == 0.0, "borders alpha must settle at 0 after fade-out")

	# Culling: a camera rect over one province shows only that province's groups.
	var malta_bounds: Rect2 = renderer.get_province_bounds("we6_malta_01")
	var france_bounds: Rect2 = renderer.get_province_bounds("we6_france_01")
	_assert_true(not malta_bounds == Rect2(), "malta bounds must be computed")
	_assert_true(not france_bounds == Rect2(), "france bounds must be computed")
	var malta_only := Rect2(malta_bounds.position - Vector2(5, 5), malta_bounds.size + Vector2(10, 10))
	renderer.apply_view(1.75, malta_only)
	_assert_true(renderer.is_province_visible("we6_malta_01"),
		"malta must be visible when camera is over it")
	_assert_true(not renderer.is_province_visible("we6_france_01"),
		"france must be culled when the camera is over malta")

	# Culling: the whole map view shows everything.
	renderer.apply_view(1.75, full_map)
	_assert_true(renderer.is_province_visible("we6_malta_01"), "malta must be visible at full view")
	_assert_true(renderer.is_province_visible("we6_france_01"), "france must be visible at full view")

	# Layering: fills and borders must draw strictly below the fog overlay, and fills must
	# sit strictly below province-level Fill Polygon2D nodes (implicit sibling z=0).
	_assert_true(_all_fills_below_fog(fills), "all subprovince fills must have z_index < FOG_OVERLAY_Z")
	_assert_true(_all_fills_below_province_z(fills), "all subprovince fills must have z_index < 0 (province fill z)")
	_assert_true(_all_borders_below_fog(borders), "all subprovince borders must have z_index < FOG_OVERLAY_Z")

	# Paint-order: fills and borders share the same z_index, so the border layer must be a
	# later sibling than the fill layer for borders to draw on top. This reads the live node
	# tree rather than asserting a hardcoded assumption, so a reordered/interleaved add_child
	# in _init()/_rebuild() would fail this check.
	_assert_true(fills.get_index() < borders.get_index(),
		"SubprovinceFills (index %d) must precede SubprovinceBorders (index %d) so borders paint on top"
		% [fills.get_index(), borders.get_index()])

	# Capture fade: EventBus.subprovince_captured drives an interruptible fill fade. A
	# fresh capture fades from the cell's current static color to the new owner's palette
	# color; a second capture arriving mid-flight restarts the fade from the LIVE
	# interpolated color (not the pre-transition original, not the interrupted target).
	var capture_ids: Array = loader.get_all_subprovince_ids()
	_assert_true(capture_ids.size() >= 2,
		"map must expose at least two subprovinces for capture-fade tests")
	var capture_id_1 := String(capture_ids[0])
	var capture_id_2 := String(capture_ids[1])

	var fill_1: Polygon2D = renderer.get_fill_node(capture_id_1)
	var old_color_1: Color = fill_1.color
	EventBus.subprovince_captured.emit(capture_id_1, "", "germany")
	await get_tree().create_timer(0.15).timeout
	await get_tree().process_frame
	var mid_color_1: Color = fill_1.color
	var target_color_1: Color = renderer.get_owner_color("germany")
	_assert_true(_color_between(old_color_1, mid_color_1, target_color_1),
		"mid-tween fill color must lie strictly between old (%s) and new (%s), got %s"
			% [old_color_1, target_color_1, mid_color_1])
	_assert_true(not mid_color_1.is_equal_approx(old_color_1),
		"mid-tween color must have moved away from the old color")
	_assert_true(not mid_color_1.is_equal_approx(target_color_1),
		"mid-tween color must not already equal the target color")
	await get_tree().create_timer(SubprovinceRenderer.CAPTURE_FADE_DURATION).timeout
	_assert_true(fill_1.color.is_equal_approx(target_color_1),
		"fade must settle at the target color once the tween completes")

	var fill_2: Polygon2D = renderer.get_fill_node(capture_id_2)
	EventBus.subprovince_captured.emit(capture_id_2, "", "germany")
	await get_tree().create_timer(0.15).timeout
	await get_tree().process_frame
	var live_color_at_interrupt: Color = fill_2.color
	var interrupted_target: Color = renderer.get_owner_color("germany")
	EventBus.subprovince_captured.emit(capture_id_2, "", "united_kingdom")
	await get_tree().process_frame
	var color_immediately_after_restart: Color = fill_2.color
	_assert_true(_color_close(color_immediately_after_restart, live_color_at_interrupt, 0.08),
		("interrupted transition must restart from the live interpolated color " +
			"(live=%s got=%s)") % [live_color_at_interrupt, color_immediately_after_restart])
	_assert_true(not color_immediately_after_restart.is_equal_approx(interrupted_target),
		"interrupted transition must not snap to the first (interrupted) target color")

	# Contested tint: a division entering active combat ("engaged"/"suppressed") tints its
	# subprovince cell without touching GameState.subprovinces' recorded owner, and clearing
	# combat reverts the fill to the CURRENT recorded owner color (read live, not cached).
	var contested_id := String(capture_ids[2]) if capture_ids.size() > 2 else capture_id_1
	GameState.subprovinces[contested_id] = {"province_id": "", "owner_id": "france"}
	GameState.divisions["d_test_contested"] = {
		"combat_state": "engaged", "subprovince_id": contested_id, "province_id": "",
	}
	var fill_contested: Polygon2D = renderer.get_fill_node(contested_id)
	var pre_contest_color: Color = fill_contested.color
	EventBus.division_updated.emit("d_test_contested")
	await get_tree().process_frame
	_assert_true(fill_contested.color.is_equal_approx(SubprovinceRenderer.CONTESTED_TINT_COLOR),
		"engaged division must tint its subprovince with the contested color, got %s" % fill_contested.color)
	_assert_true(not fill_contested.color.is_equal_approx(pre_contest_color),
		"contested tint must differ from the pre-contest fill color")

	# Combat resolves ("idle") -> tint clears and reverts to the CURRENT recorded owner color.
	GameState.subprovinces[contested_id]["owner_id"] = "united_kingdom"
	GameState.divisions["d_test_contested"]["combat_state"] = "idle"
	EventBus.division_updated.emit("d_test_contested")
	await get_tree().process_frame
	var expected_reverted: Color = renderer.get_owner_color("united_kingdom")
	_assert_true(fill_contested.color.is_equal_approx(expected_reverted),
		("tint must clear and revert to the CURRENT owner color (%s), got %s" %
			[expected_reverted, fill_contested.color]))

	# Contested tint takes precedence over an in-flight capture fade: start a fade, then make
	# the same cell contested mid-flight; the tint must apply immediately, interrupting the fade.
	var fade_contest_id := capture_id_2
	var fill_fade_contest: Polygon2D = renderer.get_fill_node(fade_contest_id)
	GameState.subprovinces[fade_contest_id] = {"province_id": "", "owner_id": "france"}
	EventBus.subprovince_captured.emit(fade_contest_id, "", "germany")
	await get_tree().create_timer(0.1).timeout
	await get_tree().process_frame
	_assert_true(not fill_fade_contest.color.is_equal_approx(SubprovinceRenderer.CONTESTED_TINT_COLOR),
		"sanity: mid-fade color must not already equal the contested tint")
	GameState.divisions["d_test_fade_contest"] = {
		"combat_state": "suppressed", "subprovince_id": fade_contest_id, "province_id": "",
	}
	EventBus.division_updated.emit("d_test_fade_contest")
	await get_tree().process_frame
	_assert_true(fill_fade_contest.color.is_equal_approx(SubprovinceRenderer.CONTESTED_TINT_COLOR),
		"contested tint must interrupt an in-flight capture fade and apply immediately, got %s"
			% fill_fade_contest.color)
	# Wait past the original fade duration to confirm the killed tween never resumes writing.
	await get_tree().create_timer(SubprovinceRenderer.CAPTURE_FADE_DURATION).timeout
	_assert_true(fill_fade_contest.color.is_equal_approx(SubprovinceRenderer.CONTESTED_TINT_COLOR),
		"tint must remain stable after the interrupted fade's original duration elapses")

	GameState.divisions.erase("d_test_contested")
	GameState.divisions.erase("d_test_fade_contest")
	GameState.subprovinces.erase(contested_id)
	GameState.subprovinces.erase(fade_contest_id)

	renderer.queue_free()
	loader.queue_free()
	await get_tree().process_frame

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return
	print("[PASS] test_subprovince_renderer: all tests passed")
	get_tree().quit(0)


## Walks a SubprovinceFills/SubprovinceBorders layer's province groups, returning every
## direct child CanvasItem (Polygon2D fills or Line2D borders) found.
func _get_all_layer_nodes(layer: Node2D) -> Array[CanvasItem]:
	var nodes: Array[CanvasItem] = []
	for group: Node in layer.get_children():
		for item: Node in group.get_children():
			if item is CanvasItem:
				nodes.append(item as CanvasItem)
	return nodes


func _all_fills_below_fog(fills_layer: Node2D) -> bool:
	for fill: CanvasItem in _get_all_layer_nodes(fills_layer):
		if fill.z_index >= VisionRenderLayers.FOG_OVERLAY_Z:
			return false
	return true


func _all_fills_below_province_z(fills_layer: Node2D) -> bool:
	for fill: CanvasItem in _get_all_layer_nodes(fills_layer):
		if fill.z_index >= 0 or fill.z_as_relative:
			return false
	return true


func _all_borders_below_fog(borders_layer: Node2D) -> bool:
	for border: CanvasItem in _get_all_layer_nodes(borders_layer):
		if border.z_index >= VisionRenderLayers.FOG_OVERLAY_Z:
			return false
		if border.z_index >= 0 or border.z_as_relative:
			return false
	return true


## Returns true if `mid`'s red channel lies strictly between `a` and `b`'s red channels
## (i.e. mid-tween, not yet snapped to either endpoint). Mirrors the SDD plan's reference
## check; red is a sufficient discriminator here since every palette entry used in these
## tests differs on that channel.
func _color_between(a: Color, mid: Color, b: Color) -> bool:
	if b.r == a.r:
		return true
	var t_r := (mid.r - a.r) / (b.r - a.r)
	return t_r > 0.01 and t_r < 0.99


## Returns true if every channel of `a` and `b` is within `tolerance` of each other. Looser
## than Color.is_equal_approx's tight fixed epsilon, which is unsuitable for comparing a
## tween's value across a single elapsed frame.
func _color_close(a: Color, b: Color, tolerance: float) -> bool:
	return (
		absf(a.r - b.r) <= tolerance
		and absf(a.g - b.g) <= tolerance
		and absf(a.b - b.b) <= tolerance
		and absf(a.a - b.a) <= tolerance
	)


func _assert_true(condition: bool, message: String) -> void:
	if not condition:
		_failed = true
		push_error("ASSERT FAILED: %s" % message)


class _StubOwnerSource:
	extends RefCounted

	var _owner: String

	func _init(owner_id: String) -> void:
		_owner = owner_id

	func get_subprovince_owner(_subprovince_id: String) -> String:
		return _owner