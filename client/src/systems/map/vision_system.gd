extends Node
## Data-driven client-side visibility presentation.
## Computes local visibility from GameState and renders one combined world-space mask.
## The mask controls a multiplicative fog overlay and never writes to GameState.

const VisionRenderLayers := preload("res://src/systems/map/vision_render_layers.gd")
const DARKNESS_COLOR: Color = Color(0.34, 0.36, 0.42, 1.0)
const OCEAN_COLOR: Color = Color(0.20, 0.50, 0.80)
const UNIT_REVEAL_STRENGTH: float = 1.0
const UNIT_VISION_RADIUS_MULTIPLIER: float = 1.0
const MIN_UNIT_REVEAL_RADIUS: float = 90.0
const PROVINCE_FEATHER_WIDTH_WORLD: float = 10.0
const MASK_WORLD_PADDING: float = 400.0
const MAX_VISIBILITY_SOURCES: int = 128
const MAX_MASK_DIMENSION: int = 2048
const MASK_MIN_DIMENSION: int = 32
const MASK_TEXTURE_SIZE: int = 256
const DYNAMIC_VISIBILITY_REFRESH_INTERVAL_SEC: float = 0.25
const UNIT_MASK_COLOR: Color = Color(1.0, 0.0, 0.0, 1.0)
const PROVINCE_MASK_COLOR: Color = Color(0.0, 1.0, 0.0, 1.0)
const FOG_SHADER_CODE: String = """
shader_type canvas_item;
render_mode unshaded, blend_mul;

uniform vec4 darkness_color : source_color = vec4(0.34, 0.36, 0.42, 1.0);
uniform vec2 province_feather_uv = vec2(0.001);

void fragment() {
	vec4 mask_value = texture(TEXTURE, UV);
	float unit_visibility = clamp(mask_value.r, 0.0, 1.0);
	float solid_province_visibility = clamp(mask_value.g, 0.0, 1.0);

	vec2 half_offset = province_feather_uv * 0.5;
	float feathered_province_visibility = solid_province_visibility * 0.25;
	feathered_province_visibility += (
		texture(TEXTURE, UV + vec2(half_offset.x, 0.0)).g
		+ texture(TEXTURE, UV - vec2(half_offset.x, 0.0)).g
		+ texture(TEXTURE, UV + vec2(0.0, half_offset.y)).g
		+ texture(TEXTURE, UV - vec2(0.0, half_offset.y)).g
	) * 0.09375;
	feathered_province_visibility += (
		texture(TEXTURE, UV + vec2(province_feather_uv.x, 0.0)).g
		+ texture(TEXTURE, UV - vec2(province_feather_uv.x, 0.0)).g
		+ texture(TEXTURE, UV + vec2(0.0, province_feather_uv.y)).g
		+ texture(TEXTURE, UV - vec2(0.0, province_feather_uv.y)).g
	) * 0.046875;
	feathered_province_visibility += (
		texture(TEXTURE, UV + half_offset).g
		+ texture(TEXTURE, UV - half_offset).g
		+ texture(TEXTURE, UV + vec2(half_offset.x, -half_offset.y)).g
		+ texture(TEXTURE, UV + vec2(-half_offset.x, half_offset.y)).g
	) * 0.03125;
	feathered_province_visibility += (
		texture(TEXTURE, UV + province_feather_uv).g
		+ texture(TEXTURE, UV - province_feather_uv).g
		+ texture(TEXTURE, UV + vec2(province_feather_uv.x, -province_feather_uv.y)).g
		+ texture(TEXTURE, UV + vec2(-province_feather_uv.x, province_feather_uv.y)).g
	) * 0.015625;

	float province_visibility_with_feather = max(
		solid_province_visibility,
		clamp(feathered_province_visibility, 0.0, 1.0)
	);
	float visibility = max(unit_visibility, province_visibility_with_feather);
	vec3 fog_factor = mix(darkness_color.rgb, vec3(1.0), visibility);
	COLOR = vec4(fog_factor, 1.0);
}
"""

@export var vision_enabled: bool = true

