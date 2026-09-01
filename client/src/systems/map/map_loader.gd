class_name MapLoader
extends Node
## Loads a processed map from client/assets/data/<map_id>/ and instances
## the generated static scene from client/scenes/map/<map_id>.scn.
## Only place in the codebase that converts lng/lat to Godot screen space.

signal map_loaded(province_count: int)
signal map_load_failed(error: String)

const GENERATED_SCENE_ROOT := "res://scenes/map"

var _map_id: String = ""
var _bounds: Dictionary = {}
var _provinces: Dictionary = {}       # province_id → Node2D
var _province_data: Dictionary = {}   # province_id → Dictionary (raw JSON data)
var _province_click_areas: Dictionary = {} # province_id → Array[Area2D]
var _adjacency: Array = []
var _terrain_lookup: Dictionary = {}
var _waypoints: Dictionary = {}    # { nodes: [], edges: [], road_connections: [] }
var _subprovince_data: Dictionary = {}    # subprovince_id → { province_id, kind, ... , raw_polygon }
var _subprovince_adjacency: Dictionary = {} # subprovince_id → PackedStringArray of neighbor IDs
var _province_subprovince_ids: Dictionary = {} # province_id → PackedStringArray
# subprovince_id → Array of raw [lng, lat] points — the real road centerline clipped to that road-
# kind cell (see road_subprovince_geometry.geojson). Purely a visual aid for SupplyLineOverlay;
# soft-loaded (see _load_road_geometry) since not every map/build is guaranteed to have it yet.
var _road_geometry: Dictionary = {}

var _projection: MapProjection


func load_map(map_id: String) -> void:
	_clear_loaded_map()
	_map_id = map_id
	var data_root := "res://assets/data/%s" % map_id

	var map_data_raw: Variant = _load_json("%s/map_data.json" % data_root)
	if not map_data_raw is Dictionary:
		map_load_failed.emit("Failed to load map_data.json for '%s'" % map_id)
		return
	var map_data: Dictionary = map_data_raw

	_bounds = map_data.get("bounds", {})
	_adjacency = map_data.get("adjacency", [])
	_projection = MapProjection.new(_bounds)

	var terrain_raw: Variant = _load_json("%s/terrain_lookup.json" % data_root)
	if terrain_raw is Dictionary:
		_terrain_lookup = terrain_raw

	for province_data_variant: Variant in map_data.get("provinces", []):
		if not province_data_variant is Dictionary:
			continue
		var province_data: Dictionary = province_data_variant
		var pid: String = province_data.get("province_id", "")
		if pid.is_empty():
			continue
		_province_data[pid] = province_data

	if not _load_subprovince_data(data_root):
		return

	_load_road_geometry(data_root)

	if not _load_generated_scene(map_id):
		return

	# Load waypoint graph (Phase 4A) — non-fatal if not yet generated
	var wp_raw: Variant = _load_json("%s/waypoints.json" % data_root)
	if wp_raw is Dictionary:
		_waypoints = wp_raw
		_tag_waypoints_with_subprovince_ids()
	else:
		push_warning("MapLoader: waypoints.json missing — run pipeline to generate it")

	map_loaded.emit(_provinces.size())


func get_province_node(province_id: String) -> Node2D:
	return _provinces.get(province_id)


func get_province_data(province_id: String) -> Dictionary:
	return _province_data.get(province_id, {})


## Returns generated province click areas for the interaction system.
## Parameters:
## - province_id: processed map province identifier.
## Returns: Area2D nodes whose metadata points at the province.
func get_province_click_areas(province_id: String) -> Array[Area2D]:
	var result: Array[Area2D] = []
	for area: Area2D in _province_click_areas.get(province_id, []):
		result.append(area)
	return result


## Returns the preferred world-space camera focus point for a province.
## Parameters:
## - province_id: processed map province identifier.
## Returns: projected city position when available, otherwise Vector2.INF.
func get_province_focus_position(province_id: String) -> Vector2:
	var province_data: Dictionary = get_province_data(province_id)
	var city_position: Array = province_data.get("city_position", [])
	if city_position.size() < 2:
		return Vector2.INF
	return project_lng_lat(float(city_position[0]), float(city_position[1]))


