extends RefCounted
## A* pathfinder over the waypoint graph.
## Phase 4B: Two-phase routing (road entry pre-check) + string-pulling post-processor.
## Call build() once after loading the waypoint graph.
## Call find_path() for each route request — returns {"logical": Array[String]} (a sequence of
## real waypoint ids from the graph; off-road jitter sub-points and the resolved final-click
## terminal are added by the consumer via `_inject_offroad_jitter` + manual append, see
## LAND_MOVEMENT_IMPROVEMENTS.md Points 2 + 4).

const ROAD_COST_BASE := 0.05
const RIVER_PENALTIES := {
	"minor": 1.8,
	"moderate": 3.0,
	"major": 4.5,
}
## Squared radius (~1.5 km) for finding the nearest road entry node.
const ROAD_SEARCH_RADIUS_SQ := 0.015 * 0.015
## Max squared distance (~5 km) allowed when string-pulling a skip.
const MAX_SKIP_DIST_SQ := 0.05 * 0.05
## Road-crossing detection constants for shift-move intent heuristic.
const ROAD_PROXIMITY_DEG   := 0.003           # ~300m — counts as "road in the way"
const ROAD_PROXIMITY_SQ    := 0.003 * 0.003
const ROAD_CROSS_SAMPLE_DEG := 0.002          # ~200m sample interval along segment
const SYNTHETIC_GOAL_ID := "_synthetic_goal"

## Last-mile ("exact click target") straight-line hop bounds — see resolve_final_position's doc
## comment. Client-local tunables; deliberately not required to match movement_system.ts's
## server-side constants exactly, since this is only a coarser prediction the server's own
## resolveFinalPosition remains authoritative over.
const LAST_MILE_CAP_SLACK_MULT := 1.5
const FALLBACK_LAST_MILE_CAP_DEG := 0.05
const LAST_MILE_SWEEP_STEP_DEG := 0.02

const MAX_FALLBACK_CANDIDATES := 5
## Off-road segment noise amplitude cap (degrees, ~330 m). Below the road-node sampling distance
## (~0.007° / ~750 m) so a jittered sub-point never crosses far enough to enter a different
## road's snap radius — the visual wobble stays in the corridor the original A* route was chosen
## to occupy. See LAND_MOVEMENT_IMPROVEMENTS.md Point 2 for design rationale.
const JITTER_AMP_DEG: float = 0.003
## Off-road segment subdivision step (degrees, ~1.7 km). Sits between the complex-tier terrain
## grid spacing (~0.07°) and the road-node spacing (~0.007°) so each off-road sub-segment is
## shorter than a typical road hop but long enough that short off-road moves generate only a
## few sub-points (cheap to animate, no busy geometry).
const JITTER_SUBDIV_STEP_DEG: float = 0.015
## Minimum number of jitter sub-points inserted on an off-road segment below JITTER_SUBDIV_STEP_DEG
## length. Ensures even very short off-road segments wobble visibly instead of skipping jitter
## entirely. Capped at MAX_JITTER_SUBDIVISIONS to bound the cost on long segments.
const MIN_JITTER_SUBDIVISIONS: int = 2
const MAX_JITTER_SUBDIVISIONS: int = 6
## Roughly 5 km per cell at Western European latitudes. The query expands across
## cells until its distance bound proves the nearest result is exact.
const SPATIAL_CELL_SIZE_DEG := 0.05

var _nodes: Dictionary = {}
var _adjacency: Dictionary = {}
var _road_nodes: Dictionary = {}
var _spatial_cells: Dictionary = {}
var _road_spatial_cells: Dictionary = {}
var _spatial_min_cell: Vector2i = Vector2i.ZERO
var _spatial_max_cell: Vector2i = Vector2i.ZERO
var _road_spatial_min_cell: Vector2i = Vector2i.ZERO
var _road_spatial_max_cell: Vector2i = Vector2i.ZERO
var _has_spatial_cells: bool = false
var _has_road_spatial_cells: bool = false
var _built: bool = false
var _cluster_of: Dictionary = {}       # node_id -> leaf_cluster_id
var _abstract_edges: Dictionary = {}   # cluster_id -> Array of {from, to, cost}
var _border_nodes: Dictionary = {}     # cluster_id -> Array[String] of node_ids
var _clusters_loaded: bool = false


func build(wp_graph: Dictionary) -> void:
	_built = false
	_nodes.clear()
	_adjacency.clear()
	_road_nodes.clear()
	_spatial_cells.clear()
	_road_spatial_cells.clear()
	_has_spatial_cells = false
	_has_road_spatial_cells = false

	for node: Dictionary in wp_graph.get("nodes", []) as Array:
		var id: String = node["id"]
		_nodes[id] = node
		_adjacency[id] = []

	for rc: Dictionary in wp_graph.get("road_connections", []) as Array:
		_road_nodes[rc["waypoint_id"]] = true

	for edge: Dictionary in wp_graph.get("edges", []) as Array:
		var from_id: String = edge["from"]
		var to_id: String = edge["to"]
		var base_cost: float = float(edge.get("base_cost", 1.0))
		var river = edge.get("river_size", null)
		var river_penalty: float = 1.0
		if river != null:
			river_penalty = RIVER_PENALTIES.get(str(river), 1.0)

		# Both endpoints must be road nodes for the edge to receive road cost.
		var both_on_road: bool = _road_nodes.has(from_id) and _road_nodes.has(to_id)

		# Geographic distance in degrees — used to make costs proportional to
		# actual travel distance so road vs off-road comparison is per-km, not per-hop.
		var dist_deg := 0.0
		var fn: Dictionary = _nodes.get(from_id, {})
		var tn: Dictionary = _nodes.get(to_id, {})
		if not fn.is_empty() and not tn.is_empty():
			var ddx := float(fn["lng"]) - float(tn["lng"])
			var ddy := float(fn["lat"]) - float(tn["lat"])
			dist_deg = sqrt(ddx * ddx + ddy * ddy)
		if dist_deg == 0.0:
			dist_deg = base_cost  # fallback: use terrain cost as proxy

		if _adjacency.has(from_id):
			_adjacency[from_id].append({
				"to": to_id, "base_cost": base_cost, "dist_deg": dist_deg,
				"river_penalty": river_penalty, "on_road": both_on_road
			})
		if _adjacency.has(to_id):
			_adjacency[to_id].append({
				"to": from_id, "base_cost": base_cost, "dist_deg": dist_deg,
				"river_penalty": river_penalty, "on_road": both_on_road
			})

	_build_spatial_indexes()
	_built = true
	print("[Pathfinder] built graph: %d nodes" % _nodes.size())