var _map_loader: Node = null
## province_id → true — display state only, never written to GameState.
var _visible_provinces: Dictionary = {}

var _ocean_background: Polygon2D = null
var _map_ocean_background: Polygon2D = null
var _mask_viewport: SubViewport = null
var _mask_source_root: Node2D = null
var _fog_overlay: Polygon2D = null
var _mask_texture: GradientTexture2D = null
var _mask_stamp_material: CanvasItemMaterial = null
var _mask_world_bounds: Rect2 = Rect2()
var _mask_world_to_texture_scale: float = 1.0
var _friendly_province_polygons: Array[Polygon2D] = []
var _unit_stamps_by_division_id: Dictionary = {}
var _unit_mask_positions_by_division_id: Dictionary = {}
var _unit_mask_radii_by_division_id: Dictionary = {}
var _unit_visibility_dirty: bool = false
var _dynamic_visibility_refresh_elapsed: float = 0.0
var _mask_revision: int = 0
## Set by province/subprovince capture and relation-change events, all of which can arrive in
## bursts (a city-capture cascade broadcasts one event per flipped cell). Debounced by the same
## timer as _unit_visibility_dirty so a whole burst collapses into exactly one full
## refresh_visibility() rebuild instead of one per event.
var _static_visibility_dirty: bool = false
var _static_visibility_refresh_elapsed: float = 0.0


## Stores the map loader reference and creates the runtime visibility mask.
## Parameters:
## - map_loader: MapLoader node, already populated with map bounds and province data.
## - _map_renderer: unused compatibility parameter.
## Returns: nothing.
func setup(map_loader: Node, _map_renderer: Node = null) -> void:
	_map_loader = map_loader
	if _mask_viewport == null:
		_build_visual_layer()


func _process(delta: float) -> void:
	if _static_visibility_dirty:
		_static_visibility_refresh_elapsed += delta
		if _static_visibility_refresh_elapsed >= DYNAMIC_VISIBILITY_REFRESH_INTERVAL_SEC:
			_static_visibility_refresh_elapsed = 0.0
			_static_visibility_dirty = false
			_unit_visibility_dirty = false
			_dynamic_visibility_refresh_elapsed = 0.0
			refresh_visibility()
			return

	if not _unit_visibility_dirty:
		return
	_dynamic_visibility_refresh_elapsed += delta
	if _dynamic_visibility_refresh_elapsed < DYNAMIC_VISIBILITY_REFRESH_INTERVAL_SEC:
		return

	_dynamic_visibility_refresh_elapsed = 0.0
	_unit_visibility_dirty = false
	_refresh_dynamic_visibility()


## Connects visibility inputs and runs the first visibility pass.
## Parameters:
## - _province_count: unused, kept for the shared map-module lifecycle.
## Returns: nothing.
func on_map_loaded(_province_count: int) -> void:
	EventBus.division_added.connect(func(_id: String) -> void: _refresh_dynamic_visibility())
	EventBus.division_updated.connect(func(_id: String) -> void: _mark_unit_visibility_dirty())
	EventBus.division_removed.connect(func(_id: String) -> void: _refresh_dynamic_visibility())
	EventBus.province_captured.connect(func(_pid: String, _owner: String) -> void: _mark_static_visibility_dirty())
	EventBus.subprovince_captured.connect(
		func(_sp_id: String, _pid: String, _owner: String) -> void: _mark_static_visibility_dirty()
	)
	EventBus.relation_changed.connect(
		func(_from_id: String, _to_id: String) -> void: _mark_static_visibility_dirty()
	)
	EventBus.lobby_state_updated.connect(refresh_visibility)
	refresh_visibility()


## Recomputes visibility and rebuilds static mask sources.
## Returns: nothing.
func refresh_visibility() -> void:
	if _map_loader == null or _fog_overlay == null:
		return

	if not vision_enabled:
		_fog_overlay.visible = false
		_clear_all_stamps()
		_visible_provinces.clear()
		EventBus.vision_visibility_changed.emit({})
		return

	_fog_overlay.visible = true
	_compute_visible_provinces()
	EventBus.vision_visibility_changed.emit(_visible_provinces.duplicate())
	_rebuild_friendly_province_polygons()
	_sync_unit_stamps()