## Returns the province id whose click-detection Area2D contains the given world position, or ""
## if none. Reuses the exact same Area2D collision shapes / physics space already powering
## province click detection (map_interaction.gd's _on_area_input_event), so "which province is
## this point in" stays consistent with "which province would a click here select" by
## construction — no separate point-in-polygon math to keep in sync with that.
func get_province_at_world_position(pos: Vector2) -> String:
	var space_state: PhysicsDirectSpaceState2D = get_viewport().get_world_2d().direct_space_state
	var query := PhysicsPointQueryParameters2D.new()
	query.position = pos
	query.collide_with_areas = true
	query.collide_with_bodies = false
	var results: Array[Dictionary] = space_state.intersect_point(query)
	for result: Dictionary in results:
		var collider: Object = result.get("collider")
		if collider is Area2D:
			var province_id: String = (collider as Area2D).get_meta("province_id", "")
			if not province_id.is_empty():
				return province_id
	return ""


func get_all_province_ids() -> Array[String]:
	var ids: Array[String] = []
	for k in _province_data.keys():
		ids.append(k)
	return ids


func get_adjacency() -> Array:
	return _adjacency


func get_terrain_lookup() -> Dictionary:
	return _terrain_lookup

func get_waypoint_graph() -> Dictionary:
	return _waypoints

## Coarse grid bucket size (degrees) for the one-time waypoint→subprovince tagging pass below.
## Subprovince geometry is static once generated, so this tag never needs refreshing — only
## `owner_id` changes at runtime, which callers (Pathfinder._resolve_node_nation) resolve live via
## `GameState.subprovinces` at check time. A naive O(waypoints × subprovinces) scan is too slow at
## real map scale (tens of thousands of subprovinces vs. the much smaller province count this
## pipeline was originally sized for), so subprovinces are bucketed by bounding-box overlap into
## this grid first. Tunable — illustrative, no profiling basis yet.
const _SUBPROVINCE_TAG_GRID_DEG := 0.25

## Tags each waypoint node in `_waypoints` with the subprovince_id whose polygon contains it
## (raw lng/lat space, same coordinates the waypoint graph itself uses — no projection needed).
## This is what lets Pathfinder._is_neutral_for resolve LIVE ownership instead of the node's static,
## map-generation-time `nation_id` field, which goes stale the moment any subprovince capture
## happens. Nodes outside all subprovince coverage are left untagged (Pathfinder falls back to the
## static `nation_id` field for those, matching its pre-existing behavior).
## Parameters: none — reads/mutates this loader's own `_waypoints`/`_subprovince_data`.
## Returns: nothing.
func _tag_waypoints_with_subprovince_ids() -> void:
	var polygons_by_id: Dictionary = {}  # subprovince_id -> Array[PackedVector2Array] (raw space)
	var grid: Dictionary = {}            # "gx,gy" -> Array[String] candidate subprovince_ids

	for sid: String in _subprovince_data.keys():
		var rings: Array = _subprovince_data[sid].get("raw_polygon", [])
		var polys: Array[PackedVector2Array] = []
		var min_lng := INF
		var max_lng := -INF
		var min_lat := INF
		var max_lat := -INF
		for ring: Variant in rings:
			if not ring is Array:
				continue
			var poly := PackedVector2Array()
			for coord: Variant in (ring as Array):
				if not coord is Array or (coord as Array).size() < 2:
					continue
				var lng := float(coord[0])
				var lat := float(coord[1])
				poly.append(Vector2(lng, lat))
				min_lng = minf(min_lng, lng)
				max_lng = maxf(max_lng, lng)
				min_lat = minf(min_lat, lat)
				max_lat = maxf(max_lat, lat)
			if poly.size() >= 3:
				polys.append(poly)
		if polys.is_empty() or min_lng > max_lng:
			continue
		polygons_by_id[sid] = polys

		var gx0: int = floori(min_lng / _SUBPROVINCE_TAG_GRID_DEG)
		var gx1: int = floori(max_lng / _SUBPROVINCE_TAG_GRID_DEG)
		var gy0: int = floori(min_lat / _SUBPROVINCE_TAG_GRID_DEG)
		var gy1: int = floori(max_lat / _SUBPROVINCE_TAG_GRID_DEG)
		for gx: int in range(gx0, gx1 + 1):
			for gy: int in range(gy0, gy1 + 1):
				var key: String = "%d,%d" % [gx, gy]
				if not grid.has(key):
					grid[key] = []
				(grid[key] as Array).append(sid)

	var nodes: Array = _waypoints.get("nodes", [])
	for node_variant: Variant in nodes:
		if not node_variant is Dictionary:
			continue
		var node: Dictionary = node_variant
		var lng: float = float(node.get("lng", 0.0))
		var lat: float = float(node.get("lat", 0.0))
		var gx: int = floori(lng / _SUBPROVINCE_TAG_GRID_DEG)
		var gy: int = floori(lat / _SUBPROVINCE_TAG_GRID_DEG)
		var key: String = "%d,%d" % [gx, gy]
		var point := Vector2(lng, lat)
		for sid: String in (grid.get(key, []) as Array):
			var found := false
			for poly: PackedVector2Array in (polygons_by_id[sid] as Array[PackedVector2Array]):
				if Geometry2D.is_point_in_polygon(point, poly):
					found = true
					break
			if found:
				node["subprovince_id"] = sid
				break

