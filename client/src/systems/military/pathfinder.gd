extends RefCounted
## A* pathfinder over the waypoint graph.
## Phase 4B: Two-phase routing (road entry pre-check) + string-pulling post-processor.
## Call build() once after loading the waypoint graph.
## Call find_path() for each route request — returns {"logical": Array, "visual": Array}.

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

const MAX_SPLINE_DEV_DEG: float = 0.0067
const SPLINE_SUBDIVISIONS: int = 8
const MAX_FALLBACK_CANDIDATES := 20

var _nodes: Dictionary = {}
var _adjacency: Dictionary = {}
var _road_nodes: Dictionary = {}
var _built: bool = false
var _cluster_of: Dictionary = {}       # node_id -> leaf_cluster_id
var _abstract_edges: Dictionary = {}   # cluster_id -> Array of {from, to, cost}
var _border_nodes: Dictionary = {}     # cluster_id -> Array[String] of node_ids
var _clusters_loaded: bool = false


func build(wp_graph: Dictionary) -> void:
	_nodes.clear()
	_adjacency.clear()
	_road_nodes.clear()

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

	_built = true
	print("[Pathfinder] built graph: %d nodes" % _nodes.size())


func is_built() -> bool:
	return _built


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


func _insert_synthetic_goal(goal_lng: float, goal_lat: float) -> void:
	_nodes[SYNTHETIC_GOAL_ID] = {
		"id": SYNTHETIC_GOAL_ID, "lng": goal_lng, "lat": goal_lat,
		"cover_combat": "plains", "elevation": "flat", "nation_id": null
	}
	_adjacency[SYNTHETIC_GOAL_ID] = []
	var K := 8
	var candidates: Array = []
	for nid in _nodes:
		if nid == SYNTHETIC_GOAL_ID or str(nid).begins_with("_spline"):
			continue
		var n: Dictionary = _nodes[nid]
		var ddx := float(n["lng"]) - goal_lng
		var ddy := float(n["lat"]) - goal_lat
		candidates.append([ddx*ddx + ddy*ddy, nid])
	candidates.sort()
	for i in range(min(K, candidates.size())):
		var nb_id: String = candidates[i][1]
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


## Returns the nearest waypoint ID to (lng, lat). O(n) — call only on user clicks.
func find_nearest(lng: float, lat: float) -> String:
	var best_id := ""
	var best_sq := INF
	for id: String in _nodes:
		var n: Dictionary = _nodes[id]
		var dx := float(n["lng"]) - lng
		var dy := float(n["lat"]) - lat
		var sq := dx * dx + dy * dy
		if sq < best_sq:
			best_sq = sq
			best_id = id
	return best_id


