extends Node
## Headless test for the preview SubprovinceRenderer: node build, zoom-gated borders,
## and fill colors resolved from the ownership data source.

const MAP_ID := "western_europe_6"

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

	renderer.queue_free()
	loader.queue_free()
	await get_tree().process_frame

	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return
	print("[PASS] test_subprovince_renderer: all tests passed")
	get_tree().quit(0)


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