func is_built() -> bool:
	return _built


## Builds immutable geographic indexes for original graph nodes. Runtime
## synthetic and spline nodes deliberately remain outside nearest-node queries.
func _build_spatial_indexes() -> void:
	for node_id: String in _nodes:
		var node: Dictionary = _nodes[node_id]
		var cell: Vector2i = _spatial_cell_for(float(node["lng"]), float(node["lat"]))
		_add_to_spatial_cell(_spatial_cells, cell, node_id)
		if not _has_spatial_cells:
			_spatial_min_cell = cell
			_spatial_max_cell = cell
			_has_spatial_cells = true
		else:
			_spatial_min_cell = Vector2i(mini(_spatial_min_cell.x, cell.x), mini(_spatial_min_cell.y, cell.y))
			_spatial_max_cell = Vector2i(maxi(_spatial_max_cell.x, cell.x), maxi(_spatial_max_cell.y, cell.y))

		if not _road_nodes.has(node_id):
			continue
		_add_to_spatial_cell(_road_spatial_cells, cell, node_id)
		if not _has_road_spatial_cells:
			_road_spatial_min_cell = cell
			_road_spatial_max_cell = cell
			_has_road_spatial_cells = true
		else:
			_road_spatial_min_cell = Vector2i(mini(_road_spatial_min_cell.x, cell.x), mini(_road_spatial_min_cell.y, cell.y))
			_road_spatial_max_cell = Vector2i(maxi(_road_spatial_max_cell.x, cell.x), maxi(_road_spatial_max_cell.y, cell.y))


func _spatial_cell_for(lng: float, lat: float) -> Vector2i:
	return Vector2i(floori(lng / SPATIAL_CELL_SIZE_DEG), floori(lat / SPATIAL_CELL_SIZE_DEG))


func _add_to_spatial_cell(index: Dictionary, cell: Vector2i, node_id: String) -> void:
	var cell_nodes: Array = index.get(cell, [])
	cell_nodes.append(node_id)
	index[cell] = cell_nodes


## Returns the exact nearest node IDs in deterministic distance/ID order.
## Neutral filtering is applied while candidates are selected so excluded cells
## cannot cause the distance-bound search to terminate early.
func _find_nearest_ids(lng: float, lat: float, count: int,
		player_nation_id: String = "", relations: Dictionary = {},
		road_only: bool = false) -> Array[String]:
	var result: Array[String] = []
	if count <= 0:
		return result

	var index: Dictionary = _road_spatial_cells if road_only else _spatial_cells
	var has_cells: bool = _has_road_spatial_cells if road_only else _has_spatial_cells
	if not has_cells:
		return result
	var min_cell: Vector2i = _road_spatial_min_cell if road_only else _spatial_min_cell
	var max_cell: Vector2i = _road_spatial_max_cell if road_only else _spatial_max_cell
	var query_cell: Vector2i = _spatial_cell_for(lng, lat)
	var center := Vector2i(
		clampi(query_cell.x, min_cell.x, max_cell.x),
		clampi(query_cell.y, min_cell.y, max_cell.y))
	var candidates: Array = []
	var max_ring: int = maxi(
		maxi(center.x - min_cell.x, max_cell.x - center.x),
		maxi(center.y - min_cell.y, max_cell.y - center.y))

	for ring: int in range(max_ring + 1):
		_scan_spatial_ring(index, center, ring, lng, lat, count,
			player_nation_id, relations, candidates)
		if candidates.size() < count:
			continue
		var scanned_min := Vector2i(maxi(min_cell.x, center.x - ring), maxi(min_cell.y, center.y - ring))
		var scanned_max := Vector2i(mini(max_cell.x, center.x + ring), mini(max_cell.y, center.y + ring))
		var unsearched_sq: float = _nearest_unsearched_cell_distance_sq(
			lng, lat, min_cell, max_cell, scanned_min, scanned_max)
		if float(candidates[-1][0]) < unsearched_sq:
			break

	for candidate: Array in candidates:
		result.append(str(candidate[1]))
	return result


## Scans one square cell ring and retains only the nearest requested candidates.
func _scan_spatial_ring(index: Dictionary, center: Vector2i, ring: int,
		lng: float, lat: float, count: int, player_nation_id: String,
		relations: Dictionary, candidates: Array) -> void:
	if ring == 0:
		_scan_spatial_cell(index, center, lng, lat, count, player_nation_id, relations, candidates)
		return
	var min_x: int = center.x - ring
	var max_x: int = center.x + ring
	var min_y: int = center.y - ring
	var max_y: int = center.y + ring
	for cell_x: int in range(min_x, max_x + 1):
		_scan_spatial_cell(index, Vector2i(cell_x, min_y), lng, lat, count,
			player_nation_id, relations, candidates)
		_scan_spatial_cell(index, Vector2i(cell_x, max_y), lng, lat, count,
			player_nation_id, relations, candidates)
	for cell_y: int in range(min_y + 1, max_y):
		_scan_spatial_cell(index, Vector2i(min_x, cell_y), lng, lat, count,
			player_nation_id, relations, candidates)
		_scan_spatial_cell(index, Vector2i(max_x, cell_y), lng, lat, count,
			player_nation_id, relations, candidates)


func _scan_spatial_cell(index: Dictionary, cell: Vector2i, lng: float, lat: float,
		count: int, player_nation_id: String, relations: Dictionary,
		candidates: Array) -> void:
	for node_id_value: Variant in index.get(cell, []):
		var node_id := str(node_id_value)
		if not player_nation_id.is_empty() and _is_neutral_for(node_id, player_nation_id, relations):
			continue
		var node: Dictionary = _nodes[node_id]
		var dx: float = float(node["lng"]) - lng
		var dy: float = float(node["lat"]) - lat
		candidates.append([dx * dx + dy * dy, node_id])
		candidates.sort_custom(_spatial_candidate_less)
		if candidates.size() > count:
			candidates.pop_back()


func _spatial_candidate_less(a: Array, b: Array) -> bool:
	if float(a[0]) == float(b[0]):
		return str(a[1]) < str(b[1])
	return float(a[0]) < float(b[0])