## Recomputes moving-unit visibility without rebuilding static province stamps.
## Returns: nothing.
func _refresh_dynamic_visibility() -> void:
	if _map_loader == null:
		return
	if not vision_enabled:
		refresh_visibility()
		return

	_compute_visible_provinces()
	EventBus.vision_visibility_changed.emit(_visible_provinces.duplicate())
	_sync_unit_stamps()


## Marks movement-driven visibility data for a throttled visibility-set refresh.
## Returns: nothing.
func _mark_unit_visibility_dirty() -> void:
	_unit_visibility_dirty = true


## Marks province/subprovince ownership or relation data for a throttled full refresh_visibility()
## rebuild. Debounced (see _process()) so a burst of many events in one frame — e.g. a city-capture
## cascade broadcasting one SUBPROVINCE_CAPTURED per flipped cell — collapses into one rebuild
## instead of one per event.
## Returns: nothing.
func _mark_static_visibility_dirty() -> void:
	_static_visibility_dirty = true


## Returns whether a province is in the current local visible set.
func is_province_visible(province_id: String) -> bool:
	return _visible_provinces.has(province_id)


## Returns whether a world position lies inside a friendly division observation radius.
func is_world_position_visible_to_units(world_position: Vector2) -> bool:
	if not vision_enabled or _map_loader == null:
		return true

	var my_division_ids: Array = GameState.get_my_nation_divisions()
	for div_id: String in my_division_ids:
		var div: Dictionary = GameState.get_division(div_id)
		var friendly_pos: Vector2 = _get_displayed_division_world_position(div_id, div)
		var radius: float = _get_division_vision_radius(div)
		if friendly_pos.distance_to(world_position) <= radius:
			return true
	return false


## Moves one friendly division's existing visibility stamp with its displayed icon.
## Parameters:
## - division_id: division whose stamp should move.
## - world_position: current displayed world-space position.
## Returns: nothing.
func update_division_mask_position(division_id: String, world_position: Vector2) -> void:
	if division_id.is_empty():
		return
	_unit_mask_positions_by_division_id[division_id] = world_position
	var stamp: Sprite2D = _unit_stamps_by_division_id.get(division_id, null) as Sprite2D
	if stamp == null:
		return
	var mask_position: Vector2 = _world_to_mask_position(world_position)
	if not stamp.position.is_equal_approx(mask_position):
		stamp.position = mask_position
		_request_mask_render()


# ── visual layer setup ────────────────────────────────────────────────────────

## Creates the ocean, offscreen mask viewport, and multiplicative fog polygon.
func _build_visual_layer() -> void:
	var map_bounds: Rect2 = _map_loader.get_map_bounds()
	if map_bounds.size == Vector2.ZERO:
		push_error("VisionSystem: cannot build visibility mask without map bounds")
		return

	_mask_world_bounds = map_bounds.grow(MASK_WORLD_PADDING)
	var longest_axis: float = maxf(_mask_world_bounds.size.x, _mask_world_bounds.size.y)
	_mask_world_to_texture_scale = minf(
		1.0, float(MAX_MASK_DIMENSION) / maxf(longest_axis, 1.0)
	)
	var mask_size := Vector2i(
		maxi(MASK_MIN_DIMENSION, ceili(_mask_world_bounds.size.x * _mask_world_to_texture_scale)),
		maxi(MASK_MIN_DIMENSION, ceili(_mask_world_bounds.size.y * _mask_world_to_texture_scale))
	)

	_build_ocean_backgrounds()
	_mask_texture = _create_mask_texture()
	_mask_stamp_material = CanvasItemMaterial.new()
	_mask_stamp_material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_mask_stamp_material.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED

	_mask_viewport = SubViewport.new()
	_mask_viewport.name = "VisibilityMaskViewport"
	_mask_viewport.size = mask_size
	_mask_viewport.transparent_bg = true
	_mask_viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	_mask_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(_mask_viewport)

	_mask_source_root = Node2D.new()
	_mask_source_root.name = "VisibilitySources"
	_mask_viewport.add_child(_mask_source_root)

	_build_fog_overlay(mask_size)