## Converts WGS84 (lng, lat) to Godot screen-space Vector2.
## Public wrapper around the shared MapProjection.
func project_lng_lat(lng: float, lat: float) -> Vector2:
	if _projection == null:
		return Vector2.ZERO
	return _projection.project(lng, lat)


## Inverse of project_lng_lat. Returns [lng, lat] for a world-space pixel position.
func world_to_lng_lat(world_pos: Vector2) -> Vector2:
	if _projection == null:
		return Vector2.ZERO
	return _projection.unproject(world_pos)


func get_map_bounds() -> Rect2:
	if _bounds.is_empty():
		return Rect2()
	var tl := _projection.project(_bounds.get("min_lng", 0.0), _bounds.get("max_lat", 0.0))
	var br := _projection.project(_bounds.get("max_lng", 0.0), _bounds.get("min_lat", 0.0))
	return Rect2(tl, br - tl)


# ── subprovince lookups ───────────────────────────────────────────────────────

## Returns raw parsed subprovince properties for a cell ID, or {} when unknown.
func get_subprovince_data(subprovince_id: String) -> Dictionary:
	return _subprovince_data.get(subprovince_id, {})


## Returns all subprovince IDs belonging to a province (prebuilt at load time).
func get_province_subprovince_ids(province_id: String) -> PackedStringArray:
	return _province_subprovince_ids.get(province_id, PackedStringArray())


## Returns the outer rings of a cell projected into world space (one Polygon2D
## compatible ring per part; empty for zero-area artifact cells).
func get_subprovince_rings(subprovince_id: String) -> Array[PackedVector2Array]:
	var data: Dictionary = get_subprovince_data(subprovince_id)
	var rings: Array = data.get("raw_polygon", [])
	var result: Array[PackedVector2Array] = []
	for ring: Variant in rings:
		if ring is Array:
			result.append(_projection.project_ring(ring))
	return result


## Returns the largest projected ring of a cell — the main renderable outline.
func get_subprovince_polygon(subprovince_id: String) -> PackedVector2Array:
	var rings := get_subprovince_rings(subprovince_id)
	var largest := PackedVector2Array()
	for ring: PackedVector2Array in rings:
		if ring.size() > largest.size():
			largest = ring
	return largest


func get_subprovince_neighbors(subprovince_id: String) -> PackedStringArray:
	return _subprovince_adjacency.get(subprovince_id, PackedStringArray())


func get_subprovince_count() -> int:
	return _subprovince_data.size()


