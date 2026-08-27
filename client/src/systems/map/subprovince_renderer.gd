class_name SubprovinceRenderer
extends Node2D
## Preview renderer for authoritative subprovince ownership (Batch 6, non-authoritative).
##
## Draws one Polygon2D fill per subprovince ring, colored by the cell's owner via an
## injected data source, plus a soft-gray Line2D outline per cell. Both layers are gated
## from the live camera each frame:
##   - Borders only render once zoomed past BORDER_VISIBILITY_ZOOM (close look).
##   - Fills and borders are culled per province group against the camera's visible world
##     rect, so off-screen provinces cost no draw calls.
## The whole layer sits on a plain Node2D (below fog, which renders on a CanvasLayer).

const NATION_PALETTE: Dictionary = preload("res://src/systems/map/map_renderer.gd").NATION_PALETTE
const VisionRenderLayers := preload("res://src/systems/map/vision_render_layers.gd")

const BORDER_VISIBILITY_ZOOM := 1.2
const CULLING_MARGIN_RATIO := 0.35
const BORDER_FADE_SECONDS := 0.4
const FILL_ALPHA := 0.5
const BORDER_COLOR := Color(0.21, 0.21, 0.21, 0.30)
const BORDER_WIDTH := 0.6
const UNOWNED_COLOR := Color(0.55, 0.55, 0.55)

var _map_loader: MapLoader = null
var _data_source: Object = null

var _fill_layer: Node2D = null
var _border_layer: Node2D = null
var _border_tween: Tween = null
var _borders_shown := false
var _fill_groups: Dictionary = {}      # province_id → Node2D
var _border_groups: Dictionary = {}    # province_id → Node2D
var _province_bounds: Dictionary = {}  # province_id → Rect2 (world AABB)
var _province_visible: Dictionary = {} # province_id → bool (last culled state)
var _fill_node_count := 0
var _border_node_count := 0


## Prepares the two drawable sub-layers.
## Parameters: none.
## Returns: nothing.
func _init() -> void:
	_fill_layer = Node2D.new()
	_fill_layer.name = "SubprovinceFills"
	add_child(_fill_layer)
	_border_layer = Node2D.new()
	_border_layer.name = "SubprovinceBorders"
	_border_layer.visible = false
	_border_layer.modulate.a = 0.0
	add_child(_border_layer)


## Registers the MapLoader and the ownership data source.
## Parameters:
## - loader: loaded MapLoader providing subprovince geometry lookups.
## - data_source: object exposing `get_subprovince_owner(subprovince_id) -> String`.
## Returns: nothing.
func setup(loader: MapLoader, data_source: Object) -> void:
	_map_loader = loader
	_data_source = data_source


## Builds all subprovince Polygon2D fills and Line2D outlines from the loader.
## Rerunning rebuilds the layer (intended for map (re)load).
## Parameters: none.
## Returns: nothing.
func on_map_loaded(_province_count: int) -> void:
	_rebuild()


## Polls the active Camera2D each frame to gate border visibility and cull province
## groups to the visible world rect.
## Parameters:
## - _delta: frame delta, unused.
## Returns: nothing.
func _process(_delta: float) -> void:
	if _map_loader == null:
		return
	var viewport: Viewport = get_viewport()
	if viewport == null:
		return
	var camera := viewport.get_camera_2d()
	if camera == null:
		return
	var zoom: float = camera.zoom.x
	if zoom <= 0.0:
		return
	var view_size: Vector2 = viewport.get_visible_rect().size
	var world_half: Vector2 = view_size * 0.5 / zoom
	var center: Vector2 = camera.get_screen_center_position()
	_apply_view(zoom, Rect2(center - world_half, world_half * 2.0))


## Applies one frame's camera state: borders gated by zoom, province groups culled to
## the visible world rect. Public so tests can drive it without a real camera.
## Parameters:
## - camera_zoom: uniform camera zoom (higher = closer).
## - camera_world_rect: visible world-space rect.
## Returns: nothing.
func apply_view(camera_zoom: float, camera_world_rect: Rect2) -> void:
	_apply_view(camera_zoom, camera_world_rect)


func _apply_view(camera_zoom: float, camera_world_rect: Rect2) -> void:
	var show_borders: bool = camera_zoom >= BORDER_VISIBILITY_ZOOM
	_set_borders_shown(show_borders)

	if _province_bounds.is_empty():
		return
	var cull_rect := camera_world_rect.grow(camera_world_rect.size.y * CULLING_MARGIN_RATIO)
	for province_id: Variant in _province_bounds.keys():
		var bounds: Rect2 = _province_bounds[province_id]
		var visible: bool = bounds.intersects(cull_rect)
		if _province_visible.get(province_id, false) != visible:
			_province_visible[province_id] = visible
			(_fill_groups[province_id] as Node2D).visible = visible
			if _borders_shown:
				(_border_groups[province_id] as Node2D).visible = visible


