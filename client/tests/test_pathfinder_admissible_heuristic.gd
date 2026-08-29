extends Node

## Regression test: the bidirectional A* heuristic in pathfinder.gd must stay admissible
## (never overestimate true remaining cost), or the bidirectional meet-in-the-middle
## termination check can settle on a costlier path while a cheaper road-based route
## goes unexplored. See docs/PATHFINDING.md / _heuristic() in pathfinder.gd.
##
## Graph layout (all coordinates in degrees):
##
##   S(0,0) --off-road straight line-- G(10,0)      [10 hops, base_cost 1.0 each => true cost ~10 * dist]
##
##   S(0,0) -- UP -- R0 -- R1 -- ... -- R8 -- DOWN -- G(10,0)   [a detour up to a road at lat=3,
##       then a long fast road run, then back down to G]
##
## The road run is much cheaper per-degree (ROAD_COST_BASE=0.05) than off-road (base_cost=1.0),
## so despite the geometric detour, the road route is the true cheapest path and must be chosen.

func _ready() -> void:
	var pf = load("res://src/systems/military/pathfinder.gd").new()

	var nodes: Array = []
	var edges: Array = []
	var road_connections: Array = []

	# Direct off-road chain S -> ... -> G along lat=0, 1-degree hops (10 hops)
	for i in range(11):
		nodes.append({"id": "D%d" % i, "lng": float(i), "lat": 0.0,
			"cover_combat": "plains", "elevation": "flat", "nation_id": ""})
	for i in range(10):
		edges.append({"from": "D%d" % i, "to": "D%d" % (i+1), "base_cost": 1.0, "river_size": null})

	# Road chain: connector up from D0(=S) to road at lat=3, road run to lng=10, connector down to D10(=G)
	nodes.append({"id": "UP", "lng": 0.0, "lat": 3.0,
		"cover_combat": "plains", "elevation": "flat", "nation_id": ""})
	edges.append({"from": "D0", "to": "UP", "base_cost": 1.0, "river_size": null})

	for i in range(9):
		nodes.append({"id": "R%d" % i, "lng": float(i + 1), "lat": 3.0,
			"cover_combat": "plains", "elevation": "flat", "nation_id": ""})
	edges.append({"from": "UP", "to": "R0", "base_cost": 1.0, "river_size": null})
	for i in range(8):
		edges.append({"from": "R%d" % i, "to": "R%d" % (i+1), "base_cost": 1.0, "river_size": null})
		road_connections.append({"road_id": "test_road", "waypoint_id": "R%d" % i})
	road_connections.append({"road_id": "test_road", "waypoint_id": "R8"})
	road_connections.append({"road_id": "test_road", "waypoint_id": "UP"})

	nodes.append({"id": "DOWN", "lng": 10.0, "lat": 3.0,
		"cover_combat": "plains", "elevation": "flat", "nation_id": ""})
	edges.append({"from": "R8", "to": "DOWN", "base_cost": 1.0, "river_size": null})
	edges.append({"from": "DOWN", "to": "D10", "base_cost": 1.0, "river_size": null})
	road_connections.append({"road_id": "test_road", "waypoint_id": "DOWN"})

	var graph: Dictionary = {"nodes": nodes, "edges": edges, "road_connections": road_connections}
	pf.build(graph)
	var profile := {"plains_flat": 1.0}

	var result: Dictionary = pf.find_path("D0", "D10", profile)
	var logical: Array = result.get("logical", [])

	var used_road := false
	for wp in logical:
		if str(wp).begins_with("R") or wp == "UP" or wp == "DOWN":
			used_road = true
			break

	assert(used_road, "FAIL: pathfinder chose the costlier direct off-road route, ignoring the cheaper road detour: " + str(logical))
	print("PASS test_prefers_cheaper_road_detour_over_costlier_direct_offroad")

	print("=== test_pathfinder_admissible_heuristic: all passed ===")
	get_tree().quit(0)