## Builds a permanently dark outer ocean and a mask-controlled map ocean.
func _build_ocean_backgrounds() -> void:
	_ocean_background = Polygon2D.new()
	_ocean_background.name = "OceanBackground"
	var extent: float = 15000.0
	_ocean_background.polygon = PackedVector2Array([
		Vector2(-extent, -extent),
		Vector2(extent, -extent),
		Vector2(extent, extent),
		Vector2(-extent, extent),
	])
	_ocean_background.color = Color(
		OCEAN_COLOR.r * DARKNESS_COLOR.r,
		OCEAN_COLOR.g * DARKNESS_COLOR.g,
		OCEAN_COLOR.b * DARKNESS_COLOR.b,
		1.0
	)
	_ocean_background.z_as_relative = false
	_ocean_background.z_index = VisionRenderLayers.OCEAN_BACKGROUND_Z
	add_child(_ocean_background)

	_map_ocean_background = Polygon2D.new()
	_map_ocean_background.name = "MaskControlledOcean"
	_map_ocean_background.polygon = _rect_polygon(_mask_world_bounds)
	_map_ocean_background.color = OCEAN_COLOR
	_map_ocean_background.z_as_relative = false
	_map_ocean_background.z_index = VisionRenderLayers.MAP_OCEAN_Z
	add_child(_map_ocean_background)


## Creates the world-space fog polygon and maps its UVs to the mask viewport texture.
func _build_fog_overlay(mask_size: Vector2i) -> void:
	_fog_overlay = Polygon2D.new()
	_fog_overlay.name = "CombinedVisibilityFog"
	_fog_overlay.polygon = _rect_polygon(_mask_world_bounds)
	_fog_overlay.uv = PackedVector2Array([
		Vector2.ZERO,
		Vector2(mask_size.x, 0.0),
		Vector2(mask_size.x, mask_size.y),
		Vector2(0.0, mask_size.y),
	])
	_fog_overlay.texture = _mask_viewport.get_texture()
	_fog_overlay.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	var fog_shader := Shader.new()
	fog_shader.code = FOG_SHADER_CODE
	var fog_material := ShaderMaterial.new()
	fog_material.shader = fog_shader
	fog_material.set_shader_parameter("darkness_color", DARKNESS_COLOR)
	var feather_pixels: float = PROVINCE_FEATHER_WIDTH_WORLD * _mask_world_to_texture_scale
	fog_material.set_shader_parameter(
		"province_feather_uv",
		Vector2(feather_pixels / float(mask_size.x), feather_pixels / float(mask_size.y))
	)
	_fog_overlay.material = fog_material
	_fog_overlay.z_as_relative = false
	_fog_overlay.z_index = VisionRenderLayers.FOG_OVERLAY_Z
	add_child(_fog_overlay)


## Returns rectangle corners in clockwise order for a Polygon2D.
func _rect_polygon(rect: Rect2) -> PackedVector2Array:
	return PackedVector2Array([
		rect.position,
		Vector2(rect.end.x, rect.position.y),
		rect.end,
		Vector2(rect.position.x, rect.end.y),
	])


## Builds the soft radial texture shared by all mask stamps.
func _create_mask_texture() -> GradientTexture2D:
	var gradient := Gradient.new()
	gradient.set_color(0, Color.WHITE)
	gradient.set_color(1, Color.TRANSPARENT)
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = MASK_TEXTURE_SIZE
	texture.height = MASK_TEXTURE_SIZE
	return texture


# ── visibility computation ────────────────────────────────────────────────────