## Fades the border layer in or out. Interruptible: a repeated toggle kills the running
## tween and restarts from the current alpha, so rapid zoom changes never pop.
## Parameters:
## - shown: true to fade borders in (zoom threshold passed), false to fade them out.
## Returns: nothing.
func _set_borders_shown(shown: bool) -> void:
	if _borders_shown == shown:
		return
	_borders_shown = shown
	if _border_tween != null:
		_border_tween.kill()
	_border_tween = create_tween()
	_border_tween.set_trans(Tween.TRANS_SINE)
	_border_tween.set_ease(Tween.EASE_IN_OUT)
	_border_tween.tween_property(
		_border_layer, "modulate:a", 1.0 if shown else 0.0, BORDER_FADE_SECONDS
	)
	if shown:
		_border_layer.visible = true
		for province_id: Variant in _province_bounds.keys():
			var culled_visible: bool = _province_visible.get(province_id, false)
			(_border_groups[province_id] as Node2D).visible = culled_visible
	else:
		_border_tween.tween_callback(func() -> void: _border_layer.visible = false)


func _rebuild() -> void:
	if _border_tween != null:
		_border_tween.kill()
		_border_tween = null
	_borders_shown = false
	_border_layer.visible = false
	_border_layer.modulate.a = 0.0
	_clear_layer(_fill_layer)
	_clear_layer(_border_layer)
	_fill_groups.clear()
	_border_groups.clear()
	_province_bounds.clear()
	_province_visible.clear()
	_fill_node_count = 0
	_border_node_count = 0
	if _map_loader == null or _data_source == null:
		return

	for subprovince_id: String in _all_subprovince_ids():
		var cell: Dictionary = _map_loader.get_subprovince_data(subprovince_id)
		if cell.is_empty():
			continue
		var rings: Array[PackedVector2Array] = _map_loader.get_subprovince_rings(subprovince_id)
		if rings.is_empty():
			continue
		var province_id: String = String(cell.get("province_id", ""))
		var fill_group := _ensure_group(_fill_layer, _fill_groups, province_id)
		var border_group := _ensure_group(_border_layer, _border_groups, province_id)

		var owner_id: String = String(_data_source.get_subprovince_owner(subprovince_id))
		var fill_color: Color = _color_for_owner(owner_id)
		var largest_ring := PackedVector2Array()
		for ring: PackedVector2Array in rings:
			var polygon := Polygon2D.new()
			polygon.polygon = ring
			polygon.color = fill_color
			polygon.antialiased = true
			polygon.z_as_relative = false
			polygon.z_index = VisionRenderLayers.SUBPROVINCE_FILL_Z
			fill_group.add_child(polygon)
			_fill_node_count += 1
			_expand_province_bounds(province_id, ring)
			if ring.size() > largest_ring.size():
				largest_ring = ring
		if largest_ring.size() >= 3:
			var line := Line2D.new()
			line.points = largest_ring
			line.closed = true
			line.width = BORDER_WIDTH
			line.default_color = BORDER_COLOR
			line.antialiased = true
			line.z_as_relative = false
			line.z_index = VisionRenderLayers.SUBPROVINCE_BORDER_Z
			border_group.add_child(line)
			_border_node_count += 1


## Returns a unique, deterministic list of every loaded subprovince ID.
func _all_subprovince_ids() -> Array[String]:
	var ids: Array[String] = []
	for key: Variant in _map_loader.get_all_subprovince_ids():
		ids.append(String(key))
	ids.sort()
	return ids


func _ensure_group(layer: Node2D, groups: Dictionary, province_id: String) -> Node2D:
	var group: Node2D = groups.get(province_id) as Node2D
	if group == null:
		group = Node2D.new()
		group.name = "Province_" + province_id
		layer.add_child(group)
		groups[province_id] = group
	return group


func _expand_province_bounds(province_id: String, ring: PackedVector2Array) -> void:
	if ring.is_empty():
		return
	var min_x := ring[0].x
	var min_y := ring[0].y
	var max_x := min_x
	var max_y := min_y
	for point: Vector2 in ring:
		min_x = minf(min_x, point.x)
		min_y = minf(min_y, point.y)
		max_x = maxf(max_x, point.x)
		max_y = maxf(max_y, point.y)
	var ring_rect := Rect2(Vector2(min_x, min_y), Vector2(max_x - min_x, max_y - min_y))
	if _province_bounds.has(province_id):
		_province_bounds[province_id] = (_province_bounds[province_id] as Rect2).merge(ring_rect)
	else:
		_province_bounds[province_id] = ring_rect


func _color_for_owner(owner_id: String) -> Color:
	if owner_id.is_empty() or not NATION_PALETTE.has(owner_id):
		return UNOWNED_COLOR
	var color: Color = NATION_PALETTE[owner_id]
	color.a = FILL_ALPHA
	return color


func _clear_layer(layer: Node2D) -> void:
	for child: Node in layer.get_children():
		child.queue_free()


func get_fill_node_count() -> int:
	return _fill_node_count


func get_border_node_count() -> int:
	return _border_node_count


## Returns the world-space AABB accumulated for a province (Rect2() when unknown).
func get_province_bounds(province_id: String) -> Rect2:
	return _province_bounds.get(province_id, Rect2())


## Returns whether a province group is currently visible under the last applied view.
func is_province_visible(province_id: String) -> bool:
	return _province_visible.get(province_id, false)