## Returns every loaded subprovince ID (deterministic: dictionary iteration order).
func get_all_subprovince_ids() -> Array:
	var ids: Array = []
	for id: Variant in _subprovince_data.keys():
		ids.append(String(id))
	return ids


# ── generated scene loading ───────────────────────────────────────────────────

## Clears loaded map scene nodes and indexed lookup data.
## Parameters: none.
## Returns: nothing.
func _clear_loaded_map() -> void:
	for child: Node in get_children():
		remove_child(child)
		child.queue_free()
	_provinces.clear()
	_province_data.clear()
	_province_click_areas.clear()
	_bounds.clear()
	_adjacency.clear()
	_terrain_lookup.clear()
	_waypoints.clear()
	_subprovince_data.clear()
	_subprovince_adjacency.clear()
	_province_subprovince_ids.clear()
	_road_geometry.clear()
	_projection = null


## Loads and indexes the authoritative subprovince assets for a map.
## Fail-clear: both files are load-bearing, so any missing/malformed data hard-fails the
## map load (same treatment as a missing map_data.json), not a warn-and-continue.
## Returns: true on success.
func _load_subprovince_data(data_root: String) -> bool:
	var sp_raw: Variant = _load_json("%s/subprovinces.geojson" % data_root)
	var adj_raw: Variant = _load_json("%s/subprovince_adjacency.geojson" % data_root)
	if not sp_raw is Dictionary or not adj_raw is Dictionary:
		push_error("MapLoader: subprovince assets missing or invalid for '%s'" % _map_id)
		map_load_failed.emit("Failed to load subprovince assets for '%s'" % _map_id)
		return false

	var sp_collection: Dictionary = sp_raw
	var adj_collection: Dictionary = adj_raw
	if sp_collection.get("type", "") != "FeatureCollection" \
			or not sp_collection.get("features", []) is Array \
			or adj_collection.get("type", "") != "FeatureCollection" \
			or not adj_collection.get("features", []) is Array:
		push_error("MapLoader: subprovince assets are not FeatureCollections for '%s'" % _map_id)
		map_load_failed.emit("Malformed subprovince assets for '%s'" % _map_id)
		return false

	var features: Array = sp_collection.get("features", [])
	for index: int in features.size():
		var feature: Variant = features[index]
		if not feature is Dictionary:
			continue
		var props: Dictionary = (feature as Dictionary).get("properties", {})
		var sid: String = props.get("subprovince_id", "")
		var pid: String = props.get("province_id", "")
		var kind: String = props.get("kind", "")
		if sid.is_empty() or pid.is_empty() or kind.is_empty():
			push_error("MapLoader: subprovince feature %d missing required properties" % index)
			map_load_failed.emit("Malformed subprovince asset for '%s'" % _map_id)
			return false
		var rings: Array = _collect_rings(feature.get("geometry", {}))
		_subprovince_data[sid] = {
			"province_id": pid,
			"kind": kind,
			"cover_combat": props.get("cover_combat", ""),
			"elevation_type": props.get("elevation_type", ""),
			"is_capital": bool(props.get("is_capital", false)),
			"raw_polygon": rings,
		}
		if not _province_subprovince_ids.has(pid):
			_province_subprovince_ids[pid] = PackedStringArray()
		var province_list: PackedStringArray = _province_subprovince_ids[pid]
		province_list.append(sid)
		_province_subprovince_ids[pid] = province_list

	var adj_features: Array = adj_collection.get("features", [])
	for index: int in adj_features.size():
		var feature: Variant = adj_features[index]
		if not feature is Dictionary:
			continue
		var props: Dictionary = (feature as Dictionary).get("properties", {})
		var sid: String = props.get("subprovince_id", "")
		if sid.is_empty():
			push_error("MapLoader: subprovince adjacency feature %d missing subprovince_id" % index)
			map_load_failed.emit("Malformed subprovince asset for '%s'" % _map_id)
			return false
		var neighbors: PackedStringArray = PackedStringArray()
		for neighbor: Variant in props.get("neighbors", []):
			if neighbor is String:
				neighbors.append(neighbor)
		_subprovince_adjacency[sid] = neighbors

	for sid: String in _subprovince_adjacency.keys():
		if not _subprovince_data.has(sid):
			push_error("MapLoader: adjacency references unknown subprovince %s" % sid)
			map_load_failed.emit("Malformed subprovince asset for '%s'" % _map_id)
			return false
	for sid: String in _subprovince_data.keys():
		if not _subprovince_adjacency.has(sid):
			push_error("MapLoader: subprovince %s missing from adjacency" % sid)
			map_load_failed.emit("Malformed subprovince asset for '%s'" % _map_id)
			return false
	return true