## Rebuilds `_visible_provinces` from friendly territory and local division radii.
func _compute_visible_provinces() -> void:
	_visible_provinces.clear()
	var my_nation_id: String = GameState.get_my_nation_id()

	if not my_nation_id.is_empty():
		for province_id: String in _map_loader.get_all_province_ids():
			if _is_friendly_nation(_get_province_nation_id(province_id), my_nation_id):
				_visible_provinces[province_id] = true

	var my_division_ids: Array = GameState.get_my_nation_divisions()
	for div_id: String in my_division_ids:
		var div: Dictionary = GameState.get_division(div_id)
		var div_world_pos: Vector2 = _get_displayed_division_world_position(div_id, div)
		var radius: float = _get_division_vision_radius(div)
		for province_id: String in _map_loader.get_all_province_ids():
			if _visible_provinces.has(province_id):
				continue
			if div_world_pos.distance_to(_get_province_position(province_id)) <= radius:
				_visible_provinces[province_id] = true


## Projects a division's authoritative longitude and latitude into map coordinates.
## Parameters:
## - division_data: current read-only division state.
## Returns: projected world position.
func _get_division_world_position(division_data: Dictionary) -> Vector2:
	var lng: float = division_data.get("position_lng", 0.0)
	var lat: float = division_data.get("position_lat", 0.0)
	return _map_loader.project_lng_lat(lng, lat)


## Returns the interpolated display position when available, otherwise server position.
## Parameters:
## - division_id: division whose position is requested.
## - division_data: current read-only division state.
## Returns: world-space display position.
func _get_displayed_division_world_position(
		division_id: String, division_data: Dictionary
) -> Vector2:
	var displayed_position: Variant = _unit_mask_positions_by_division_id.get(division_id)
	if displayed_position is Vector2:
		return displayed_position
	return _get_division_world_position(division_data)


## Converts a division observation value to the bounded world-space reveal radius.
## Parameters:
## - division_data: current read-only division state.
## Returns: reveal radius in world pixels.
func _get_division_vision_radius(division_data: Dictionary) -> float:
	var observation_radius: float = division_data.get("observation_radius", 100.0)
	return maxf(observation_radius * UNIT_VISION_RADIUS_MULTIPLIER, MIN_UNIT_REVEAL_RADIUS)


## Returns live province ownership with static map ownership as fallback.
## Parameters:
## - province_id: province to inspect.
## Returns: nation identifier or an empty string.
func _get_province_nation_id(province_id: String) -> String:
	var runtime: Dictionary = GameState.get_province(province_id)
	var runtime_nation: String = runtime.get("owner_id", "")
	if runtime_nation.is_empty():
		runtime_nation = runtime.get("nation_id", "")
	if not runtime_nation.is_empty():
		return runtime_nation
	return _map_loader.get_province_data(province_id).get("nation_id", "")


## Returns whether a nation shares province visibility with the local nation.
## Allied-unit vision is deliberately excluded; this helper applies to territory only.
func _is_friendly_nation(nation_id: String, my_nation_id: String) -> bool:
	if nation_id.is_empty() or my_nation_id.is_empty():
		return false
	if nation_id == my_nation_id:
		return true
	var relation: Dictionary = GameState.get_relation(my_nation_id, nation_id)
	return relation.get("stance", "") == "alliance"


## Returns the province focus point, falling back to its primary fill centroid.
## Parameters:
## - province_id: province to locate.
## Returns: world-space position.
func _get_province_position(province_id: String) -> Vector2:
	var focus: Vector2 = _map_loader.get_province_focus_position(province_id)
	if focus != Vector2.INF:
		return focus
	return _compute_province_centroid(province_id)


## Computes the arithmetic centroid of a province's primary generated fill.
## Parameters:
## - province_id: province whose fill is inspected.
## Returns: centroid or Vector2.ZERO when no fill is available.
func _compute_province_centroid(province_id: String) -> Vector2:
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node == null:
		return Vector2.ZERO
	var fill: Polygon2D = node.get_node_or_null("Fill") as Polygon2D
	if fill == null or fill.polygon.size() == 0:
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for vertex: Vector2 in fill.polygon:
		sum += fill.to_global(vertex)
	return sum / float(fill.polygon.size())


# ── mask source management ────────────────────────────────────────────────────

