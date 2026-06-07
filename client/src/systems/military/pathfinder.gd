extends RefCounted
## A* pathfinder over the waypoint graph.
## Call build() once after loading the waypoint graph.
## Call find_path() for each route request — returns ordered waypoint ID list.

const ROAD_COST_BASE := 0.05  # Road travel is ~20x cheaper than open plains baseline
const RIVER_PENALTIES := {
	"minor": 1.8,
	"moderate": 3.0,
	"major": 4.5,
}

var _nodes: Dictionary = {}      # id → { lng, lat, cover_combat, elevation }
var _adjacency: Dictionary = {}  # id → Array[{ to, base_cost, river_penalty, on_road }]
var _road_nodes: Dictionary = {} # id → true (set)
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

		if _adjacency.has(from_id):
			_adjacency[from_id].append({
				"to": to_id, "base_cost": base_cost,
				"river_penalty": river_penalty, "on_road": _road_nodes.has(to_id)
			})
		if _adjacency.has(to_id):
			_adjacency[to_id].append({
				"to": from_id, "base_cost": base_cost,
				"river_penalty": river_penalty, "on_road": _road_nodes.has(from_id)
			})

	_built = true
	print("[Pathfinder] built graph: %d nodes" % _nodes.size())


func is_built() -> bool:
	return _built


## Returns {lng, lat} for a waypoint id, or an empty dict if not found.
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


## A* from from_id to to_id using the division's movement_profile.
## movement_profile: Dictionary[String → float], keys like "plains_flat", "light_forest_hills".
## Returns ordered Array[String] of waypoint IDs, or [] if unreachable.
func find_path(from_id: String, to_id: String, movement_profile: Dictionary) -> Array:
	if not _built or from_id.is_empty() or to_id.is_empty():
		return []
	if from_id == to_id:
		return [from_id]
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return []

	var to_node: Dictionary = _nodes[to_id]
	var g_score: Dictionary = { from_id: 0.0 }
	var came_from: Dictionary = {}
	var closed: Dictionary = {}
	var heap := _MinHeap.new()
	heap.push(0.0, from_id)

	while not heap.is_empty():
		var entry: Array = heap.pop()
		var current_id: String = entry[1]

		if closed.has(current_id):
			continue
		closed[current_id] = true

		if current_id == to_id:
			return _reconstruct(came_from, to_id)

		var current_g: float = g_score.get(current_id, INF)

		for edge: Dictionary in _adjacency.get(current_id, []):
			var nb_id: String = edge["to"]
			if closed.has(nb_id):
				continue

			var cost := _edge_cost(edge, nb_id, movement_profile)
			if cost == INF:
				continue

			var tentative_g := current_g + cost
			if tentative_g < g_score.get(nb_id, INF):
				came_from[nb_id] = current_id
				g_score[nb_id] = tentative_g
				heap.push(tentative_g + _heuristic(_nodes[nb_id], to_node), nb_id)

	return []


func _edge_cost(edge: Dictionary, nb_id: String, movement_profile: Dictionary) -> float:
	var river_penalty: float = edge["river_penalty"]
	if edge["on_road"]:
		return ROAD_COST_BASE * river_penalty

	var nb: Dictionary = _nodes.get(nb_id, {})
	var key: String = str(nb.get("cover_combat", "")) + "_" + str(nb.get("elevation", ""))
	# Default to 1.0 (passable at normal cost) when no profile is set — allows debug
	# divisions without movement_profile_json to traverse any terrain.
	var profile_cost: float = movement_profile.get(key, 1.0)
	if profile_cost == INF:
		return INF

	return edge["base_cost"] * profile_cost * river_penalty


func _heuristic(a: Dictionary, b: Dictionary) -> float:
	var dx := float(a["lng"]) - float(b["lng"])
	var dy := float(a["lat"]) - float(b["lat"])
	return sqrt(dx * dx + dy * dy)


func _reconstruct(came_from: Dictionary, to_id: String) -> Array:
	var path: Array = [to_id]
	var cur := to_id
	while came_from.has(cur):
		cur = came_from[cur]
		path.push_front(cur)
	return path


# ── Min-heap ───────────────────────────────────────────────────────────────────

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