## Loads road_subprovince_geometry.geojson: for each road-kind subprovince cell, the real road
## centerline clipped to that cell (see map/tools/map_pipeline/road_subprovince_geometry.py).
## Soft-fails (warns and leaves _road_geometry empty) instead of failing the map load — this is a
## pure visual aid for SupplyLineOverlay, never load-bearing, matching waypoints.json's existing
## soft-fail convention rather than subprovinces.geojson's hard-fail one.
## Parameters:
## - data_root: the map's res:// asset directory, e.g. "res://assets/data/western_europe_6".
## Returns: nothing.
func _load_road_geometry(data_root: String) -> void:
	var raw: Variant = _load_json("%s/road_subprovince_geometry.geojson" % data_root)
	if not raw is Dictionary:
		push_warning("MapLoader: road_subprovince_geometry.geojson missing — supply lines will not snap to roads")
		return
	var collection: Dictionary = raw
	var features: Variant = collection.get("features", [])
	if collection.get("type", "") != "FeatureCollection" or not features is Array:
		push_warning("MapLoader: road_subprovince_geometry.geojson malformed — supply lines will not snap to roads")
		return
	for feature: Variant in features:
		if not feature is Dictionary:
			continue
		var props: Dictionary = (feature as Dictionary).get("properties", {})
		var sid: String = props.get("subprovince_id", "")
		var geometry: Variant = (feature as Dictionary).get("geometry", {})
		if sid.is_empty() or not geometry is Dictionary:
			continue
		var geom_dict: Dictionary = geometry
		var coordinates: Variant = geom_dict.get("coordinates", null)
		if geom_dict.get("type", "") == "LineString" and coordinates is Array and coordinates.size() >= 2:
			_road_geometry[sid] = coordinates


## Returns the real road-centerline points (already projected to screen space) clipped to the
## given road-kind subprovince cell, or an empty array if none was resolved for it (either the
## file is absent, or that cell had no match — see road_subprovince_geometry.py's docstring).
## Parameters:
## - subprovince_id: the road-kind cell to look up.
## Returns: projected points in the road's original (unstitched) order — callers needing a
## specific traversal direction must orient them themselves.
func get_road_geometry_points(subprovince_id: String) -> PackedVector2Array:
	var raw: Array = _road_geometry.get(subprovince_id, [])
	if raw.is_empty():
		return PackedVector2Array()
	return _projection.project_ring(raw)


## Collects a cell's [lng, lat] outer rings from a Polygon or MultiPolygon geometry.
## Returns an empty array for zero-area artifact geometries (LineString etc.).
func _collect_rings(geometry: Variant) -> Array:
	var rings: Array = []
	if not geometry is Dictionary:
		return rings
	var geom_dict: Dictionary = geometry
	var gtype: String = geom_dict.get("type", "")
	var coordinates: Variant = geom_dict.get("coordinates", null)
	if gtype == "Polygon" and coordinates is Array and coordinates.size() > 0:
		var outer: Variant = coordinates[0]
		if outer is Array and outer.size() >= 4:
			rings.append(outer)
		return rings
	if gtype == "MultiPolygon" and coordinates is Array:
		for part: Variant in coordinates:
			if part is Array and part.size() > 0:
				var outer: Variant = part[0]
				if outer is Array and outer.size() >= 4:
					rings.append(outer)
	return rings