## Rebuilds exact static polygons for locally owned and allied territory, plus any
## individually captured subprovince cells that fall outside otherwise-friendly provinces
## (a captured cell inside an already-friendly province would be a fully redundant stamp,
## since the whole-province polygon already covers it).
func _rebuild_friendly_province_polygons() -> void:
	_free_province_polygons()
	var my_nation_id: String = GameState.get_my_nation_id()
	if my_nation_id.is_empty():
		_request_mask_render()
		return

	var friendly_provinces: Dictionary = {}
	for province_id: String in _map_loader.get_all_province_ids():
		if not _is_friendly_nation(_get_province_nation_id(province_id), my_nation_id):
			continue
		friendly_provinces[province_id] = true
		_spawn_province_mask_polygons(province_id)

	for subprovince_id: String in GameState.subprovinces:
		var cell: Dictionary = GameState.subprovinces[subprovince_id]
		if String(cell.get("owner_id", "")) != my_nation_id:
			continue
		var province_id: String = String(cell.get("province_id", ""))
		if friendly_provinces.has(province_id):
			continue
		_spawn_subprovince_mask_polygons(subprovince_id)

	_request_mask_render()


## Copies every generated fill part for one province into mask coordinates.
## City dots and other Polygon2D markers are excluded by their node names.
func _spawn_province_mask_polygons(province_id: String) -> void:
	var province_node: Node2D = _map_loader.get_province_node(province_id)
	if province_node == null:
		return
	for child: Node in province_node.get_children():
		var source_fill: Polygon2D = child as Polygon2D
		if source_fill == null:
			continue
		if source_fill.name != "Fill" and not source_fill.name.begins_with("FillPart"):
			continue
		if source_fill.polygon.size() < 3:
			continue

		var mask_points := PackedVector2Array()
		for vertex: Vector2 in source_fill.polygon:
			mask_points.append(_world_to_mask_position(source_fill.to_global(vertex)))

		var mask_polygon := Polygon2D.new()
		mask_polygon.name = "%s_%s" % [province_id, source_fill.name]
		mask_polygon.polygon = mask_points
		mask_polygon.color = PROVINCE_MASK_COLOR
		mask_polygon.material = _mask_stamp_material
		_mask_source_root.add_child(mask_polygon)
		_friendly_province_polygons.append(mask_polygon)


## Stamps one individually-captured subprovince cell's rings into mask coordinates, same
## treatment as a friendly province's fill (solid green-channel reveal, no unit radius
## involved). MapLoader's ring data is already in the same world space province Fill nodes
## use (both derive from MapProjection), so no to_global() conversion is needed here.
func _spawn_subprovince_mask_polygons(subprovince_id: String) -> void:
	var rings: Array[PackedVector2Array] = _map_loader.get_subprovince_rings(subprovince_id)
	for ring: PackedVector2Array in rings:
		if ring.size() < 3:
			continue
		var mask_points := PackedVector2Array()
		for vertex: Vector2 in ring:
			mask_points.append(_world_to_mask_position(vertex))

		var mask_polygon := Polygon2D.new()
		mask_polygon.name = "sp_%s" % subprovince_id
		mask_polygon.polygon = mask_points
		mask_polygon.color = PROVINCE_MASK_COLOR
		mask_polygon.material = _mask_stamp_material
		_mask_source_root.add_child(mask_polygon)
		_friendly_province_polygons.append(mask_polygon)


