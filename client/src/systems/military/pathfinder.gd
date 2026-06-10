extends RefCounted
## A* pathfinder over the waypoint graph.
## Phase 4B: Two-phase routing (road entry pre-check) + string-pulling post-processor.
## Call build() once after loading the waypoint graph.
## Call find_path() for each route request — returns ordered waypoint ID list.

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

var _nodes: Dictionary = {}
var _adjacency: Dictionary = {}
var _road_nodes: Dictionary = {}
var _built: bool = false


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


## Returns {lng, lat, ...} for a waypoint id, or an empty dict if not found.
func get_node(wp_id: String) -> Dictionary:
	return _nodes.get(wp_id, {})


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
		road_cost_multiplier: float = 1.0) -> Array:
	if not _built or from_id.is_empty() or to_id.is_empty():
		return []
	if from_id == to_id:
		return [from_id]
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return []

	# Phase 1: road entry pre-check.
	if _road_nodes.has(from_id):
		# Start is already on a road — try road-only A* first.
		var road_path: Array = _astar_impl(from_id, to_id, movement_profile, true, road_cost_multiplier)
		if not road_path.is_empty():
			return _string_pull(road_path, movement_profile)
		# Road-only failed (destination off-road) → fall to phase 2.
	else:
		# Start is off-road — find nearest road node within ROAD_SEARCH_RADIUS.
		var road_entry_id: String = _find_nearest_road_node(from_id)
		if road_entry_id != "":
			var seg1: Array = _astar_impl(from_id, road_entry_id, movement_profile, false, road_cost_multiplier)
			var seg2: Array = _astar_impl(road_entry_id, to_id, movement_profile, true, road_cost_multiplier)
			if not seg1.is_empty() and not seg2.is_empty():
				return _string_pull(_join_segments(seg1, seg2), movement_profile)
		# No road nearby or road path failed → fall to phase 2.

	# Phase 2: full A* across the entire graph (natural road preference via costs).
	var path: Array = _astar_impl(from_id, to_id, movement_profile, false, road_cost_multiplier)
	return _string_pull(path, movement_profile)


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
		road_only: bool, road_cost_multiplier: float = 1.0) -> Array:
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
		var cost: float = float(movement_profile.get(key, 1.0))
		if cost == INF or not is_finite(cost):
			return false
	return true


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
	var profile_cost: float = float(movement_profile.get(key, 1.0))
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