## Computes a lower distance bound to every cell outside the searched rectangle.
func _nearest_unsearched_cell_distance_sq(lng: float, lat: float,
		all_min: Vector2i, all_max: Vector2i,
		scanned_min: Vector2i, scanned_max: Vector2i) -> float:
	var best_sq := INF
	if scanned_min.x > all_min.x:
		best_sq = minf(best_sq, _distance_sq_to_cell_rect(lng, lat,
			all_min, Vector2i(scanned_min.x - 1, all_max.y)))
	if scanned_max.x < all_max.x:
		best_sq = minf(best_sq, _distance_sq_to_cell_rect(lng, lat,
			Vector2i(scanned_max.x + 1, all_min.y), all_max))
	if scanned_min.y > all_min.y:
		best_sq = minf(best_sq, _distance_sq_to_cell_rect(lng, lat,
			Vector2i(scanned_min.x, all_min.y), Vector2i(scanned_max.x, scanned_min.y - 1)))
	if scanned_max.y < all_max.y:
		best_sq = minf(best_sq, _distance_sq_to_cell_rect(lng, lat,
			Vector2i(scanned_min.x, scanned_max.y + 1), Vector2i(scanned_max.x, all_max.y)))
	return best_sq


func _distance_sq_to_cell_rect(lng: float, lat: float,
		min_cell: Vector2i, max_cell: Vector2i) -> float:
	var min_lng: float = float(min_cell.x) * SPATIAL_CELL_SIZE_DEG
	var max_lng: float = float(max_cell.x + 1) * SPATIAL_CELL_SIZE_DEG
	var min_lat: float = float(min_cell.y) * SPATIAL_CELL_SIZE_DEG
	var max_lat: float = float(max_cell.y + 1) * SPATIAL_CELL_SIZE_DEG
	var dx: float = maxf(maxf(min_lng - lng, lng - max_lng), 0.0)
	var dy: float = maxf(maxf(min_lat - lat, lat - max_lat), 0.0)
	return dx * dx + dy * dy


## Returns indexed road nodes inside a geographic rectangle.
func _road_nodes_in_rect(min_lng: float, min_lat: float,
		max_lng: float, max_lat: float) -> Array[String]:
	var result: Array[String] = []
	if not _has_road_spatial_cells:
		return result
	var min_cell: Vector2i = _spatial_cell_for(min_lng, min_lat)
	var max_cell: Vector2i = _spatial_cell_for(max_lng, max_lat)
	for cell_x: int in range(min_cell.x, max_cell.x + 1):
		for cell_y: int in range(min_cell.y, max_cell.y + 1):
			for node_id_value: Variant in _road_spatial_cells.get(Vector2i(cell_x, cell_y), []):
				var node_id := str(node_id_value)
				var node: Dictionary = _nodes[node_id]
				var node_lng: float = float(node["lng"])
				var node_lat: float = float(node["lat"])
				if node_lng >= min_lng and node_lng <= max_lng \
						and node_lat >= min_lat and node_lat <= max_lat:
					result.append(node_id)
	return result


func build_clusters(cluster_data: Dictionary) -> void:
	_cluster_of.clear()
	_abstract_edges.clear()
	_border_nodes.clear()

	for cluster: Dictionary in cluster_data.get("clusters", []) as Array:
		var cid: String = cluster["id"]
		var children: Array = cluster.get("children", [])
		var border: Array = cluster.get("border_nodes", [])
		_border_nodes[cid] = border
		if children.is_empty():
			for nid in border:
				_cluster_of[str(nid)] = cid

	for edge: Dictionary in cluster_data.get("abstract_edges", []) as Array:
		var cid: String = edge["cluster_id"]
		if not _abstract_edges.has(cid):
			_abstract_edges[cid] = []
		_abstract_edges[cid].append({
			"from": str(edge["from"]),
			"to": str(edge["to"]),
			"cost": float(edge["cost"])
		})

	_clusters_loaded = true
	print("[Pathfinder] clusters loaded: %d leaf mappings, %d abstract edges total" % [
		_cluster_of.size(),
		cluster_data.get("abstract_edges", []).size()
	])


## Returns {lng, lat, ...} for a waypoint id, or an empty dict if not found.
func get_node(wp_id: String) -> Dictionary:
	return _nodes.get(wp_id, {})


## Returns true if wp_id is a road-connected waypoint node.
func is_road_node(wp_id: String) -> bool:
	return _road_nodes.has(wp_id)


func _insert_synthetic_goal(goal_lng: float, goal_lat: float,
		player_nation_id: String = "", relations: Dictionary = {}) -> void:
	_nodes[SYNTHETIC_GOAL_ID] = {
		"id": SYNTHETIC_GOAL_ID, "lng": goal_lng, "lat": goal_lat,
		"cover_combat": "plains", "elevation": "flat", "nation_id": null
	}
	_adjacency[SYNTHETIC_GOAL_ID] = []
	var K := 8
	var to_connect: Array[String] = _find_nearest_ids(
		goal_lng, goal_lat, K, player_nation_id, relations)
	for nb_id: String in to_connect:
		var nb: Dictionary = _nodes[nb_id]
		var ddx := float(nb["lng"]) - goal_lng
		var ddy := float(nb["lat"]) - goal_lat
		var dist_deg := sqrt(ddx*ddx + ddy*ddy)
		var edge_entry: Dictionary = {
			"to": nb_id, "base_cost": 1.0, "dist_deg": dist_deg,
			"river_penalty": 1.0, "on_road": false
		}
		_adjacency[SYNTHETIC_GOAL_ID].append(edge_entry)
		_adjacency[nb_id].append({
			"to": SYNTHETIC_GOAL_ID, "base_cost": 1.0, "dist_deg": dist_deg,
			"river_penalty": 1.0, "on_road": false
		})


func _remove_synthetic_goal() -> void:
	if not _nodes.has(SYNTHETIC_GOAL_ID):
		return
	for edge: Dictionary in _adjacency.get(SYNTHETIC_GOAL_ID, []):
		var nb_id: String = edge["to"]
		if _adjacency.has(nb_id):
			_adjacency[nb_id] = _adjacency[nb_id].filter(
				func(e): return str(e["to"]) != SYNTHETIC_GOAL_ID)
	_nodes.erase(SYNTHETIC_GOAL_ID)
	_adjacency.erase(SYNTHETIC_GOAL_ID)


## Returns the nearest original waypoint ID to (lng, lat).
func find_nearest(lng: float, lat: float) -> String:
	var nearest: Array[String] = _find_nearest_ids(lng, lat, 1)
	return "" if nearest.is_empty() else nearest[0]


