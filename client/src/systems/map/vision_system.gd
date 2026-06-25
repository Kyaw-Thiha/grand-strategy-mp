extends Node
## Data-driven client-side visibility prototype.
## Computes which provinces are visible to the local player from GameState,
## then renders a dark-map treatment with PointLight2D reveal sources.
## Owns: visible province set (display state only), DarknessLayer, VisionLightLayer.
## Never writes to GameState.

const DARKNESS_COLOR: Color = Color(0.34, 0.36, 0.42, 1.0)
const OCEAN_COLOR: Color = Color(0.20, 0.50, 0.80)
const OWNED_PROVINCE_LIGHT_ENERGY: float = 1.0
const UNIT_LIGHT_ENERGY: float = 0.85
const OWNED_PROVINCE_LIGHT_RADIUS: float = 400.0
const UNIT_VISION_RADIUS_MULTIPLIER: float = 1.0
const MIN_UNIT_LIGHT_RADIUS: float = 90.0
const MAX_DYNAMIC_LIGHTS: int = 128

@export var vision_enabled: bool = true

var _map_loader: Node = null
## province_id → true — display state only, never written to GameState
var _visible_provinces: Dictionary = {}

var _darkness_modulate: CanvasModulate = null
var _ocean_background: Polygon2D = null
var _light_layer: Node2D = null
var _light_texture: GradientTexture2D = null
var _active_lights: Array[PointLight2D] = []
var _owned_province_lights: Array[PointLight2D] = []
var _unit_lights_by_division_id: Dictionary = {}
var _unit_light_positions_by_division_id: Dictionary = {}


## Stores the map loader reference and creates visual child nodes.
## Parameters:
## - map_loader: the MapLoader node (must be in scene tree before setup is called).
## - _map_renderer: unused in V1; reserved so the signature matches the module pattern.
## Returns: nothing.
func setup(map_loader: Node, _map_renderer: Node = null) -> void:
	_map_loader = map_loader
	_build_visual_layer()


## Connects EventBus signals and runs the first visibility pass.
## Call this from map_debug._on_map_loaded() after debug state has been injected.
## Parameters:
## - _province_count: unused, kept for consistency with the module pattern.
## Returns: nothing.
func on_map_loaded(_province_count: int) -> void:
	EventBus.division_added.connect(func(_id: String) -> void: _refresh_dynamic_visibility())
	EventBus.division_updated.connect(func(_id: String) -> void: _refresh_dynamic_visibility())
	EventBus.division_removed.connect(func(_id: String) -> void: _refresh_dynamic_visibility())
	EventBus.province_captured.connect(func(_pid: String, _owner: String) -> void: refresh_visibility())
	EventBus.lobby_state_updated.connect(refresh_visibility)
	refresh_visibility()


## Recomputes the visible province set and rebuilds PointLight2D nodes.
## Safe to call at any time; no-op when _map_loader is null.
## Returns: nothing.
func refresh_visibility() -> void:
	if _map_loader == null:
		return

	if not vision_enabled:
		if _darkness_modulate != null:
			_darkness_modulate.color = Color.WHITE
		_clear_all_lights()
		EventBus.vision_visibility_changed.emit({})
		return

	_darkness_modulate.color = DARKNESS_COLOR
	_compute_visible_provinces()
	EventBus.vision_visibility_changed.emit(_visible_provinces.duplicate())
	_rebuild_owned_province_lights()
	_sync_unit_lights()


## Recomputes moving-unit visibility without rebuilding static owned-province lights.
## Returns: nothing.
func _refresh_dynamic_visibility() -> void:
	if _map_loader == null:
		return
	if not vision_enabled:
		refresh_visibility()
		return

	_compute_visible_provinces()
	EventBus.vision_visibility_changed.emit(_visible_provinces.duplicate())
	_sync_unit_lights()


## Returns whether the given province is currently in the local player's visible set.
## Parameters:
## - province_id: the province to query.
## Returns: true when visible according to the latest refresh.
func is_province_visible(province_id: String) -> bool:
	return _visible_provinces.has(province_id)