## Creates, updates, and removes keyed friendly-division stamps.
func _sync_unit_stamps() -> void:
	var active_division_ids: Dictionary = {}
	var my_division_ids: Array = GameState.get_my_nation_divisions()

	for div_id: String in my_division_ids:
		if active_division_ids.size() >= MAX_VISIBILITY_SOURCES:
			break
		var div: Dictionary = GameState.get_division(div_id)
		var world_position: Vector2 = _get_displayed_division_world_position(div_id, div)
		var radius: float = _get_division_vision_radius(div)
		var stamp: Sprite2D = _unit_stamps_by_division_id.get(div_id, null) as Sprite2D
		if stamp == null:
			stamp = _spawn_mask_stamp(world_position, radius, UNIT_REVEAL_STRENGTH)
			_unit_stamps_by_division_id[div_id] = stamp
			_unit_mask_radii_by_division_id[div_id] = radius
		else:
			var mask_position: Vector2 = _world_to_mask_position(world_position)
			if not stamp.position.is_equal_approx(mask_position):
				stamp.position = mask_position
				_request_mask_render()
			var previous_radius: float = float(
				_unit_mask_radii_by_division_id.get(div_id, -1.0)
			)
			if not is_equal_approx(previous_radius, radius):
				_update_stamp_radius(stamp, radius)
				_unit_mask_radii_by_division_id[div_id] = radius
		active_division_ids[div_id] = true

	for div_id: String in _unit_stamps_by_division_id.keys():
		if not active_division_ids.has(div_id):
			_remove_unit_stamp(div_id)


## Adds a soft radial stamp to the single offscreen visibility mask.
func _spawn_mask_stamp(
		world_position: Vector2, radius: float, strength: float
) -> Sprite2D:
	var stamp := Sprite2D.new()
	stamp.texture = _mask_texture
	stamp.material = _mask_stamp_material
	stamp.position = _world_to_mask_position(world_position)
	stamp.scale = _stamp_scale(radius)
	stamp.modulate = Color(
		UNIT_MASK_COLOR.r * strength,
		UNIT_MASK_COLOR.g,
		UNIT_MASK_COLOR.b,
		UNIT_MASK_COLOR.a
	)
	_mask_source_root.add_child(stamp)
	_request_mask_render()
	return stamp


## Changes a stamp radius without replacing the stamp or its texture.
func _update_stamp_radius(stamp: Sprite2D, radius: float) -> void:
	var next_scale: Vector2 = _stamp_scale(radius)
	if not stamp.scale.is_equal_approx(next_scale):
		stamp.scale = next_scale
		_request_mask_render()


## Converts a world radius to uniform mask-texture scale.
## Parameters:
## - radius: radius in world pixels.
## Returns: uniform Sprite2D scale.
func _stamp_scale(radius: float) -> Vector2:
	var texture_radius: float = float(MASK_TEXTURE_SIZE) * 0.5
	var scale_value: float = radius * _mask_world_to_texture_scale / texture_radius
	return Vector2(scale_value, scale_value)


## Converts a world coordinate into the mask viewport coordinate system.
## Parameters:
## - world_position: coordinate on the map canvas.
## Returns: coordinate in mask pixels.
func _world_to_mask_position(world_position: Vector2) -> Vector2:
	return (world_position - _mask_world_bounds.position) * _mask_world_to_texture_scale


## Removes one division stamp and all associated caches immediately.
func _remove_unit_stamp(division_id: String) -> void:
	var stamp: Sprite2D = _unit_stamps_by_division_id.get(division_id, null) as Sprite2D
	if stamp != null:
		stamp.free()
	_unit_stamps_by_division_id.erase(division_id)
	_unit_mask_positions_by_division_id.erase(division_id)
	_unit_mask_radii_by_division_id.erase(division_id)
	_request_mask_render()


## Clears every render stamp and unit cache.
func _clear_all_stamps() -> void:
	_free_province_polygons()
	for stamp_variant: Variant in _unit_stamps_by_division_id.values():
		var stamp: Sprite2D = stamp_variant as Sprite2D
		if stamp != null:
			stamp.free()
	_unit_stamps_by_division_id.clear()
	_unit_mask_positions_by_division_id.clear()
	_unit_mask_radii_by_division_id.clear()
	_request_mask_render()


## Frees province geometry immediately so old and replacement ownership never share a frame.
func _free_province_polygons() -> void:
	for polygon: Polygon2D in _friendly_province_polygons:
		if is_instance_valid(polygon):
			polygon.free()
	_friendly_province_polygons.clear()


## Schedules exactly one mask redraw after source state changes.
func _request_mask_render() -> void:
	if _mask_viewport == null:
		return
	_mask_revision += 1
	_mask_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