## Returns distance in degrees from (lng, lat) to the nearest road node.
func nearest_road_node_distance(lng: float, lat: float) -> float:
	var nearest: Array[String] = _find_nearest_ids(lng, lat, 1, "", {}, true)
	if nearest.is_empty():
		return INF
	var node: Dictionary = _nodes[nearest[0]]
	var dx: float = float(node["lng"]) - lng
	var dy: float = float(node["lat"]) - lat
	return sqrt(dx * dx + dy * dy)


## Returns true if a significant road passes within ~300m of the line from_id→to_id.
## Samples at ~200m intervals. Pre-filters road nodes to segment bbox before sampling
## to avoid iterating the full road node set (~O(road_nodes + steps×nearby)).
func road_crosses_segment(from_id: String, to_id: String) -> bool:
	var a: Dictionary = _nodes.get(from_id, {})
	var b: Dictionary = _nodes.get(to_id, {})
	if a.is_empty() or b.is_empty():
		return false
	var alng := float(a["lng"]); var alat := float(a["lat"])
	var blng := float(b["lng"]); var blat := float(b["lat"])
	var dx := blng - alng
	var dy := blat - alat

	# Pre-filter: collect road node positions within the segment's bounding box + proximity pad.
	var min_lng := minf(alng, blng) - ROAD_PROXIMITY_DEG
	var max_lng := maxf(alng, blng) + ROAD_PROXIMITY_DEG
	var min_lat := minf(alat, blat) - ROAD_PROXIMITY_DEG
	var max_lat := maxf(alat, blat) + ROAD_PROXIMITY_DEG
	var nearby: Array[Vector2] = []
	for rid: String in _road_nodes_in_rect(min_lng, min_lat, max_lng, max_lat):
		var rn: Dictionary = _nodes[rid]
		var rlng := float(rn["lng"]); var rlat := float(rn["lat"])
		nearby.append(Vector2(rlng, rlat))
	if nearby.is_empty():
		return false

	var dist := sqrt(dx * dx + dy * dy)
	var steps := maxi(int(dist / ROAD_CROSS_SAMPLE_DEG), 1)
	for s in range(steps + 1):
		var t := float(s) / float(steps)
		var slng := alng + dx * t
		var slat := alat + dy * t
		for pos: Vector2 in nearby:
			var rx := pos.x - slng; var ry := pos.y - slat
			if rx * rx + ry * ry < ROAD_PROXIMITY_SQ:
				return true
	return false