## Returns distance in degrees from (lng, lat) to the nearest road node.
## O(n road_nodes) — call on the main thread before spawning a path thread.
func nearest_road_node_distance(lng: float, lat: float) -> float:
	var best_sq := INF
	for rid: String in _road_nodes:
		var rn: Dictionary = _nodes.get(rid, {})
		if rn.is_empty():
			continue
		var dx := float(rn["lng"]) - lng
		var dy := float(rn["lat"]) - lat
		var sq := dx * dx + dy * dy
		if sq < best_sq:
			best_sq = sq
	return sqrt(best_sq)


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
	var nearby: Array = []
	for rid: String in _road_nodes:
		var rn: Dictionary = _nodes.get(rid, {})
		if rn.is_empty():
			continue
		var rlng := float(rn["lng"]); var rlat := float(rn["lat"])
		if rlng >= min_lng and rlng <= max_lng and rlat >= min_lat and rlat <= max_lat:
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
		goal_lat: float = INF) -> Dictionary:
	if not _built or from_id.is_empty() or to_id.is_empty():
		return { "logical": [], "visual": [] }
	if from_id == to_id:
		return { "logical": [from_id], "visual": [from_id] }
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return { "logical": [], "visual": [] }

	# If exact click coordinates provided, insert synthetic goal at that position
	# and route to it instead of the nearest pre-baked node
	var actual_to_id: String = to_id
	var has_synthetic: bool = false
	if goal_lng != INF and goal_lat != INF:
		_insert_synthetic_goal(goal_lng, goal_lat)
		actual_to_id = SYNTHETIC_GOAL_ID
		has_synthetic = true

	# HPA* delegation: if clusters are loaded, try hierarchical search
	if _clusters_loaded:
		var goal_node: Dictionary = _nodes.get(actual_to_id, {})
		if not goal_node.is_empty():
			var hpa_result: Array = _hpa_find_path(from_id, actual_to_id, movement_profile,
				float(goal_node.get("lng", 0.0)), float(goal_node.get("lat", 0.0)),
				road_cost_multiplier, player_nation_id, relations)
			if not hpa_result.is_empty():
				return _finalize_path(hpa_result, movement_profile, has_synthetic, to_id)

	# Off-road purity pre-check: when both endpoints are off-road, run A* once to see
	if not _road_nodes.has(from_id) and not _road_nodes.has(actual_to_id):
		var offroad_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
		var has_road := false
		for wp_id in offroad_path:
			if _road_nodes.has(wp_id):
				has_road = true
				break
		if not offroad_path.is_empty() and not has_road:
			return _finalize_path(offroad_path, movement_profile, has_synthetic, to_id)

	# Phase 1: road entry pre-check.
	if _road_nodes.has(from_id):
		var road_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations)
		if not road_path.is_empty():
			return _finalize_path(road_path, movement_profile, has_synthetic, to_id)
	else:
		var road_entry_id: String = _find_nearest_road_node(from_id)
		if road_entry_id != "":
			var seg1: Array = _astar_impl(from_id, road_entry_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
			var seg2: Array = _astar_impl(road_entry_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations)
			if not seg1.is_empty() and not seg2.is_empty():
				return _finalize_path(_join_segments(seg1, seg2), movement_profile, has_synthetic, to_id)

	# Phase 2: full A* across the entire graph
	var path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
	return _finalize_path(path, movement_profile, has_synthetic, to_id)


func find_nearest_reachable(from_id: String, near_lng: float, near_lat: float,
		movement_profile: Dictionary,
		player_nation_id: String = "",
		relations: Dictionary = {}) -> String:
	var candidates: Array = []
	for node_id: String in _nodes:
		var n: Dictionary = _nodes[node_id]
		var dx: float = float(n["lng"]) - near_lng
		var dy: float = float(n["lat"]) - near_lat
		candidates.append([dx * dx + dy * dy, node_id])
	candidates.sort_custom(func(a, b): return a[0] < b[0])
	for i in range(min(MAX_FALLBACK_CANDIDATES, candidates.size())):
		var candidate_id: String = candidates[i][1]
		if candidate_id == from_id:
			continue
		var result: Dictionary = find_path(from_id, candidate_id, movement_profile, 1.0,
				player_nation_id, relations)
		if not result.get("logical", []).is_empty():
			return candidate_id
	return ""


func _build_path_result(raw_path: Array, movement_profile: Dictionary) -> Dictionary:
	var logical: Array = _string_pull(raw_path, movement_profile)
	var visual: Array = _smooth_path(logical)
	return { "logical": logical, "visual": visual }


func _finalize_path(raw_path: Array, movement_profile: Dictionary, has_synthetic: bool, original_to_id: String) -> Dictionary:
	if has_synthetic:
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
	var best_id := ""
	var best_sq := ROAD_SEARCH_RADIUS_SQ
	for rid: String in _road_nodes:
		var rn: Dictionary = _nodes.get(rid, {})
		if rn.is_empty():
			continue
		var dx := float(rn["lng"]) - flng
		var dy := float(rn["lat"]) - flat
		var sq := dx * dx + dy * dy
		if sq < best_sq:
			best_sq = sq
			best_id = rid
	return best_id


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


func _smooth_path(waypoints: Array) -> Array:
	if waypoints.size() <= 2:
		return waypoints.duplicate()
	var result: Array = []
	var pts: Array = []
	pts.append(waypoints[0])
	pts.append_array(waypoints)
	pts.append(waypoints[-1])
	for i in range(1, pts.size() - 2):
		var p0: Dictionary = _nodes.get(str(pts[i-1]), {})
		var p1: Dictionary = _nodes.get(str(pts[i]),   {})
		var p2: Dictionary = _nodes.get(str(pts[i+1]), {})
		var p3: Dictionary = _nodes.get(str(pts[i+2]), {})
		if p0.is_empty() or p1.is_empty() or p2.is_empty() or p3.is_empty():
			result.append(pts[i])
			continue
		var t01 := pow(_dist(p0, p1), 0.5)
		var t12 := pow(_dist(p1, p2), 0.5)
		var t23 := pow(_dist(p2, p3), 0.5)
		if t01 < 1e-9 or t12 < 1e-9 or t23 < 1e-9:
			result.append(pts[i])
			continue
		var max_dev := _max_catmull_rom_deviation(p0, p1, p2, p3, t01, t12, t23)
		if max_dev > MAX_SPLINE_DEV_DEG:
			result.append(pts[i])
			continue
		if result.is_empty() or str(result[-1]) != str(pts[i]):
			result.append(pts[i])
		for s in range(1, SPLINE_SUBDIVISIONS):
			var tt: float = float(s) / float(SPLINE_SUBDIVISIONS)
			var sp: Vector2 = _catmull_rom_point(p0, p1, p2, p3, t01, t12, t23, tt)
			result.append("_spline_%f_%f" % [sp.x, sp.y])
			_nodes["_spline_%f_%f" % [sp.x, sp.y]] = {
				"id": "_spline_%f_%f" % [sp.x, sp.y],
				"lng": sp.x, "lat": sp.y,
				"cover_combat": "plains", "elevation": "flat", "nation_id": null
			}
	if waypoints.size() > 0:
		result.append(waypoints[-1])
	return result


func _dist(a: Dictionary, b: Dictionary) -> float:
	var dx := float(a.get("lng", 0.0)) - float(b.get("lng", 0.0))
	var dy := float(a.get("lat", 0.0)) - float(b.get("lat", 0.0))
	return sqrt(dx*dx + dy*dy)


func _is_neutral_for(node_id: String, player_nation_id: String, relations: Dictionary) -> bool:
	if player_nation_id.is_empty():
		return false
	var node: Dictionary = _nodes.get(node_id, {})
	var nation = node.get("nation_id", null)
	if nation == null or str(nation).is_empty() or str(nation) == player_nation_id:
		return false
	var key: String = player_nation_id + ":" + str(nation)
	if relations.has(key):
		var rel_entry = relations.get(key, {})
		if typeof(rel_entry) == TYPE_DICTIONARY:
			var stance: String = rel_entry.get("stance", "neutral")
			return stance != "war"
	return false


func _catmull_rom_point(p0: Dictionary, p1: Dictionary, p2: Dictionary, p3: Dictionary,
		t01: float, t12: float, t23: float, t: float) -> Vector2:
	var t_val := t01 + t * t12
	var t0 := 0.0; var t1 := t01; var t2 := t01 + t12; var t3 := t01 + t12 + t23
	var A1 := _lerp_pt(p0, p1, t0, t1, t_val)
	var A2 := _lerp_pt(p1, p2, t1, t2, t_val)
	var A3 := _lerp_pt(p2, p3, t2, t3, t_val)
	var B1 := _lerp_pt_v(A1, A2, t0, t2, t_val)
	var B2 := _lerp_pt_v(A2, A3, t1, t3, t_val)
	return _lerp_pt_v(B1, B2, t1, t2, t_val)


func _lerp_pt(a: Dictionary, b: Dictionary, ta: float, tb: float, tv: float) -> Vector2:
	if abs(tb - ta) < 1e-9:
		return Vector2(float(a["lng"]), float(a["lat"]))
	var r := (tv - ta) / (tb - ta)
	return Vector2(
		float(a["lng"]) + r * (float(b["lng"]) - float(a["lng"])),
		float(a["lat"]) + r * (float(b["lat"]) - float(a["lat"]))
	)


func _lerp_pt_v(a: Vector2, b: Vector2, ta: float, tb: float, tv: float) -> Vector2:
	if abs(tb - ta) < 1e-9:
		return a
	var r := (tv - ta) / (tb - ta)
	return Vector2(a.x + r * (b.x - a.x), a.y + r * (b.y - a.y))


func _max_catmull_rom_deviation(p0: Dictionary, p1: Dictionary, p2: Dictionary, p3: Dictionary,
		t01: float, t12: float, t23: float) -> float:
	var max_dev := 0.0
	var line_start := Vector2(float(p1["lng"]), float(p1["lat"]))
	var line_end   := Vector2(float(p2["lng"]), float(p2["lat"]))
	for s in range(1, SPLINE_SUBDIVISIONS):
		var t := float(s) / float(SPLINE_SUBDIVISIONS)
		var sp := _catmull_rom_point(p0, p1, p2, p3, t01, t12, t23, t)
		var dev := _point_to_segment_dist(sp, line_start, line_end)
		if dev > max_dev:
			max_dev = dev
	return max_dev


func _point_to_segment_dist(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var ap := p - a
	var t_val := ab.dot(ap) / (ab.length_squared() + 1e-9)
	t_val = clamp(t_val, 0.0, 1.0)
	return (p - (a + t_val * ab)).length()


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
	# Weighted heuristic: 10× ROAD_COST_BASE. Inadmissible but A* converges
	# much faster on 128K nodes. Road preference is preserved by the cost model
	# (road 0.05/deg vs CT 1.0/deg), not by heuristic admissibility.
	return sqrt(dx * dx + dy * dy) * ROAD_COST_BASE * 10.0


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
		relations: Dictionary = {}) -> Array:
	_insert_synthetic_goal(goal_lng, goal_lat)

	var from_cluster: String = _cluster_of.get(from_id, "")
	var to_cluster: String = _cluster_of.get(SYNTHETIC_GOAL_ID, "")

	# If same cluster or clusters not found, fall back
	if from_cluster.is_empty() or to_cluster.is_empty() or from_cluster == to_cluster:
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
		_remove_synthetic_goal()
		return _substitute_synthetic(flat, to_id)

	# Abstract search: Dijkstra over abstract graph
	var abstract_path: Array = _abstract_dijkstra(from_cluster, to_cluster)
	if abstract_path.is_empty():
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations)
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