## Returns whether a world position is inside any friendly division's observation radius.
## This is unit-detection data, separate from province-level terrain visibility.
## Parameters:
## - world_position: position to test in map world coordinates.
## Returns: true when the position is directly visible to a friendly unit.
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


## Updates one friendly division's reveal light to match the displayed icon position.
## Parameters:
## - division_id: division whose light should move.
## - world_position: current displayed world-space position.
## Returns: nothing.
func update_division_light_position(division_id: String, world_position: Vector2) -> void:
	if division_id.is_empty():
		return
	_unit_light_positions_by_division_id[division_id] = world_position
	var light: PointLight2D = _unit_lights_by_division_id.get(division_id, null) as PointLight2D
	if light == null:
		return
	var div: Dictionary = GameState.get_division(division_id)
	if div.is_empty():
		return
	var radius: float = _get_division_vision_radius(div)
	_configure_light(light, world_position, radius, UNIT_LIGHT_ENERGY, PointLight2D.BLEND_MODE_ADD)


# ── visual layer setup ────────────────────────────────────────────────────────

## Creates OceanBackground, DarknessLayer, and VisionLightLayer as children.
## CanvasModulate placed in world space (not under a CanvasLayer) so it darkens only
## the main viewport canvas — HUD and PauseMenu CanvasLayers are unaffected.
## Returns: nothing.
func _build_visual_layer() -> void:
	_build_ocean_background()

	_darkness_modulate = CanvasModulate.new()
	_darkness_modulate.name = "DarknessLayer"
	_darkness_modulate.color = DARKNESS_COLOR
	add_child(_darkness_modulate)

	_light_layer = Node2D.new()
	_light_layer.name = "VisionLightLayer"
	add_child(_light_layer)

	_light_texture = _create_light_texture()


## Creates a large ocean-blue Polygon2D behind all map content.
## Because it is a CanvasItem, CanvasModulate darkens it in unlit areas and
## province lights (BLEND_MODE_MIX) restore it to original blue in lit areas.
## The clear color (black) cannot be lit by PointLight2D, so it must be replaced
## with an actual polygon to make coastal ocean respond to vision.
## Size ±15000 px safely covers the map at any zoom level.
## Returns: nothing.
func _build_ocean_background() -> void:
	_ocean_background = Polygon2D.new()
	_ocean_background.name = "OceanBackground"
	var s := 15000.0
	_ocean_background.polygon = PackedVector2Array([
		Vector2(-s, -s), Vector2(s, -s), Vector2(s, s), Vector2(-s, s),
	])
	_ocean_background.color = OCEAN_COLOR
	_ocean_background.z_as_relative = false
	_ocean_background.z_index = -1
	add_child(_ocean_background)


## Builds a 256×256 radial gradient texture: white-opaque at center → white-transparent at edge.
## Parameters: none.
## Returns: GradientTexture2D suitable for PointLight2D.
func _create_light_texture() -> GradientTexture2D:
	var gradient := Gradient.new()
	# Default Gradient has 2 points (offset 0 = black, offset 1 = white). Overwrite both.
	gradient.set_color(0, Color(1.0, 1.0, 1.0, 1.0))
	gradient.set_color(1, Color(1.0, 1.0, 1.0, 0.0))

	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = 256
	texture.height = 256
	return texture


# ── visibility computation ────────────────────────────────────────────────────

## Rebuilds _visible_provinces from GameState ownership and division radii.
## Returns: nothing.
func _compute_visible_provinces() -> void:
	_visible_provinces.clear()
	var my_nation_id: String = GameState.get_my_nation_id()

	# Owned provinces (static map ownership as fallback when server data absent)
	if not my_nation_id.is_empty():
		for province_id: String in _map_loader.get_all_province_ids():
			if _get_province_nation_id(province_id) == my_nation_id:
				_visible_provinces[province_id] = true

	# Provinces within observation radius of friendly divisions
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