## A* from from_id to to_id using the division's movement_profile.
## Two-phase: if start is off-road, routes to nearest road node first then
## road-only A* to goal. Falls back to full A* if either phase fails.
## String-pulling removes redundant intermediate waypoints from the result.
## road_cost_multiplier inflates road edge costs — used by the shift-move intent heuristic
## to discourage routing back through roads between consecutive off-road waypoints.
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
		road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {},
		goal_lng: float = INF,
		goal_lat: float = INF,
		_skip_synthetic_lifecycle: bool = false) -> Dictionary:
	if not _built or from_id.is_empty() or to_id.is_empty():
		return { "logical": [] }
	if from_id == to_id:
		return { "logical": [from_id] }
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return { "logical": [] }

	var actual_to_id: String = to_id
	var has_synthetic: bool = false
	if goal_lng != INF and goal_lat != INF:
		if not _skip_synthetic_lifecycle:
			_insert_synthetic_goal(goal_lng, goal_lat, player_nation_id, relations)
			has_synthetic = true
		actual_to_id = SYNTHETIC_GOAL_ID

	if _clusters_loaded:
		var goal_node: Dictionary = _nodes.get(actual_to_id, {})
		if not goal_node.is_empty():
			var hpa_result: Array = _hpa_find_path(from_id, actual_to_id, movement_profile,
				float(goal_node.get("lng", 0.0)), float(goal_node.get("lat", 0.0)),
				road_cost_multiplier, player_nation_id, relations, _skip_synthetic_lifecycle)
			if not hpa_result.is_empty():
				return _finalize_path(hpa_result, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	if not _road_nodes.has(from_id) and not _road_nodes.has(actual_to_id):
		var offroad_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
		var has_road := false
		for wp_id in offroad_path:
			if _road_nodes.has(wp_id):
				has_road = true
				break
		if not offroad_path.is_empty() and not has_road:
			return _finalize_path(offroad_path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	if _road_nodes.has(from_id):
		var road_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations)
		if not road_path.is_empty():
			return _finalize_path(road_path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)
	else:
		var road_entry_id: String = _find_nearest_road_node(from_id)
		if road_entry_id != "":
			var seg1: Array = _astar_impl(from_id, road_entry_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
			var seg2: Array = _astar_impl(road_entry_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations)
			if not seg1.is_empty() and not seg2.is_empty():
				return _finalize_path(_join_segments(seg1, seg2), movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	var path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
	return _finalize_path(path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)


func find_nearest_reachable(from_id: String, near_lng: float, near_lat: float,
		movement_profile: Dictionary,
		player_nation_id: String = "",
		relations: Dictionary = {}) -> String:
	var candidates: Array[String] = _find_nearest_ids(
		near_lng, near_lat, MAX_FALLBACK_CANDIDATES)
	for candidate_id: String in candidates:
		if candidate_id == from_id:
			continue
		var result: Dictionary = find_path(from_id, candidate_id, movement_profile, 1.0,
				player_nation_id, relations)
		if not result.get("logical", []).is_empty():
			return candidate_id
	return ""


func _build_path_result(raw_path: Array, movement_profile: Dictionary) -> Dictionary:
	var logical: Array = _string_pull(raw_path, movement_profile)
	return { "logical": logical }


func _finalize_path(raw_path: Array, movement_profile: Dictionary, has_synthetic: bool, original_to_id: String, _skip_synthetic_lifecycle: bool = false) -> Dictionary:
	if has_synthetic and not _skip_synthetic_lifecycle:
		_remove_synthetic_goal()
	var result: Dictionary = _build_path_result(raw_path, movement_profile)
	if has_synthetic:
		var logical: Array = result.get("logical", [])
		result["logical"] = _substitute_synthetic(logical, original_to_id)
	return result


# ── Private ──────────────────────────────────────────────────────────────────

## Returns nearest road node within ROAD_SEARCH_RADIUS of from_id, or "".
func _find_nearest_road_node(from_id: String) -> String:
	var from_node: Dictionary = _nodes.get(from_id, {})
	if from_node.is_empty():
		return ""
	var flng: float = float(from_node["lng"])
	var flat: float = float(from_node["lat"])
	var nearest: Array[String] = _find_nearest_ids(flng, flat, 1, "", {}, true)
	if nearest.is_empty():
		return ""
	var node: Dictionary = _nodes[nearest[0]]
	var dx: float = float(node["lng"]) - flng
	var dy: float = float(node["lat"]) - flat
	return nearest[0] if dx * dx + dy * dy < ROAD_SEARCH_RADIUS_SQ else ""


## Bidirectional A*. Runs forward from from_id and backward from to_id,
## meeting in the middle. Roughly halves nodes explored vs unidirectional A*.
## road_only=true skips edges where on_road==false.
## road_cost_multiplier scales road edge costs (>1 discourages road use).
func _astar_impl(from_id: String, to_id: String, movement_profile: Dictionary,
		road_only: bool, road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {}) -> Array:
	if from_id == to_id:
		return [from_id]
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return []

	var from_node: Dictionary = _nodes[from_id]
	var to_node: Dictionary = _nodes[to_id]

	# Forward search state (from_id → to_id)
	var gf: Dictionary = { from_id: 0.0 }
	var came_f: Dictionary = {}
	var closed_f: Dictionary = {}
	var heap_f := _MinHeap.new()
	heap_f.push(_heuristic(from_node, to_node), from_id)

	# Backward search state (to_id → from_id, same undirected graph)
	var gb: Dictionary = { to_id: 0.0 }
	var came_b: Dictionary = {}
	var closed_b: Dictionary = {}
	var heap_b := _MinHeap.new()
	heap_b.push(_heuristic(to_node, from_node), to_id)

	var mu := INF   # best complete path cost seen through any meeting node
	var meet := ""  # node where the two frontiers produced the best mu

	while not heap_f.is_empty() and not heap_b.is_empty():
		# Stop once neither frontier can improve on the best meeting path.
		if mu < INF and heap_f.peek_priority() + heap_b.peek_priority() >= mu:
			break

		if heap_f.peek_priority() <= heap_b.peek_priority():
			# ── Expand forward frontier ──
			var entry: Array = heap_f.pop()
			var u: String = entry[1]
			if closed_f.has(u):
				continue
			closed_f[u] = true
			# Check if backward search has already reached this node.
			if gb.has(u):
				var c: float = gf[u] + gb[u]
				if c < mu:
					mu = c
					meet = u
			var ug: float = gf[u]
			for edge: Dictionary in _adjacency.get(u, []):
				var v: String = edge["to"]
				if closed_f.has(v):
					continue
				if road_only and not edge["on_road"]:
					continue
				if v != to_id and _is_neutral_for(v, player_nation_id, relations):
					continue
				var cost: float = _edge_cost(edge, v, movement_profile, road_cost_multiplier)
				if not is_finite(cost):
					continue
				var tg: float = ug + cost
				if tg < gf.get(v, INF):
					came_f[v] = u
					gf[v] = tg
					heap_f.push(tg + _heuristic(_nodes[v], to_node), v)
		else:
			# ── Expand backward frontier ──
			var entry: Array = heap_b.pop()
			var u: String = entry[1]
			if closed_b.has(u):
				continue
			closed_b[u] = true
			# Check if forward search has already reached this node.
			if gf.has(u):
				var c: float = gf[u] + gb[u]
				if c < mu:
					mu = c
					meet = u
			var ug: float = gb[u]
			for edge: Dictionary in _adjacency.get(u, []):
				var v: String = edge["to"]
				if closed_b.has(v):
					continue
				if road_only and not edge["on_road"]:
					continue
				if v != to_id and _is_neutral_for(v, player_nation_id, relations):
					continue
				var cost: float = _edge_cost(edge, v, movement_profile, road_cost_multiplier)
				if not is_finite(cost):
					continue
				var tg: float = ug + cost
				if tg < gb.get(v, INF):
					came_b[v] = u
					gb[v] = tg
					heap_b.push(tg + _heuristic(_nodes[v], from_node), v)

	if meet.is_empty():
		return []
	return _reconstruct_bidir(came_f, came_b, meet)


## Join two path segments, deduplicating the shared junction node.
func _join_segments(seg1: Array, seg2: Array) -> Array:
	if seg1.is_empty():
		return seg2
	if seg2.is_empty():
		return seg1
	var result: Array = seg1.duplicate()
	var start := 1 if (seg2.size() > 0 and str(seg2[0]) == str(seg1.back())) else 0
	for i in range(start, seg2.size()):
		result.append(seg2[i])
	return result


## String-pulling: removes redundant intermediate waypoints from the path.
## Skips from path[i] to path[j] when all intermediate nodes are passable and
## the gap is within MAX_SKIP_DIST_SQ.
func _string_pull(path: Array, movement_profile: Dictionary) -> Array:
	if path.size() <= 2:
		return path
	var smoothed: Array = [path[0]]
	var i := 0
	while i < path.size() - 1:
		var furthest := i + 1
		for j in range(i + 2, path.size()):
			if _can_skip_to(path, i, j, movement_profile):
				furthest = j
			else:
				break
		smoothed.append(path[furthest])
		i = furthest
	return smoothed


## Returns true if path[from_idx] → path[to_idx] is a valid skip:
## within distance limit and all intermediate nodes passable.
func _can_skip_to(path: Array, from_idx: int, to_idx: int, movement_profile: Dictionary) -> bool:
	var a: Dictionary = _nodes.get(path[from_idx], {})
	var b: Dictionary = _nodes.get(path[to_idx], {})
	if a.is_empty() or b.is_empty():
		return false
	var dx := float(a["lng"]) - float(b["lng"])
	var dy := float(a["lat"]) - float(b["lat"])
	if dx * dx + dy * dy > MAX_SKIP_DIST_SQ:
		return false
	for k in range(from_idx + 1, to_idx):
		var mid: Dictionary = _nodes.get(path[k], {})
		if mid.is_empty():
			return false
		var key: String = str(mid.get("cover_combat", "")) + "_" + str(mid.get("elevation", ""))
		var raw_cost: Variant = movement_profile.get(key, 1.0)
		if raw_cost == null:
			return false
		var cost: float = float(raw_cost)
		if cost == INF or not is_finite(cost):
			return false
	return true


## Expands a raw waypoint-id list into the DR-consumable entry sequence: real waypoints preserved
## verbatim, off-road segments subdivided and offset by deterministic perpendicular noise so the
## client-visible route wobbles between waypoints instead of tracing a straight polyline. Road
## segments are emitted as the two endpoints only (no sub-points) — road geometry is already
## "jittery" in spirit, and adding noise on top would make the line look unstable.
##
## Determinism: noise is a pure function of (division_id, segment_index, sub_index), so every
## call returns the same list for the same input. This is what lets the icon animation, the HUD
## route line, and other players' HUD (all derived from the same list) agree on the geometry, and
## what makes the wobble stable across reconciliation / replays.
##
## Output entry shape: {id: String, lng: float, lat: float, kmh: float}.
## - Real waypoint: id set (the original waypoint id), lng/lat from the node, kmh from terrain
## - Sub-point: id="" (so consumers can distinguish real from synthetic without scanning ids),
##   kmh inherits from the segment's source real waypoint so a chain of sub-points moves at one
##   consistent speed rather than oscillating per-frame
##
## Parameters:
## - real_ids: ordered list of real waypoint ids (the post-string-pull output of find_path)
## - movement_profile: division profile, used for terrain-based speed lookup at real waypoints
## - division_id: seed for the deterministic noise — same id always produces the same wobble
## Returns: list of entry dictionaries ready to feed _dr_order. Empty when real_ids is empty.
func _inject_offroad_jitter(real_ids: Array, movement_profile: Dictionary, division_id: String) -> Array:
	var out: Array = []
	if real_ids.is_empty():
		return out
	var real_count: int = real_ids.size()
	for i: int in real_count:
		var rid: String = str(real_ids[i])
		var node: Dictionary = _nodes.get(rid, {})
		if node.is_empty():
			# Defensive: skip unknown ids rather than error — the wire format only allows real
			# ids, so an empty dict here means a stale or buggy caller.
			continue
		var lng: float = float(node["lng"])
		var lat: float = float(node["lat"])
		var kmh: float = _waypoint_kmh(rid, node, movement_profile)
		out.append({ "id": rid, "lng": lng, "lat": lat, "kmh": kmh })

		if i == real_count - 1:
			break

		var next_rid: String = str(real_ids[i + 1])
		var next_node: Dictionary = _nodes.get(next_rid, {})
		if next_node.is_empty():
			continue

		# Skip jitter for road-to-road segments — road geometry already implies the curves.
		if _road_nodes.has(rid) and _road_nodes.has(next_rid):
			continue

		var nlng: float = float(next_node["lng"])
		var nlat: float = float(next_node["lat"])
		var dx: float = nlng - lng
		var dy: float = nlat - lat
		var seg_len: float = sqrt(dx * dx + dy * dy)
		if seg_len <= 0.0:
			continue

		# Perpendicular unit vector (right-hand normal of the segment direction). Sign doesn't
		# matter for the visual result; choose +90° for determinism.
		var perp_x: float = -dy / seg_len
		var perp_y: float = dx / seg_len

		var subdiv_count: int = clampi(int(round(seg_len / JITTER_SUBDIV_STEP_DEG)), MIN_JITTER_SUBDIVISIONS, MAX_JITTER_SUBDIVISIONS)
		# Always emit subdiv_count sub-points between the two endpoints (NOT inclusive of either
		# endpoint — those are already in `out`). Smoothstep taper pushes amplitude to zero at the
		# segment boundaries so consecutive segments join seamlessly without visible kinks.
		var seg_idx: int = i
		for j: int in range(1, subdiv_count + 1):
			var t: float = float(j) / float(subdiv_count + 1)
			var sx: float = lng + dx * t
			var sy: float = lat + dy * t
			# Taper: 6*t^5 - 15*t^4 + 10*t^3 — smoothstep, zero derivative at endpoints so the
			# polyline is C1-continuous at the joins between segments.
			var taper: float = t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
			var noise: float = _jitter_noise(division_id, seg_idx, j)
			var off: float = JITTER_AMP_DEG * taper * noise
			out.append({
				"id": "",
				"lng": sx + perp_x * off,
				"lat": sy + perp_y * off,
				"kmh": kmh,
			})
	return out


## Returns km/h for a real waypoint (road → DR_ROAD_KMH, off-road → DR_OFFROAD_KMH / terrain_cost).
## Centralised so _inject_offroad_jitter and any future speed-lookup site share one definition.
## Impassable terrain (cost = INF or missing) returns DR_OFFROAD_KMH as a defensive fallback —
## the caller's profile lookup should have already rejected impassable waypoints before they
## reach this function, so this is a "shouldn't happen" branch rather than expected behavior.
func _waypoint_kmh(waypoint_id: String, node: Dictionary, movement_profile: Dictionary) -> float:
	if _road_nodes.has(waypoint_id):
		return 60.0  # matches DR_ROAD_KMH on the consumer side
	var key: String = str(node.get("cover_combat", "")) + "_" + str(node.get("elevation", ""))
	var raw: Variant = movement_profile.get(key, 1.0)
	if raw == null or not is_finite(float(raw)) or float(raw) <= 0.0:
		return 20.0  # DR_OFFROAD_KMH fallback
	return 20.0 / float(raw)


## Pure-function deterministic noise in [-1, 1] from (division_id, segment_index, sub_index).
## FNV-1a-style hash on the concatenated string → integer → centered float. No global state, no
## RNG sequence dependency — same triple always yields the same value, regardless of call order
## or how many other paths the system has processed.
func _jitter_noise(division_id: String, segment_index: int, sub_index: int) -> float:
	var s: String = "%s|%d|%d" % [division_id, segment_index, sub_index]
	var h: int = 2166136261  # FNV-1a 32-bit offset basis
	for i: int in s.length():
		h = (h ^ ord(s[i])) & 0xffffffff
		h = (h * 16777619) & 0xffffffff  # FNV-1a 32-bit prime
	# Center to [-1, 1]. Sign bit used to flip, magnitude to scale.
	var center: float = (float(h & 0x7fffffff) / float(0x7fffffff)) * 2.0 - 1.0
	return center


## Resolves which nation owns a waypoint node for the neutral-territory check below. Prefers LIVE
## subprovince ownership (`GameState.subprovinces`, kept current by SUBPROVINCE_CAPTURED events)
## over the node's static, map-generation-time `nation_id` field — the static field goes stale the
## moment any subprovince capture happens, which is now a frequent, granular event rather than the
## rare province-level flip it used to track. `node["subprovince_id"]` is tagged once per node at
## map-load time by `MapLoader._tag_waypoints_with_subprovince_ids()` (geometry is static; only
## ownership changes, so the tag itself never needs refreshing). Falls back to the static field when
## no tag/live entry exists — e.g. this Pathfinder's own synthetic-graph tests, which build nodes
## directly without going through MapLoader.
func _resolve_node_nation(node: Dictionary) -> Variant:
	var subprovince_id: String = str(node.get("subprovince_id", ""))
	if not subprovince_id.is_empty() and GameState.subprovinces.has(subprovince_id):
		var sp: Dictionary = GameState.subprovinces[subprovince_id]
		var owner_id: String = str(sp.get("owner_id", ""))
		if not owner_id.is_empty():
			return owner_id
	return node.get("nation_id", null)


func _is_neutral_for(node_id: String, player_nation_id: String, relations: Dictionary) -> bool:
	var node: Dictionary = _nodes.get(node_id, {})
	return _is_nation_neutral_for(_resolve_node_nation(node), player_nation_id, relations)


## Stance-check core of _is_neutral_for, factored out so resolve_final_position's segment sweep
## (last-mile straight-line validation) can reuse it against a nation resolved from an arbitrary
## sampled point's nearest node, not just a real waypoint-graph node's own ID.
func _is_nation_neutral_for(nation: Variant, player_nation_id: String, relations: Dictionary) -> bool:
	if player_nation_id.is_empty():
		return false
	if nation == null or str(nation).is_empty() or str(nation) == player_nation_id:
		return false
	if relations.is_empty():
		return false  # cold start — no data yet, fail open
	var key: String = player_nation_id + ":" + str(nation)
	if relations.has(key):
		var rel_entry = relations.get(key, {})
		if typeof(rel_entry) == TYPE_DICTIONARY:
			var stance: String = rel_entry.get("stance", "neutral")
			return stance != "war" and stance != "alliance"
	return true  # relations loaded but nation absent → treat as neutral (blocked)


## Terrain movement cost at an arbitrary point, keyed off the nearest graph node's terrain type —
## mirrors movement_system.ts's _terrainCostAtPosition. Road nodes always cost 1.0 (never
## impassable). Returns INF when off-road terrain is impassable for the given profile; fails open
## (1.0) when there's no nearby graph node at all.
func _terrain_cost_at(lng: float, lat: float, movement_profile: Dictionary) -> float:
	var nearest_id: String = find_nearest(lng, lat)
	if nearest_id.is_empty():
		return 1.0
	if is_road_node(nearest_id):
		return 1.0
	var node: Dictionary = get_node(nearest_id)
	var terrain_key: String = str(node.get("cover_combat", "")) + "_" + str(node.get("elevation", ""))
	var raw_cost: Variant = movement_profile.get(terrain_key, 1.0)
	if raw_cost == null:
		return INF
	var cost: float = float(raw_cost)
	if not is_finite(cost) or cost <= 0.0:
		return INF
	return cost


## Validates and clamps a player's exact-click "final position" against the same neutral-territory
## and terrain-passability rules the waypoint chain's A* search already applies — see
## movement_system.ts's resolveFinalPosition (the server-authoritative counterpart) for the full
## rationale. This client-side mirror exists only to keep prediction from overshooting what the
## server will accept (avoiding a visible snap-back), so it's intentionally coarser: nation lookups
## for swept points use the NEAREST graph node's resolved ownership rather than a true
## point-in-polygon test, which is precise enough for this purpose.
##
## Returns the resolved, safe point, or Vector2.INF if even the first sample beyond
## last_waypoint_id is blocked (caller should then submit the move order with no final position —
## the division simply stops at the last waypoint), matching this codebase's existing "INF = no
## value" sentinel convention (e.g. MilitarySystem.get_division_world_position).
func resolve_final_position(
		last_waypoint_id: String, requested_lng: float, requested_lat: float,
		movement_profile: Dictionary, player_nation_id: String, relations: Dictionary) -> Vector2:
	var last_node: Dictionary = get_node(last_waypoint_id)
	if last_node.is_empty():
		return Vector2.INF
	var last_lng := float(last_node.get("lng", 0.0))
	var last_lat := float(last_node.get("lat", 0.0))

	# 1. Distance cap from local graph density, with slack.
	var max_edge_deg := 0.0
	for edge: Dictionary in (_adjacency.get(last_waypoint_id, []) as Array):
		var d: float = float(edge.get("dist_deg", 0.0))
		if d > max_edge_deg:
			max_edge_deg = d
	var cap_deg: float = (max_edge_deg if max_edge_deg > 0.0 else FALLBACK_LAST_MILE_CAP_DEG) * LAST_MILE_CAP_SLACK_MULT

	var dx := requested_lng - last_lng
	var dy := requested_lat - last_lat
	var requested_dist_deg := sqrt(dx * dx + dy * dy)
	var clamp_ratio: float = minf(1.0, cap_deg / maxf(requested_dist_deg, 1e-9))
	var target_lng: float = last_lng + dx * clamp_ratio
	var target_lat: float = last_lat + dy * clamp_ratio

	# 2. Segment sweep for neutral-territory/terrain validity, truncating at the first blocked
	# sample (excludes last_node itself — already validated by the waypoint chain's own A* search).
	var sweep_dist_deg: float = sqrt((target_lng - last_lng) ** 2 + (target_lat - last_lat) ** 2)
	var steps: int = maxi(1, ceili(sweep_dist_deg / LAST_MILE_SWEEP_STEP_DEG))
	var resolved_lng := last_lng
	var resolved_lat := last_lat
	for i: int in range(1, steps + 1):
		var t: float = float(i) / float(steps)
		var lng: float = last_lng + (target_lng - last_lng) * t
		var lat: float = last_lat + (target_lat - last_lat) * t
		var nearest_id: String = find_nearest(lng, lat)
		var nation: Variant = null
		if not nearest_id.is_empty():
			nation = _resolve_node_nation(get_node(nearest_id))
		if _is_nation_neutral_for(nation, player_nation_id, relations):
			break
		if not is_finite(_terrain_cost_at(lng, lat, movement_profile)):
			break
		resolved_lng = lng
		resolved_lat = lat

	if is_equal_approx(resolved_lng, last_lng) and is_equal_approx(resolved_lat, last_lat):
		return Vector2.INF
	return Vector2(resolved_lng, resolved_lat)


func _edge_cost(edge: Dictionary, nb_id: String, movement_profile: Dictionary,
		road_cost_multiplier: float = 1.0) -> float:
	var river_penalty: float = edge["river_penalty"]
	var dist: float = edge["dist_deg"]
	if edge["on_road"]:
		return ROAD_COST_BASE * dist * river_penalty * road_cost_multiplier

	var nb: Dictionary = _nodes.get(nb_id, {})
	var key: String = str(nb.get("cover_combat", "")) + "_" + str(nb.get("elevation", ""))
	# Default to 1.0 when no profile set — allows debug divisions without
	# movement_profile_json to traverse any terrain.
	var raw: Variant = movement_profile.get(key, 1.0)
	if raw == null:
		return INF  # JSON.stringify(Infinity) → null; treat as impassable
	var profile_cost: float = float(raw)
	if profile_cost == INF or not is_finite(profile_cost):
		return INF
	return dist * edge["base_cost"] * profile_cost * river_penalty


func _heuristic(a: Dictionary, b: Dictionary) -> float:
	var dx := float(a["lng"]) - float(b["lng"])
	var dy := float(a["lat"]) - float(b["lat"])
	return sqrt(dx * dx + dy * dy) * ROAD_COST_BASE


func _reconstruct(came_from: Dictionary, to_id: String) -> Array:
	var path: Array = [to_id]
	var cur := to_id
	while came_from.has(cur):
		cur = came_from[cur]
		path.push_front(cur)
	return path


## Stitch forward and backward came_from maps at the meeting node.
func _reconstruct_bidir(came_f: Dictionary, came_b: Dictionary, meet: String) -> Array:
	# Forward half: trace came_f back to start, then reverse → start…meet
	var path: Array = [meet]
	var cur := meet
	while came_f.has(cur):
		cur = came_f[cur]
		path.push_front(cur)
	# Backward half: trace came_b forward to goal → meet…goal (exclude meet)
	cur = meet
	while came_b.has(cur):
		cur = came_b[cur]
		path.append(cur)
	return path


# ── HPA* ─────────────────────────────────────────────────────────────────────


func _hpa_find_path(from_id: String, to_id: String, movement_profile: Dictionary,
		goal_lng: float, goal_lat: float,
		road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {},
		_skip_synthetic_lifecycle: bool = false) -> Array:
	if not _skip_synthetic_lifecycle:
		_insert_synthetic_goal(goal_lng, goal_lat, player_nation_id, relations)

	var from_cluster: String = _cluster_of.get(from_id, "")
	var to_cluster: String = _cluster_of.get(SYNTHETIC_GOAL_ID, "")

	# If same cluster or clusters not found, fall back
	if from_cluster.is_empty() or to_cluster.is_empty() or from_cluster == to_cluster:
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
		if not _skip_synthetic_lifecycle:
			_remove_synthetic_goal()
		return _substitute_synthetic(flat, to_id)

	# Abstract search: Dijkstra over abstract graph
	var abstract_path: Array = _abstract_dijkstra(from_cluster, to_cluster)
	if abstract_path.is_empty():
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
		if not _skip_synthetic_lifecycle:
			_remove_synthetic_goal()
		return _substitute_synthetic(flat, to_id)

	# For each cluster in the abstract path, run A* restricted to that cluster's border nodes
	var all_path_nodes: Array = [from_id]
	for i in range(abstract_path.size()):
		var cid: String = abstract_path[i]
		if not _abstract_edges.has(cid):
			continue
		var ab_edges: Array = _abstract_edges[cid]
		for ae in ab_edges:
			var ae_dict: Dictionary = ae
			if not all_path_nodes.has(ae_dict["from"]):
				all_path_nodes.append(ae_dict["from"])
			if not all_path_nodes.has(ae_dict["to"]):
				all_path_nodes.append(ae_dict["to"])

	if not all_path_nodes.has(SYNTHETIC_GOAL_ID):
		all_path_nodes.append(SYNTHETIC_GOAL_ID)

	var stitched: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
	if not _skip_synthetic_lifecycle:
		_remove_synthetic_goal()
	return _substitute_synthetic(stitched, to_id)


func _substitute_synthetic(path: Array, to_id: String) -> Array:
	if path.is_empty():
		return path
	var result: Array = path.duplicate()
	for i in range(result.size()):
		if str(result[i]) == SYNTHETIC_GOAL_ID:
			result[i] = to_id
	return result


func _abstract_dijkstra(from_cluster: String, to_cluster: String) -> Array:
	if from_cluster == to_cluster:
		return [from_cluster]
	var dist: Dictionary = {from_cluster: 0.0}
	var came_from: Dictionary = {}
	var heap: Array = [[0.0, from_cluster]]
	var visited: Dictionary = {}
	while heap.size() > 0:
		heap.sort()
		var entry: Array = heap.pop_front()
		var d: float = entry[0]
		var u: String = entry[1]
		if visited.has(u):
			continue
		visited[u] = true
		if u == to_cluster:
			var path: Array = [u]
			var cur = u
			while came_from.has(cur):
				cur = came_from[cur]
				path.push_front(cur)
			return path
		var edges: Array = _abstract_edges.get(u, [])
		for edge_data in edges:
			var edge: Dictionary = edge_data
			var v: String = ""
			if edge["from"] == str(u):
				v = edge["to"]
			else:
				v = edge["from"]
			if visited.has(v):
				continue
			# v is a node_id, need cluster_of -> cluster_id
			var v_cluster: String = _cluster_of.get(v, "")
			if v_cluster.is_empty():
				continue
			var nd: float = d + float(edge["cost"])
			if nd < dist.get(v_cluster, INF):
				dist[v_cluster] = nd
				came_from[v_cluster] = u
				heap.append([nd, v_cluster])
	return []


# ── Min-heap ──────────────────────────────────────────────────────────────────

class _MinHeap:
	var _data: Array = []

	func push(priority: float, value: String) -> void:
		_data.append([priority, value])
		_sift_up(_data.size() - 1)

	func pop() -> Array:
		if _data.is_empty():
			return []
		var result: Array = _data[0]
		var last: Array = _data.pop_back()
		if not _data.is_empty():
			_data[0] = last
			_sift_down(0)
		return result

	func is_empty() -> bool:
		return _data.is_empty()

	func peek_priority() -> float:
		if _data.is_empty():
			return INF
		return _data[0][0]

	func _sift_up(i: int) -> void:
		while i > 0:
			var parent: int = (i - 1) >> 1
			if _data[parent][0] <= _data[i][0]:
				break
			var tmp: Array = _data[parent]
			_data[parent] = _data[i]
			_data[i] = tmp
			i = parent

	func _sift_down(i: int) -> void:
		var n: int = _data.size()
		while true:
			var smallest: int = i
			var left: int = 2 * i + 1
			var right: int = 2 * i + 2
			if left < n and _data[left][0] < _data[smallest][0]:
				smallest = left
			if right < n and _data[right][0] < _data[smallest][0]:
				smallest = right
			if smallest == i:
				break
			var tmp: Array = _data[smallest]
			_data[smallest] = _data[i]
			_data[i] = tmp
			i = smallest
