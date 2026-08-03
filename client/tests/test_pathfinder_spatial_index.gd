extends Node

const Pathfinder := preload("res://src/systems/military/pathfinder.gd")


func _ready() -> void:
	var graph: Dictionary = _make_graph()
	var pathfinder: RefCounted = Pathfinder.new()
	pathfinder.build(graph)

	_test_nearest_matches_brute_force(pathfinder, graph)
	_test_deterministic_ties(pathfinder)
	_test_neutral_filter(pathfinder)
	_test_road_index(pathfinder)
	_test_temporary_nodes_are_not_indexed(pathfinder)
	_test_rebuild_clears_index(pathfinder)

	print("=== test_pathfinder_spatial_index: all passed ===")
	get_tree().quit(0)


func _make_graph() -> Dictionary:
	var nodes: Array = [
		{"id": "tie_b", "lng": -0.01, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
		{"id": "tie_a", "lng": 0.01, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
		{"id": "neutral", "lng": 0.0, "lat": 0.01, "cover_combat": "plains", "elevation": "flat", "nation_id": "neutral_nation"},
	]
	var roads: Array = [{"waypoint_id": "tie_a"}]
	for x: int in range(30):
		for y: int in range(20):
			var node_id := "grid_%02d_%02d" % [x, y]
			nodes.append({
				"id": node_id,
				"lng": -0.6 + float(x) * 0.041,
				"lat": -0.4 + float(y) * 0.037,
				"cover_combat": "plains",
				"elevation": "flat",
				"nation_id": "player",
			})
			if (x + y) % 17 == 0:
				roads.append({"waypoint_id": node_id})
	return {"nodes": nodes, "edges": [], "road_connections": roads}


func _test_nearest_matches_brute_force(pathfinder: RefCounted, graph: Dictionary) -> void:
	var queries: Array[Vector2] = [
		Vector2(0.0, 0.0),
		Vector2(-0.33, 0.19),
		Vector2(0.58, -0.27),
		Vector2(-2.0, 3.0),
		Vector2(4.0, -3.0),
	]
	for query: Vector2 in queries:
		var expected: Array[String] = _brute_nearest(graph["nodes"], query.x, query.y, 8)
		var actual: Array[String] = pathfinder._find_nearest_ids(query.x, query.y, 8)
		assert(actual == expected, "nearest-8 mismatch at %s: %s != %s" % [query, actual, expected])
		assert(pathfinder.find_nearest(query.x, query.y) == expected[0])
	print("PASS test_nearest_matches_brute_force")


func _test_deterministic_ties(_pathfinder: RefCounted) -> void:
	var tie_pathfinder: RefCounted = Pathfinder.new()
	tie_pathfinder.build({
		"nodes": [
			{"id": "tie_b", "lng": -0.01, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
			{"id": "tie_a", "lng": 0.01, "lat": 0.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
		],
		"edges": [],
		"road_connections": [],
	})
	var nearest: Array[String] = tie_pathfinder._find_nearest_ids(0.0, 0.0, 2)
	assert(nearest[0] == "tie_a", "equal-distance nodes must sort by waypoint ID")
	assert(nearest[1] == "tie_b", "equal-distance nodes must sort by waypoint ID")
	print("PASS test_deterministic_ties")


func _test_neutral_filter(pathfinder: RefCounted) -> void:
	var relations := {"player:neutral_nation": {"stance": "neutral"}}
	var nearest: Array[String] = pathfinder._find_nearest_ids(
		0.0, 0.01, 8, "player", relations)
	assert(not nearest.has("neutral"), "neutral waypoint must not be a synthetic-goal candidate")
	print("PASS test_neutral_filter")


func _test_road_index(pathfinder: RefCounted) -> void:
	var road_ids: Array[String] = pathfinder._find_nearest_ids(0.011, 0.0, 1, "", {}, true)
	assert(road_ids == ["tie_a"], "road-only query must return the nearest indexed road")
	assert(is_equal_approx(pathfinder.nearest_road_node_distance(0.011, 0.0), 0.001))
	print("PASS test_road_index")


func _test_temporary_nodes_are_not_indexed(pathfinder: RefCounted) -> void:
	pathfinder._insert_synthetic_goal(10.0, 10.0)
	assert(pathfinder.find_nearest(10.0, 10.0) != "_synthetic_goal")
	pathfinder._remove_synthetic_goal()
	print("PASS test_temporary_nodes_are_not_indexed")


func _test_rebuild_clears_index(pathfinder: RefCounted) -> void:
	var replacement: Dictionary = {
		"nodes": [
			{"id": "replacement", "lng": 8.0, "lat": 9.0, "cover_combat": "plains", "elevation": "flat", "nation_id": "player"},
		],
		"edges": [],
		"road_connections": [],
	}
	pathfinder.build(replacement)
	assert(pathfinder.find_nearest(0.0, 0.0) == "replacement")
	assert(pathfinder.nearest_road_node_distance(0.0, 0.0) == INF)
	print("PASS test_rebuild_clears_index")


func _brute_nearest(nodes: Array, lng: float, lat: float, count: int) -> Array[String]:
	var candidates: Array = []
	for node: Dictionary in nodes:
		var dx: float = float(node["lng"]) - lng
		var dy: float = float(node["lat"]) - lat
		candidates.append([dx * dx + dy * dy, str(node["id"])])
	candidates.sort_custom(func(a: Array, b: Array) -> bool:
		if float(a[0]) == float(b[0]):
			return str(a[1]) < str(b[1])
		return float(a[0]) < float(b[0]))
	var result: Array[String] = []
	for index: int in range(mini(count, candidates.size())):
		result.append(str(candidates[index][1]))
	return result