## Returns a division's projected world position from its read-only GameState data.
## Parameters:
## - division_data: DivisionState dictionary mirrored from GameState.
## Returns: projected world-space position.
func _get_division_world_position(division_data: Dictionary) -> Vector2:
	var lng: float = division_data.get("position_lng", 0.0)
	var lat: float = division_data.get("position_lat", 0.0)
	return _map_loader.project_lng_lat(lng, lat)


## Returns the currently displayed position when MilitarySystem has provided one.
## Parameters:
## - division_id: division identifier.
## - division_data: DivisionState dictionary mirrored from GameState.
## Returns: displayed world-space position, or server-projected position as fallback.
func _get_displayed_division_world_position(division_id: String, division_data: Dictionary) -> Vector2:
	var displayed_position: Variant = _unit_light_positions_by_division_id.get(division_id)
	if displayed_position is Vector2:
		return displayed_position
	return _get_division_world_position(division_data)


## Returns a division's world-space observation radius using the shared vision constants.
## Parameters:
## - division_data: DivisionState dictionary mirrored from GameState.
## Returns: radius in world pixels.
func _get_division_vision_radius(division_data: Dictionary) -> float:
	var observation_radius: float = division_data.get("observation_radius", 100.0)
	return maxf(observation_radius * UNIT_VISION_RADIUS_MULTIPLIER, MIN_UNIT_LIGHT_RADIUS)


## Returns the owning nation id for a province, preferring live GameState over static map data.
## Parameters:
## - province_id: the province to look up.
## Returns: nation id string, or "" when unknown.
func _get_province_nation_id(province_id: String) -> String:
	var runtime: Dictionary = GameState.get_province(province_id)
	var runtime_nation: String = runtime.get("nation_id", "")
	if not runtime_nation.is_empty():
		return runtime_nation
	return _map_loader.get_province_data(province_id).get("nation_id", "")


## Returns the preferred world-space anchor point for a province.
## Uses MapLoader.get_province_focus_position() (city position) when available,
## falls back to the polygon centroid.
## Parameters:
## - province_id: the province to look up.
## Returns: world-space Vector2.
func _get_province_position(province_id: String) -> Vector2:
	var focus: Vector2 = _map_loader.get_province_focus_position(province_id)
	if focus != Vector2.INF:
		return focus
	return _compute_province_centroid(province_id)


## Computes the centroid of a province's Fill polygon in world space.
## Province nodes are created at (0,0) by the map generator, so polygon vertices
## are already in world-projected coordinates (same coordinate space as project_lng_lat).
## Parameters:
## - province_id: the province to compute a centroid for.
## Returns: world-space centroid, or Vector2.ZERO when the node or fill is missing.
func _compute_province_centroid(province_id: String) -> Vector2:
	var node: Node2D = _map_loader.get_province_node(province_id)
	if node == null:
		return Vector2.ZERO
	var fill: Polygon2D = node.get_node_or_null("Fill") as Polygon2D
	if fill == null or fill.polygon.size() == 0:
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for v: Vector2 in fill.polygon:
		sum += v
	return sum / float(fill.polygon.size())


# ── light management ──────────────────────────────────────────────────────────

## Rebuilds static owned-province lights from current ownership.
## Unit lights are synced separately so moving units do not recreate every light.
## Returns: nothing.
func _rebuild_owned_province_lights() -> void:
	_clear_lights(_owned_province_lights)
	var light_count: int = 0
	var my_nation_id: String = GameState.get_my_nation_id()

	if not my_nation_id.is_empty():
		for province_id: String in _map_loader.get_all_province_ids():
			if light_count >= MAX_DYNAMIC_LIGHTS:
				break
			if _get_province_nation_id(province_id) != my_nation_id:
				continue
			_spawn_light(
				_get_province_position(province_id),
				OWNED_PROVINCE_LIGHT_RADIUS,
				OWNED_PROVINCE_LIGHT_ENERGY,
				PointLight2D.BLEND_MODE_MIX
			)
			light_count += 1