## Instances the generated static map scene and indexes its runtime nodes.
## Parameters:
## - map_id: processed map identifier.
## Returns: true when scene load and indexing succeeded.
func _load_generated_scene(map_id: String) -> bool:
	var scene_path: String = "%s/%s.scn" % [GENERATED_SCENE_ROOT, map_id]
	if not ResourceLoader.exists(scene_path):
		map_load_failed.emit("Generated map scene is missing: %s" % scene_path)
		return false

	var resource: Resource = ResourceLoader.load(scene_path)
	if not resource is PackedScene:
		map_load_failed.emit("Generated map scene is not a PackedScene: %s" % scene_path)
		return false

	var packed_scene: PackedScene = resource
	var generated_root: Node = packed_scene.instantiate()
	if generated_root == null:
		map_load_failed.emit("Failed to instance generated map scene: %s" % scene_path)
		return false

	_adopt_generated_scene_children(generated_root)
	generated_root.free()

	if not _index_generated_provinces():
		return false
	if not _index_generated_click_areas():
		return false
	return true


## Moves generated scene layers under this loader so existing systems keep using direct child paths.
## Parameters:
## - generated_root: root node instanced from the generated map scene.
## Returns: nothing.
func _adopt_generated_scene_children(generated_root: Node) -> void:
	while generated_root.get_child_count() > 0:
		var child: Node = generated_root.get_child(0)
		generated_root.remove_child(child)
		_clear_scene_owner_recursive(child)
		add_child(child)


## Clears PackedScene owner links before moving generated nodes under the runtime loader.
## Parameters:
## - node: generated node being adopted into the active scene tree.
## Returns: nothing.
func _clear_scene_owner_recursive(node: Node) -> void:
	node.owner = null
	for child: Node in node.get_children():
		_clear_scene_owner_recursive(child)


## Indexes generated province nodes by province id.
## Parameters: none.
## Returns: true when the generated Provinces layer exists.
func _index_generated_provinces() -> bool:
	var province_container: Node = get_node_or_null("Provinces")
	if province_container == null:
		map_load_failed.emit("Generated map scene is missing Provinces")
		return false

	for province_id: String in _province_data.keys():
		var province_node: Node2D = province_container.get_node_or_null(province_id)
		if province_node == null:
			push_warning("MapLoader: generated scene is missing province node: %s" % province_id)
			continue
		_provinces[province_id] = province_node

	return true


## Indexes generated collision areas by province id for interaction.
## Parameters: none.
## Returns: true when the generated CollisionLayer exists.
func _index_generated_click_areas() -> bool:
	var collision_layer: CanvasItem = get_node_or_null("CollisionLayer")
	if collision_layer == null:
		map_load_failed.emit("Generated map scene is missing CollisionLayer")
		return false

	collision_layer.visible = true
	for child: Node in collision_layer.get_children():
		if not child is Area2D:
			continue
		var area: Area2D = child
		var province_id: String = area.get_meta("province_id", "")
		if province_id.is_empty():
			push_warning("MapLoader: generated collision area missing province_id: %s" % area.name)
			continue
		area.input_pickable = true
		_hide_collision_debug_shapes(area)
		if not _province_click_areas.has(province_id):
			_province_click_areas[province_id] = []
		_province_click_areas[province_id].append(area)

	return true


## Hides generated collision polygons from normal/debug rendering while keeping Area2D input active.
## Parameters:
## - area: generated province click area.
## Returns: nothing.
func _hide_collision_debug_shapes(area: Area2D) -> void:
	for child: Node in area.get_children():
		if child is CanvasItem:
			var canvas_item: CanvasItem = child
			canvas_item.visible = false


# ── helpers ───────────────────────────────────────────────────────────────────

func _load_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		push_warning("MapLoader: file not found — %s" % path)
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("MapLoader: cannot open — %s" % path)
		return {}
	var text := file.get_as_text()
	file.close()
	var result: Variant = JSON.parse_string(text)
	if result == null:
		push_warning("MapLoader: JSON parse error — %s" % path)
		return null
	return result