## Creates, updates, or removes keyed friendly division lights.
## Parameters: none.
## Returns: nothing.
func _sync_unit_lights() -> void:
	var remaining_light_budget: int = max(0, MAX_DYNAMIC_LIGHTS - _owned_province_lights.size())
	var active_division_ids: Dictionary = {}
	var my_division_ids: Array = GameState.get_my_nation_divisions()

	for div_id: String in my_division_ids:
		if active_division_ids.size() >= remaining_light_budget:
			break
		var div: Dictionary = GameState.get_division(div_id)
		var pos: Vector2 = _get_displayed_division_world_position(div_id, div)
		var radius: float = _get_division_vision_radius(div)
		var light: PointLight2D = _unit_lights_by_division_id.get(div_id, null) as PointLight2D
		if light == null:
			light = _spawn_light(pos, radius, UNIT_LIGHT_ENERGY)
			_unit_lights_by_division_id[div_id] = light
		else:
			_configure_light(light, pos, radius, UNIT_LIGHT_ENERGY, PointLight2D.BLEND_MODE_ADD)
		active_division_ids[div_id] = true

	for div_id: String in _unit_lights_by_division_id.keys():
		if active_division_ids.has(div_id):
			continue
		var stale_light: PointLight2D = _unit_lights_by_division_id.get(div_id, null) as PointLight2D
		if stale_light != null:
			stale_light.queue_free()
		_unit_lights_by_division_id.erase(div_id)
		_unit_light_positions_by_division_id.erase(div_id)


## Adds one PointLight2D to VisionLightLayer and records it for cleanup.
## The GradientTexture2D is 256×256 with center-to-edge = 128 px, so
## texture_scale = desired_radius / 128.0 maps radius to screen pixels.
## Parameters:
## - world_pos: light position in world space.
## - radius: desired light radius in world pixels.
## - energy: light brightness. For BLEND_MODE_MIX, 1.0 = full original color restored.
## - blend_mode: PointLight2D.BLEND_MODE_MIX for owned territory (restores original colors),
##               PointLight2D.BLEND_MODE_ADD for unit scouting (additive glow into dark areas).
## Returns: nothing.
func _spawn_light(world_pos: Vector2, radius: float, energy: float,
		blend_mode: int = PointLight2D.BLEND_MODE_ADD) -> PointLight2D:
	var light: PointLight2D = PointLight2D.new()
	_configure_light(light, world_pos, radius, energy, blend_mode)
	_light_layer.add_child(light)
	_active_lights.append(light)
	if blend_mode == PointLight2D.BLEND_MODE_MIX:
		_owned_province_lights.append(light)
	return light


## Applies shared PointLight2D settings without recreating the node.
## Parameters:
## - light: light node to configure.
## - world_pos: light position in world space.
## - radius: desired light radius in world pixels.
## - energy: light brightness.
## - blend_mode: Godot 2D light blend mode.
## Returns: nothing.
func _configure_light(light: PointLight2D, world_pos: Vector2, radius: float, energy: float,
		blend_mode: int) -> void:
	light.position = world_pos
	light.texture = _light_texture
	light.texture_scale = radius / 128.0
	light.energy = energy
	light.blend_mode = blend_mode
	light.range_layer_min = -100
	light.range_layer_max = 100


## Frees every tracked PointLight2D node and clears all light lookup state.
## Returns: nothing.
func _clear_all_lights() -> void:
	for light: PointLight2D in _active_lights:
		light.queue_free()
	_active_lights.clear()
	_owned_province_lights.clear()
	_unit_lights_by_division_id.clear()
	_unit_light_positions_by_division_id.clear()


## Frees a specific tracked PointLight2D list.
## Parameters:
## - lights: tracked lights to free and remove from the active list.
## Returns: nothing.
func _clear_lights(lights: Array[PointLight2D]) -> void:
	for light: PointLight2D in lights:
		light.queue_free()
	for light: PointLight2D in lights:
		_active_lights.erase(light)
	lights.clear()
