# Combat-Avoidance Pathfinding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Routes computed by the client A* pathfinder avoid active combat zones unless
the segment's own destination waypoint lies inside that zone.

**Architecture:** Server broadcasts `engagement_id` on `COMBAT_STARTED`/`COMBAT_ENDED`
(already tracked internally, just not sent). Client `GameState` tracks active
`{engagement_id: {division_a, division_b}}` pairs. `military_system.gd` unions those
pairs (division-sharing pairs merge into one cluster) into combat zones — each a list of
participant positions — and passes them into `pathfinder.gd`'s `find_path`. `pathfinder.gd`
hard-excludes any graph node inside a zone during A* neighbor expansion, exactly mirroring
the existing neutral-territory exclusion (`_is_neutral_for`), except the segment's own
destination node is always exempt from the zone it belongs to.

**Tech Stack:** Godot 4 / GDScript (client), Colyseus / TypeScript (game-server).

## Global Constraints

- GDScript uses strict type annotations; avoid `:=` where a call may return `Variant`
  (`Dictionary.get()`, `get_node()`, `JSON.parse_string()`).
- `GameState` is read-only on the client outside `NetManager`/`SessionManager`'s existing
  `_apply_*` pattern — this plan only extends that existing pattern, it does not add a new
  writer.
- No server-side path validation/rerouting — this feature is entirely client-side UX; the
  server continues to accept whatever waypoint path the client sends.
- Reuse the existing `ENGAGEMENT_RADIUS_KM = 25.0` constant's *value* — do not introduce a
  second source of truth for the radius.
- New game-server tests must use `getTestPort`, belong to the `tactical` lane (already
  covers `combat_system.ts`) in `game-server/test-lanes.json`, and prefix their top-level
  `describe()` with `lane:tactical | `.
- Godot verification: `godot --headless --path client <scene.tscn>`.

---

### Task 1: Pathfinder combat-zone exclusion (`pathfinder.gd`)

**Files:**
- Modify: `client/src/systems/military/pathfinder.gd:451-505` (`find_path`), `:508-521`
  (`find_nearest_reachable`), `:561-658` (`_astar_impl`), `:1016-1063` (`_hpa_find_path`)
- Create: `client/src/systems/military/pathfinder.gd` new private helpers
  `_combat_zone_exemptions` and `_is_in_hostile_combat_zone`, plus a new constant
  `ENGAGEMENT_RADIUS_DEG`
- Test: `client/tests/test_pathfinder_combat_zones.gd` (new)
- Test scene: `client/scenes/test/test_pathfinder_combat_zones.tscn` (new)

**Interfaces:**
- Consumes: nothing new from other tasks — this task is self-contained and purely additive.
- Produces: `find_path(from_id, to_id, movement_profile, road_cost_multiplier=1.0,
  player_nation_id="", relations={}, goal_lng=INF, goal_lat=INF,
  _skip_synthetic_lifecycle=false, combat_zones: Array[Dictionary] = []) -> Dictionary`
  and `find_nearest_reachable(from_id, near_lng, near_lat, movement_profile,
  player_nation_id="", relations={}, combat_zones: Array[Dictionary] = []) -> String`.
  `combat_zones` shape: `[{"positions": Array[Vector2], ...}, ...]` (extra keys, e.g.
  `division_ids`, are ignored by the pathfinder). Task 4 consumes these two signatures.

- [ ] **Step 1: Write the failing test**

Create `client/tests/test_pathfinder_combat_zones.gd`:

```gdscript
extends Node

func _ready() -> void:
	print("=== test_pathfinder_combat_zones ===")
	var pass_count: int = 0
	var fail_count: int = 0

	# Graph: straight line A -> B -> C -> D -> E, plus a longer bypass A -> F -> G -> E.
	# A combat zone centered on B (radius covers B and C) blocks the direct route
	# unless the destination itself is inside the zone.
	var wp_graph: Dictionary = {
		"nodes": [
			{"id":"A","lng":0.0,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"B","lng":0.1,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"C","lng":0.2,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"D","lng":0.3,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"E","lng":0.4,"lat":0.0,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"F","lng":0.1,"lat":0.5,"cover_combat":"plains","elevation":"flat","nation_id":""},
			{"id":"G","lng":0.3,"lat":0.5,"cover_combat":"plains","elevation":"flat","nation_id":""},
		],
		"edges": [
			{"from":"A","to":"B","base_cost":1.0,"river_size":null},
			{"from":"B","to":"C","base_cost":1.0,"river_size":null},
			{"from":"C","to":"D","base_cost":1.0,"river_size":null},
			{"from":"D","to":"E","base_cost":1.0,"river_size":null},
			{"from":"A","to":"F","base_cost":1.0,"river_size":null},
			{"from":"F","to":"G","base_cost":1.0,"river_size":null},
			{"from":"G","to":"E","base_cost":1.0,"river_size":null},
		],
		"road_connections": [],
	}

	var pf = load("res://src/systems/military/pathfinder.gd").new()
	pf.build(wp_graph)

	# Zone centered on B, radius covers B (0.1,0.0) and C (0.2,0.0) — both within
	# ENGAGEMENT_RADIUS_DEG (~0.225 deg at 25km/111) of the zone center.
	var zone_at_b: Array[Dictionary] = [{"positions": [Vector2(0.1, 0.0)]}]

	# TEST 1: without combat_zones, A* takes the short direct route through B and C.
	var result_nofilter: Dictionary = pf.find_path("A", "E", {})
	var path_nofilter: Array = result_nofilter.get("logical", [])
	var has_b_nofilter: bool = false
	for wp in path_nofilter:
		if str(wp) == "B": has_b_nofilter = true
	if has_b_nofilter:
		print("PASS test_without_zones_routes_through_b")
		pass_count += 1
	else:
		print("FAIL test_without_zones_routes_through_b — path: ", path_nofilter)
		fail_count += 1

	# TEST 2: with a combat zone at B, and destination E outside the zone,
	# A* must avoid B/C and take the bypass through F/G.
	var result_avoid: Dictionary = pf.find_path("A", "E", {}, 1.0, "", {}, INF, INF, false, zone_at_b)
	var path_avoid: Array = result_avoid.get("logical", [])
	var has_b_avoid: bool = false
	for wp in path_avoid:
		if str(wp) == "B": has_b_avoid = true
	if not has_b_avoid and path_avoid.size() >= 2 and str(path_avoid[-1]) == "E":
		print("PASS test_zone_avoided_when_destination_outside")
		pass_count += 1
	else:
		print("FAIL test_zone_avoided_when_destination_outside — path: ", path_avoid)
		fail_count += 1

	# TEST 3: destination C is INSIDE the zone at B — the segment must still be able
	# to reach it (destination is exempt from its own zone).
	var result_dest_in_zone: Dictionary = pf.find_path("A", "C", {}, 1.0, "", {}, INF, INF, false, zone_at_b)
	var path_dest_in_zone: Array = result_dest_in_zone.get("logical", [])
	if path_dest_in_zone.size() >= 2 and str(path_dest_in_zone[-1]) == "C":
		print("PASS test_destination_inside_zone_still_reachable")
		pass_count += 1
	else:
		print("FAIL test_destination_inside_zone_still_reachable — path: ", path_dest_in_zone)
		fail_count += 1

	# TEST 4: empty combat_zones array (default/backward-compat) behaves like no filter.
	var result_empty_zones: Dictionary = pf.find_path("A", "E", {}, 1.0, "", {}, INF, INF, false, [])
	var path_empty_zones: Array = result_empty_zones.get("logical", [])
	var has_b_empty: bool = false
	for wp in path_empty_zones:
		if str(wp) == "B": has_b_empty = true
	if has_b_empty:
		print("PASS test_empty_zones_no_exclusion")
		pass_count += 1
	else:
		print("FAIL test_empty_zones_no_exclusion — path: ", path_empty_zones)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
```

Create `client/scenes/test/test_pathfinder_combat_zones.tscn`:

```
[gd_scene format=3]

[ext_resource type="Script" path="res://tests/test_pathfinder_combat_zones.gd" id="1"]

[node name="TestRoot" type="Node"]
script = ExtResource("1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `godot --headless --path client scenes/test/test_pathfinder_combat_zones.tscn`
Expected: FAIL (or a script error) — `find_path` does not yet accept an 8th positional
argument, so TEST 2/3/4 error out or `combat_zones` is silently dropped and TEST 2 fails
(path still routes through B).

- [ ] **Step 3: Implement combat-zone exclusion**

In `client/src/systems/military/pathfinder.gd`, add near the other route-avoidance
constants (alongside `ROAD_SEARCH_RADIUS_SQ` etc.):

```gdscript
## Radius (degrees) within which a division is considered part of an active combat's
## zone for pathfinding exclusion. Mirrors military_system.gd's ENGAGEMENT_RADIUS_KM
## (25.0 km) — the two constants must stay numerically equal (25.0 / 111.0 km-per-deg).
const ENGAGEMENT_RADIUS_DEG := 25.0 / 111.0
```

Replace the `find_path` signature and body (lines 451-505) with:

```gdscript
func find_path(from_id: String, to_id: String, movement_profile: Dictionary,
		road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {},
		goal_lng: float = INF,
		goal_lat: float = INF,
		_skip_synthetic_lifecycle: bool = false,
		combat_zones: Array[Dictionary] = []) -> Dictionary:
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
				road_cost_multiplier, player_nation_id, relations, _skip_synthetic_lifecycle,
				combat_zones)
			if not hpa_result.is_empty():
				return _finalize_path(hpa_result, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	if not _road_nodes.has(from_id) and not _road_nodes.has(actual_to_id):
		var offroad_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
		var has_road := false
		for wp_id in offroad_path:
			if _road_nodes.has(wp_id):
				has_road = true
				break
		if not offroad_path.is_empty() and not has_road:
			return _finalize_path(offroad_path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	if _road_nodes.has(from_id):
		var road_path: Array = _astar_impl(from_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations, combat_zones)
		if not road_path.is_empty():
			return _finalize_path(road_path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)
	else:
		var road_entry_id: String = _find_nearest_road_node(from_id)
		if road_entry_id != "":
			var seg1: Array = _astar_impl(from_id, road_entry_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
			var seg2: Array = _astar_impl(road_entry_id, actual_to_id, movement_profile, true, road_cost_multiplier, player_nation_id, relations, combat_zones)
			if not seg1.is_empty() and not seg2.is_empty():
				return _finalize_path(_join_segments(seg1, seg2), movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)

	var path: Array = _astar_impl(from_id, actual_to_id, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
	return _finalize_path(path, movement_profile, has_synthetic, to_id, _skip_synthetic_lifecycle)
```

Replace `find_nearest_reachable` (lines 508-521):

```gdscript
func find_nearest_reachable(from_id: String, near_lng: float, near_lat: float,
		movement_profile: Dictionary,
		player_nation_id: String = "",
		relations: Dictionary = {},
		combat_zones: Array[Dictionary] = []) -> String:
	var candidates: Array[String] = _find_nearest_ids(
		near_lng, near_lat, MAX_FALLBACK_CANDIDATES)
	for candidate_id: String in candidates:
		if candidate_id == from_id:
			continue
		var result: Dictionary = find_path(from_id, candidate_id, movement_profile, 1.0,
				player_nation_id, relations, INF, INF, false, combat_zones)
		if not result.get("logical", []).is_empty():
			return candidate_id
	return ""
```

Replace the `_astar_impl` signature and neighbor-expansion checks (lines 561-658). Add the
`combat_zones` parameter, precompute per-zone destination exemption once before the search
loop, and add the exclusion check next to the existing neutral check in both frontier
expansions:

```gdscript
func _astar_impl(from_id: String, to_id: String, movement_profile: Dictionary,
		road_only: bool, road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {},
		combat_zones: Array[Dictionary] = []) -> Array:
	if from_id == to_id:
		return [from_id]
	if not _nodes.has(from_id) or not _nodes.has(to_id):
		return []

	var from_node: Dictionary = _nodes[from_id]
	var to_node: Dictionary = _nodes[to_id]

	# Precomputed once per query: which zones the destination sits inside. Those zones
	# are exempt for this whole search — a deliberate destination inside an active
	# combat must still be reachable.
	var zone_exempt: Array[bool] = _combat_zone_exemptions(to_node, combat_zones)

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
				if v != to_id and (_is_neutral_for(v, player_nation_id, relations) or _is_in_hostile_combat_zone(v, combat_zones, zone_exempt)):
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
				if v != to_id and (_is_neutral_for(v, player_nation_id, relations) or _is_in_hostile_combat_zone(v, combat_zones, zone_exempt)):
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
```

Add the two new helper functions next to `_is_neutral_for` (after line 857):

```gdscript
## Precomputes, once per A* query, which combat zones the destination node sits
## inside. Parallel array to combat_zones — zone_exempt[i] is true if to_node lies
## within ENGAGEMENT_RADIUS_DEG of any participant position in combat_zones[i].
func _combat_zone_exemptions(to_node: Dictionary, combat_zones: Array[Dictionary]) -> Array[bool]:
	var dest_pos := Vector2(float(to_node.get("lng", 0.0)), float(to_node.get("lat", 0.0)))
	var radius_sq: float = ENGAGEMENT_RADIUS_DEG * ENGAGEMENT_RADIUS_DEG
	var exempt: Array[bool] = []
	for zone: Dictionary in combat_zones:
		var in_zone: bool = false
		for pos: Vector2 in zone.get("positions", []):
			if dest_pos.distance_squared_to(pos) <= radius_sq:
				in_zone = true
				break
		exempt.append(in_zone)
	return exempt


## True if node_id falls inside a combat zone that is NOT exempt (i.e. a zone the
## destination is not part of). zone_exempt is the parallel array produced by
## _combat_zone_exemptions for the current query's destination.
func _is_in_hostile_combat_zone(node_id: String, combat_zones: Array[Dictionary], zone_exempt: Array[bool]) -> bool:
	if combat_zones.is_empty():
		return false
	var node: Dictionary = _nodes.get(node_id, {})
	if node.is_empty():
		return false
	var node_pos := Vector2(float(node["lng"]), float(node["lat"]))
	var radius_sq: float = ENGAGEMENT_RADIUS_DEG * ENGAGEMENT_RADIUS_DEG
	for i: int in combat_zones.size():
		if zone_exempt[i]:
			continue
		for pos: Vector2 in combat_zones[i].get("positions", []):
			if node_pos.distance_squared_to(pos) <= radius_sq:
				return true
	return false
```

Finally, thread `combat_zones` through `_hpa_find_path` (lines 1016-1063) — it gains the
same trailing parameter and passes it to all three internal `_astar_impl` calls:

```gdscript
func _hpa_find_path(from_id: String, to_id: String, movement_profile: Dictionary,
		goal_lng: float, goal_lat: float,
		road_cost_multiplier: float = 1.0,
		player_nation_id: String = "",
		relations: Dictionary = {},
		_skip_synthetic_lifecycle: bool = false,
		combat_zones: Array[Dictionary] = []) -> Array:
	if not _skip_synthetic_lifecycle:
		_insert_synthetic_goal(goal_lng, goal_lat, player_nation_id, relations)

	var from_cluster: String = _cluster_of.get(from_id, "")
	var to_cluster: String = _cluster_of.get(SYNTHETIC_GOAL_ID, "")

	# If same cluster or clusters not found, fall back
	if from_cluster.is_empty() or to_cluster.is_empty() or from_cluster == to_cluster:
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
		if not _skip_synthetic_lifecycle:
			_remove_synthetic_goal()
		return _substitute_synthetic(flat, to_id)

	# Abstract search: Dijkstra over abstract graph
	var abstract_path: Array = _abstract_dijkstra(from_cluster, to_cluster)
	if abstract_path.is_empty():
		var flat: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
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

	var stitched: Array = _astar_impl(from_id, SYNTHETIC_GOAL_ID, movement_profile, false, road_cost_multiplier, player_nation_id, relations, combat_zones)
	if not _skip_synthetic_lifecycle:
		_remove_synthetic_goal()
	return _substitute_synthetic(stitched, to_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `godot --headless --path client scenes/test/test_pathfinder_combat_zones.tscn`
Expected: `=== Results: 4 passed, 0 failed ===`, exit code 0.

- [ ] **Step 5: Run existing pathfinder regression tests to confirm no breakage**

Run each of:
```
godot --headless --path client scenes/test/test_pathfinder_neutral.tscn
godot --headless --path client scenes/test/test_pathfinder_fallback.tscn
godot --headless --path client scenes/test/test_smooth_path.tscn
```
Expected: all still pass (combat_zones defaults to `[]`, so behavior is unchanged when
the new argument is omitted).

- [ ] **Step 6: Commit**

```bash
git add client/src/systems/military/pathfinder.gd client/tests/test_pathfinder_combat_zones.gd client/scenes/test/test_pathfinder_combat_zones.tscn
git commit -m "feat: exclude active combat zones from A* unless destination is inside them"
```

---

### Task 2: Server — broadcast `engagement_id` on combat events (`combat_system.ts`)

**Files:**
- Modify: `game-server/src/systems/combat_system.ts:566-571` (`COMBAT_STARTED` broadcast),
  `:1409-1444` (`_initiateRetreat`'s `COMBAT_ENDED` broadcasts)
- Test: `game-server/test/6m-combat-engagement-id.test.ts` (new)
- Modify: `game-server/test-lanes.json` (`tactical` lane's `tests` array)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `COMBAT_STARTED` payload gains `engagement_id: string`; `COMBAT_ENDED` payload
  gains `engagement_id: string`. Task 3 consumes these two fields.

- [ ] **Step 1: Write the failing test**

Create `game-server/test/6m-combat-engagement-id.test.ts`:

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function setStance(room: any, nationA: string, nationB: string, stance: string): void {
  const relation = room.state.relations.get(`${nationA}|${nationB}`)
    ?? room.state.relations.get(`${nationB}|${nationA}`);
  assert.ok(relation, `missing relation ${nationA}|${nationB}`);
  relation.stance = stance;
}

describe("lane:tactical | 6m — Combat engagement_id broadcasts", function () {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig, getTestPort());
  });

  after(async () => {
    setCombatGraceTicksForTesting(10);
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("COMBAT_STARTED and COMBAT_ENDED both carry a non-empty engagement_id", async () => {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-attacker";
    const divB = "div-defender";
    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france", position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    await (room as any).startGame();
    setStance(room, "germany", "france", "war");
    await room.waitForNextPatch();

    const startedMsg: any = await client.waitForMessage("COMBAT_STARTED", 60_000);
    assert.ok(typeof startedMsg.engagement_id === "string" && startedMsg.engagement_id.length > 0,
      "COMBAT_STARTED must carry a non-empty engagement_id");

    client.send("RETREAT_DIVISION", { division_id: divA });
    const endedMsg: any = await client.waitForMessage("COMBAT_ENDED", 60_000);
    assert.ok(typeof endedMsg.engagement_id === "string" && endedMsg.engagement_id.length > 0,
      "COMBAT_ENDED must carry a non-empty engagement_id");
    assert.strictEqual(endedMsg.engagement_id, startedMsg.engagement_id,
      "COMBAT_ENDED's engagement_id must match the pair's COMBAT_STARTED engagement_id");
  });
});
```

(If `RETREAT_DIVISION` is not the actual client message name for a manual retreat order,
grep `game-server/src/rooms/GameRoom.ts` for the message handler that calls
`combatSystem.initiateRetreat` and use that message type/shape instead — the important
assertion is only that both messages carry a matching non-empty `engagement_id`.)

Add the test to the `tactical` lane in `game-server/test-lanes.json`, in the `"tests"`
array alongside the existing `test/6b-round-system.test.ts` entry:

```json
"test/6m-combat-engagement-id.test.ts",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && NODE_ENV=test npx mocha test/6m-combat-engagement-id.test.ts`
Expected: FAIL — `startedMsg.engagement_id` is `undefined`.

- [ ] **Step 3: Add engagement_id to COMBAT_STARTED**

In `game-server/src/systems/combat_system.ts`, replace lines 566-571:

```typescript
            broadcast("COMBAT_STARTED", {
              division_a:        a.division_id,
              division_b:        b.division_id,
              is_meeting_battle: pair.is_meeting,
              attacker_id:       pair.attacker_id,
              engagement_id:     pair.engagement_id,
            });
```

- [ ] **Step 4: Add engagement_id to COMBAT_ENDED**

The `_initiateRetreat` method deletes each `ActivePair` before broadcasting
`COMBAT_ENDED`, so the pair's `engagement_id` must be captured before deletion. Replace
lines 1409-1444:

```typescript
    // Collect opponent IDs (and their engagement_id) before deleting pairs, then reset after
    const opponentIds: string[] = [];
    const pairsToRemove: string[] = [];
    const engagementIdByOpponent = new Map<string, string>();
    for (const [key, pair] of this.activePairs) {
      const [idA, idB] = key.split("|");
      if (idA === div.division_id || idB === div.division_id) {
        pairsToRemove.push(key);
        const opponentId = idA === div.division_id ? idB : idA;
        opponentIds.push(opponentId);
        engagementIdByOpponent.set(opponentId, pair.engagement_id);
      }
    }
    for (const key of pairsToRemove) this.activePairs.delete(key);

    // Reset each opponent that is no longer in any remaining active pair.
    // Don't reset opponents that are already suppressed — they will retreat on their own
    // on the next tick (clearing their engaged_with would break their retreat flow).
    for (const opponentId of opponentIds) {
      const stillEngaged = Array.from(this.activePairs.keys())
        .some(k => k.startsWith(opponentId + "|") || k.endsWith("|" + opponentId));
      if (stillEngaged) continue;

      const opponent = state.divisions.get(opponentId);
      if (!opponent) continue;
      const engagementId = engagementIdByOpponent.get(opponentId) ?? "";
      if (opponent.combat_state === "engaged") {
        opponent.combat_state  = "idle";
        opponent.attacker_role = "";
        opponent.engaged_with.splice(0, opponent.engaged_with.length);
        opponent.reposition_order.splice(0, opponent.reposition_order.length);
        changed.add(opponentId);
        broadcast("COMBAT_ENDED", { winner_id: opponentId, retreated_id: div.division_id, engagement_id: engagementId });
      } else if (opponent.combat_state === "suppressed") {
        // Suppressed opponent will retreat naturally on the next tick.
        // Broadcast COMBAT_ENDED now so the client knows, but don't reset
        // the opponent — its engaged_with is needed for retreat direction.
        opponent.reposition_order.splice(0, opponent.reposition_order.length);
        broadcast("COMBAT_ENDED", { winner_id: opponentId, retreated_id: div.division_id, engagement_id: engagementId });
      }
      // Opponents in "suppressed" state will retreat on their own next tick;
      // don't interfere — their retreat direction depends on engaged_with.
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd game-server && NODE_ENV=test npx mocha test/6m-combat-engagement-id.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full tactical lane to confirm no regressions**

Run: `cd game-server && npm run test:tactical`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add game-server/src/systems/combat_system.ts game-server/test/6m-combat-engagement-id.test.ts game-server/test-lanes.json
git commit -m "feat: broadcast engagement_id on COMBAT_STARTED and COMBAT_ENDED"
```

---

### Task 3: Client — track active engagement pairs (`game_state.gd`, `session_manager.gd`)

**Files:**
- Modify: `client/src/core/game_state.gd:224-231` (`_apply_combat_started`), plus new
  state field near line 30 (alongside `stacks`)
- Modify: `client/src/systems/session/session_manager.gd:56-64` (`COMBAT_ENDED` handler)
- Test: `client/tests/test_game_state_combat_engagement_pairs.gd` (new)
- Test scene: `client/scenes/test/test_game_state_combat_engagement_pairs.tscn` (new)

**Interfaces:**
- Consumes: `engagement_id` field on `COMBAT_STARTED`/`COMBAT_ENDED` payloads (Task 2).
- Produces: `GameState.active_engagement_pairs: Dictionary` —
  `engagement_id -> {division_a: String, division_b: String}`. Task 4 consumes this field.

- [ ] **Step 1: Write the failing test**

Create `client/tests/test_game_state_combat_engagement_pairs.gd`:

```gdscript
extends Node

func _ready() -> void:
	print("=== test_game_state_combat_engagement_pairs ===")
	var pass_count: int = 0
	var fail_count: int = 0

	var gs = load("res://src/core/game_state.gd").new()
	gs.divisions = {
		"div_a": {"nation_id": "germany"},
		"div_b": {"nation_id": "france"},
	}

	# TEST 1: COMBAT_STARTED stores the pair keyed by engagement_id.
	gs._apply_combat_started({
		"division_a": "div_a",
		"division_b": "div_b",
		"is_meeting_battle": false,
		"engagement_id": "div_a_vs_div_b_123",
	})
	if gs.active_engagement_pairs.get("div_a_vs_div_b_123", {}).get("division_a", "") == "div_a" \
			and gs.active_engagement_pairs["div_a_vs_div_b_123"]["division_b"] == "div_b":
		print("PASS test_combat_started_stores_pair")
		pass_count += 1
	else:
		print("FAIL test_combat_started_stores_pair — active_engagement_pairs: ", gs.active_engagement_pairs)
		fail_count += 1

	# TEST 2: erasing by engagement_id (the operation session_manager.gd performs on
	# COMBAT_ENDED) removes exactly that entry.
	gs.active_engagement_pairs.erase("div_a_vs_div_b_123")
	if not gs.active_engagement_pairs.has("div_a_vs_div_b_123"):
		print("PASS test_engagement_erased_by_id")
		pass_count += 1
	else:
		print("FAIL test_engagement_erased_by_id — still present: ", gs.active_engagement_pairs)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
```

Create `client/scenes/test/test_game_state_combat_engagement_pairs.tscn`:

```
[gd_scene format=3]

[ext_resource type="Script" path="res://tests/test_game_state_combat_engagement_pairs.gd" id="1"]

[node name="TestRoot" type="Node"]
script = ExtResource("1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `godot --headless --path client scenes/test/test_game_state_combat_engagement_pairs.tscn`
Expected: FAIL — `GameState` (a fresh instance here) has no `active_engagement_pairs`
property yet.

- [ ] **Step 3: Add the field and update `_apply_combat_started`**

In `client/src/core/game_state.gd`, add near the existing `stacks` field (around line 30):

```gdscript
# stacks: { stack_id → Array[division_id] ordered by stack_position }
var stacks: Dictionary = {}
# active_engagement_pairs: { engagement_id → { division_a: String, division_b: String } }
# Populated on COMBAT_STARTED, erased on COMBAT_ENDED. Used by military_system.gd to
# build combat-avoidance zones for pathfinding — see docs/PATHFINDING.md.
var active_engagement_pairs: Dictionary = {}
```

Replace `_apply_combat_started` (lines 224-231):

```gdscript
## Called by SessionManager when server sends COMBAT_STARTED.
## Stores is_meeting_battle on the involved divisions for icon rendering, and records
## the pair under its engagement_id for pathfinding's combat-avoidance zones.
func _apply_combat_started(data: Dictionary) -> void:
	var is_meeting: bool = data.get("is_meeting_battle", false)
	var division_a: String = data.get("division_a", "")
	var division_b: String = data.get("division_b", "")
	for div_id: String in [division_a, division_b]:
		if divisions.has(div_id):
			divisions[div_id]["is_meeting_battle"] = is_meeting
			EventBus.division_updated.emit(div_id)
	var engagement_id: String = data.get("engagement_id", "")
	if not engagement_id.is_empty():
		active_engagement_pairs[engagement_id] = {"division_a": division_a, "division_b": division_b}
```

- [ ] **Step 4: Update the COMBAT_ENDED handler to erase the entry**

In `client/src/systems/session/session_manager.gd`, replace lines 56-64:

```gdscript
		"COMBAT_ENDED":
			var winner_id: String = data.get("winner_id", "")
			var retreated_id: String = data.get("retreated_id", "")
			var engagement_id: String = data.get("engagement_id", "")
			if not engagement_id.is_empty():
				GameState.active_engagement_pairs.erase(engagement_id)
			for div_id: String in [winner_id, retreated_id]:
				if GameState.divisions.has(div_id):
					GameState.divisions[div_id]["is_meeting_battle"] = false
			if not winner_id.is_empty():
				EventBus.division_updated.emit(winner_id)
			EventBus.combat_resolved.emit("", {"winner_id": winner_id, "retreated_id": retreated_id})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `godot --headless --path client scenes/test/test_game_state_combat_engagement_pairs.tscn`
Expected: `=== Results: 2 passed, 0 failed ===`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/core/game_state.gd client/src/systems/session/session_manager.gd client/tests/test_game_state_combat_engagement_pairs.gd client/scenes/test/test_game_state_combat_engagement_pairs.tscn
git commit -m "feat: track active engagement pairs by engagement_id in GameState"
```

---

### Task 4: Military system — build combat zones and wire into move orders (`military_system.gd`)

**Files:**
- Modify: `client/src/systems/military/military_system.gd` — new helper functions
  `_build_combat_zones` and `_uf_find`; wiring into `_submit_direct_move_order` (lines
  535-574), `_handle_move_click` (lines 613-672), `_handle_group_move_click` (lines
  680-719), `_refresh_chain_start` (lines 808-835), `_recompute_chain` (lines 942-974).
  **Not** wired into `_submit_reposition_order` (line 1085) — that function computes a
  path deliberately constrained to stay within an active combat's engagement boundary
  (reposition-during-combat), so combat-zone exclusion does not apply there.
- Test: `client/tests/test_military_system_combat_zones.gd` (new)
- Test scene: `client/scenes/test/test_military_system_combat_zones.tscn` (new)

**Interfaces:**
- Consumes: `GameState.active_engagement_pairs` (Task 3), `pathfinder.gd`'s
  `combat_zones` parameter on `find_path`/`find_nearest_reachable` (Task 1).
- Produces: `_build_combat_zones(active_engagement_pairs: Dictionary, divisions: Dictionary)
  -> Array[Dictionary]`, shape `[{"division_ids": Array[String], "positions":
  Array[Vector2]}, ...]` — consumed only within this file.

- [ ] **Step 1: Write the failing test**

Create `client/tests/test_military_system_combat_zones.gd`:

```gdscript
extends Node

func _ready() -> void:
	print("=== test_military_system_combat_zones ===")
	var pass_count: int = 0
	var fail_count: int = 0

	var ms = load("res://src/systems/military/military_system.gd").new()

	var divisions: Dictionary = {
		"div_a": {"position_lng": 0.0, "position_lat": 0.0},
		"div_b": {"position_lng": 0.1, "position_lat": 0.0},
		"div_c": {"position_lng": 5.0, "position_lat": 5.0},
		"div_d": {"position_lng": 5.1, "position_lat": 5.0},
	}

	# Two separate pairwise engagements that share no division — must produce two
	# separate zones.
	var pairs_separate: Dictionary = {
		"eng_1": {"division_a": "div_a", "division_b": "div_b"},
		"eng_2": {"division_a": "div_c", "division_b": "div_d"},
	}
	var zones_separate: Array[Dictionary] = ms._build_combat_zones(pairs_separate, divisions)
	if zones_separate.size() == 2:
		print("PASS test_disjoint_pairs_form_two_zones")
		pass_count += 1
	else:
		print("FAIL test_disjoint_pairs_form_two_zones — zones: ", zones_separate)
		fail_count += 1

	# Two attackers vs one defender (div_b shared between eng_1 and eng_3) must merge
	# into a single zone containing all three divisions.
	var pairs_shared: Dictionary = {
		"eng_1": {"division_a": "div_a", "division_b": "div_b"},
		"eng_3": {"division_a": "div_e", "division_b": "div_b"},
	}
	var divisions_with_e: Dictionary = divisions.duplicate()
	divisions_with_e["div_e"] = {"position_lng": 0.2, "position_lat": 0.0}
	var zones_shared: Array[Dictionary] = ms._build_combat_zones(pairs_shared, divisions_with_e)
	if zones_shared.size() == 1 and zones_shared[0]["division_ids"].size() == 3:
		print("PASS test_shared_division_merges_pairs_into_one_zone")
		pass_count += 1
	else:
		print("FAIL test_shared_division_merges_pairs_into_one_zone — zones: ", zones_shared)
		fail_count += 1

	# Empty input produces no zones.
	var zones_empty: Array[Dictionary] = ms._build_combat_zones({}, divisions)
	if zones_empty.is_empty():
		print("PASS test_no_active_pairs_no_zones")
		pass_count += 1
	else:
		print("FAIL test_no_active_pairs_no_zones — zones: ", zones_empty)
		fail_count += 1

	print("=== Results: %d passed, %d failed ===" % [pass_count, fail_count])
	if fail_count > 0:
		get_tree().quit(1)
	else:
		get_tree().quit(0)
```

Create `client/scenes/test/test_military_system_combat_zones.tscn`:

```
[gd_scene format=3]

[ext_resource type="Script" path="res://src/systems/military/military_system.gd" id="1"]

[node name="TestRoot" type="Node"]
script = ExtResource("1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `godot --headless --path client scenes/test/test_military_system_combat_zones.tscn`
Expected: FAIL — `_build_combat_zones` does not exist yet.

- [ ] **Step 3: Implement `_build_combat_zones` and its union-find helper**

In `client/src/systems/military/military_system.gd`, add these two functions (near the
other pure geometry helpers such as `_get_group_destination_offset`):

```gdscript
## Groups active engagement pairs into combat clusters (any two pairs sharing a
## division_id merge into one cluster — handles e.g. two attackers vs one defender as
## a single zone) and resolves each participant's current position.
## Rebuilt fresh on every pathfinding call rather than cached — cheap (bounded by the
## number of active engagements, not graph size) and avoids drift from GameState.
## active_engagement_pairs: engagement_id -> {division_a: String, division_b: String}
## divisions: division_id -> DivisionState dict (must have position_lng/position_lat)
## Returns: [{division_ids: Array[String], positions: Array[Vector2]}, ...]
func _build_combat_zones(active_engagement_pairs: Dictionary, divisions: Dictionary) -> Array[Dictionary]:
	var parent: Dictionary = {}  # division_id -> division_id (union-find parent pointer)

	for eng_id: String in active_engagement_pairs:
		var pair: Dictionary = active_engagement_pairs[eng_id]
		var a: String = str(pair.get("division_a", ""))
		var b: String = str(pair.get("division_b", ""))
		if a.is_empty() or b.is_empty():
			continue
		if not parent.has(a):
			parent[a] = a
		if not parent.has(b):
			parent[b] = b
		var root_a: String = _uf_find(parent, a)
		var root_b: String = _uf_find(parent, b)
		if root_a != root_b:
			parent[root_a] = root_b

	var clusters: Dictionary = {}  # root -> Array[String]
	for div_id: String in parent:
		var root: String = _uf_find(parent, div_id)
		if not clusters.has(root):
			clusters[root] = []
		clusters[root].append(div_id)

	var zones: Array[Dictionary] = []
	for root: String in clusters:
		var division_ids: Array = clusters[root]
		var positions: Array[Vector2] = []
		for div_id: String in division_ids:
			var data: Dictionary = divisions.get(div_id, {})
			if data.is_empty():
				continue
			positions.append(Vector2(float(data.get("position_lng", 0.0)), float(data.get("position_lat", 0.0))))
		if not positions.is_empty():
			zones.append({"division_ids": division_ids, "positions": positions})
	return zones


## Iterative union-find "find" with path compression.
func _uf_find(parent: Dictionary, x: String) -> String:
	var root: String = x
	while parent[root] != root:
		root = parent[root]
	var cur: String = x
	while parent[cur] != root:
		var next_id: String = parent[cur]
		parent[cur] = root
		cur = next_id
	return root
```

- [ ] **Step 4: Run test to verify it passes**

Run: `godot --headless --path client scenes/test/test_military_system_combat_zones.tscn`
Expected: `=== Results: 3 passed, 0 failed ===`, exit code 0.

- [ ] **Step 5: Wire `_build_combat_zones` into the move-order call sites**

Each call site snapshots `_build_combat_zones(GameState.active_engagement_pairs,
GameState.divisions)` on the **main thread**, before any background `Thread.start()` —
the same rule the existing `relations_snapshot := GameState.relations.duplicate()` line
already follows (see docs/PATHFINDING.md "Thread Safety" section), since GDScript
Dictionaries are not safe to read from GameState concurrently from a background thread.

In `_submit_direct_move_order` (around line 551), add the snapshot next to the existing
ones and thread it through both `find_path`/`find_nearest_reachable` calls inside the
thread closure:

```gdscript
	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_gen += 1
	var gen := _path_gen
	_path_pending = true
	_pathfinder._insert_synthetic_goal(goal_lng_snapshot, goal_lat_snapshot, my_nation, relations_snapshot)
	_path_thread = Thread.new()
	_path_thread.start(func() -> void:
		var path_result: Dictionary = _pathfinder.find_path(
			start_id, "_synthetic_goal", movement_profile, 1.0,
			my_nation, relations_snapshot,
			INF, INF, true, combat_zones_snapshot)
		var path: Array = path_result.get("logical", [])
		if path.is_empty():
			var fallback_id: String = _pathfinder.find_nearest_reachable(
				start_id, goal_lng_snapshot, goal_lat_snapshot, movement_profile,
				my_nation, relations_snapshot, combat_zones_snapshot)
			if not fallback_id.is_empty():
				path_result = _pathfinder.find_path(start_id, fallback_id, movement_profile, 1.0,
					my_nation, relations_snapshot,
					INF, INF, true, combat_zones_snapshot)
				path = path_result.get("logical", [])
		call_deferred("_on_direct_move_ready", path, division_id_snapshot, goal_lng_snapshot, goal_lat_snapshot, gen)
	)
```

In `_handle_move_click` (around line 658), add the snapshot and thread it into the single
`find_path` call:

```gdscript
	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_gen += 1
	var gen := _path_gen
	_path_pending = true
	_path_thread = Thread.new()
	var division_id_snapshot := _selected_division_id
	_path_thread.start(func() -> void:
		var effective_mult := 1.0
		if shift_held and waypoint_index > 0 and road_mult > 1.0:
			if not _pathfinder.road_crosses_segment(start_id, goal_id):
				effective_mult = road_mult
		var seg_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, effective_mult, my_nation, relations_snapshot, INF, INF, false, combat_zones_snapshot)
		call_deferred("_on_segment_ready", seg_result.get("logical", []), goal_id, shift_held, division_id_snapshot, gen)
	)
```

In `_handle_group_move_click` (runs on the main thread, no `Thread` involved — lines
691-719), snapshot once per call and pass it to both `find_path` calls per division:

```gdscript
	var submitted_any_order: bool = false
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	for index: int in moving_division_ids.size():
		var division_id: String = moving_division_ids[index]
		var current_lng_lat: Vector2 = _get_division_lng_lat(division_id)
		var destination_lng_lat: Vector2 = Vector2(target_lng, target_lat) \
				+ _get_group_destination_offset(index, moving_division_ids.size())
		var start_id: String = _pathfinder.find_nearest(current_lng_lat.x, current_lng_lat.y)
		var goal_id: String = _pathfinder.find_nearest(destination_lng_lat.x, destination_lng_lat.y)
		var movement_profile: Dictionary = _get_movement_profile(division_id)
		var path_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
		var path: Array = path_result.get("logical", [])
		if path.is_empty():
			goal_id = _pathfinder.find_nearest(target_lng, target_lat)
			path_result = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
			path = path_result.get("logical", [])
			if path.is_empty():
				push_warning("[MilitarySystem] No group path found for %s" % division_id)
				continue
```

In `_refresh_chain_start` (around line 828), add the snapshot and pass it through:

```gdscript
	var my_nation: String = GameState.get_my_nation_id()
	var relations_snapshot: Dictionary = GameState.relations.duplicate()
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	_path_pending = true
	_path_thread = Thread.new()
	_path_thread.start(func() -> void:
		var seg_result: Dictionary = _pathfinder.find_path(start_id, goal_id, movement_profile, 1.0, my_nation, relations_snapshot, INF, INF, false, combat_zones_snapshot)
		call_deferred("_on_chain_refresh_ready", seg_result.get("logical", []), milestones_snapshot, div_id_snapshot)
	)
```

In `_recompute_chain` (around line 959, runs on the main thread), snapshot once before the
per-milestone loop and pass it to each segment's `find_path` call:

```gdscript
	_pending_chain.clear()
	var current_start := start_id
	var combat_zones_snapshot: Array[Dictionary] = _build_combat_zones(GameState.active_engagement_pairs, GameState.divisions)
	for milestone_id: String in _pending_milestones:
		var seg_result: Dictionary = _pathfinder.find_path(current_start, milestone_id, movement_profile, 1.0, GameState.get_my_nation_id(), GameState.relations, INF, INF, false, combat_zones_snapshot)
		var seg: Array = seg_result.get("logical", [])
		if seg.is_empty():
			break
		var skip_first: bool = false
		if not _pending_chain.is_empty() and seg.size() > 0:
			skip_first = str(seg[0]) == _pending_chain.back()
		for i: int in seg.size():
			if i == 0 and skip_first:
				continue
			_pending_chain.append(seg[i])
		current_start = milestone_id
```

Per-segment application of `combat_zones_snapshot` here is what satisfies the "should not
trigger for a waypoint that legitimately lands in a combat zone" requirement: each
segment's own `milestone_id` is checked as `to_id` against every zone inside
`_astar_impl`, so a segment whose destination is inside a zone is naturally exempt for
that zone (Task 1's `_combat_zone_exemptions`), while a later segment continuing past
that milestone toward a destination outside the zone is not.

- [ ] **Step 6: Manual verification (headless scene run cannot exercise full click flow)**

This wiring touches click-handling code that depends on `MapLoader`/scene setup not
present in a headless unit-test scene. Verify manually per AGENTS.md's UI guidance:
1. Launch the game client, start a session with combat between two AI or player
   divisions.
2. Issue a move order for a third division whose destination is on the far side of that
   combat from its current position — confirm the HUD route line detours around the
   combat instead of crossing it.
3. Issue a shift-click chain where one waypoint lands inside that combat's radius —
   confirm that segment routes directly to the waypoint (no detour), while a further
   waypoint past it, outside the radius, is not routed back through the combat.
Report the exact manual steps performed (or still required) rather than claiming this
step is automatically verified.

- [ ] **Step 7: Commit**

```bash
git add client/src/systems/military/military_system.gd client/tests/test_military_system_combat_zones.gd client/scenes/test/test_military_system_combat_zones.tscn
git commit -m "feat: route move orders around active combat zones"
```

---

### Task 5: Documentation (`docs/PATHFINDING.md`)

**Files:**
- Modify: `docs/PATHFINDING.md` — add a new section documenting the mechanism.

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add a "Combat-Zone Exclusion" section**

Insert a new section in `docs/PATHFINDING.md`, following the existing style of "Neutral
Territory Exclusion" (it is the closest existing precedent — same hard-exclusion
mechanism, same per-neighbor-expansion check), placed immediately after that section:

```markdown
---

## Combat-Zone Exclusion

Active combats exclude their combined engagement radius from A* routing, unless the
segment's own destination waypoint lies inside that same radius — a unit will detour
around an ongoing battle it has nothing to do with, but can still be deliberately routed
into one.

### Zone construction (`military_system.gd:_build_combat_zones`)

`GameState.active_engagement_pairs` (`engagement_id -> {division_a, division_b}`,
populated from the server's `COMBAT_STARTED`/`COMBAT_ENDED` broadcasts) is unioned via a
simple union-find: any two pairs sharing a division_id merge into one cluster, so a
"two attackers vs one defender" fight — which is two separate `ActivePair`s
server-side — becomes a single combat zone client-side. Each cluster's zone is the set
of its participants' current positions; the exclusion radius itself reuses
`ENGAGEMENT_RADIUS_KM = 25.0` (military_system.gd) / `ENGAGEMENT_RADIUS_DEG = 25.0/111.0`
(pathfinder.gd) — the same constant already used for the engagement-circle UI overlay.

Zones are rebuilt fresh on every pathfinding call rather than cached, since the cost is
bounded by the number of active engagements (not graph size), and this avoids any risk of
the cached zones drifting out of sync with `GameState`.

### Exclusion in `_astar_impl`

Mirrors neutral-territory exclusion exactly: both forward and backward neighbor
expansions add `_is_in_hostile_combat_zone(v, combat_zones, zone_exempt)` alongside the
existing `_is_neutral_for` check, and the segment's own `to_id` is always exempt from
exclusion (a node cannot be excluded by being its own destination). `zone_exempt` — which
zones the destination sits inside — is precomputed once per query
(`_combat_zone_exemptions`), not recomputed per node, so the added cost per node visited
is `O(zones)` distance checks, comparable to the existing neutral-territory lookup.

This is a **hard exclusion**, not a cost multiplier (unlike shift-move road avoidance):
if a combat zone fully blocks the only route to a destination, `find_nearest_reachable`'s
existing fallback (see "Route-to-Closest-Reachable-Waypoint Fallback" above) already
handles it by routing to the nearest reachable node short of the zone — no new fallback
logic was needed.

### Multi-waypoint chains

Each segment of a shift-move chain (`_recompute_chain`) computes its own combat zones
snapshot and calls `find_path` with its own milestone as `to_id`. A segment whose
destination waypoint sits inside a combat zone is exempt for that zone; a later segment
continuing past that waypoint toward a destination outside the zone is not — it will
detour around re-entering it. `_submit_reposition_order` (the reposition-during-combat
path used while a division is already engaged) does not apply this exclusion — that
function's whole purpose is computing a path constrained to stay within an active
combat's boundary.
```

- [ ] **Step 2: Verify doc checker passes**

Run: `python3 scripts/check-docs.py`
Expected: no new errors related to `docs/PATHFINDING.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/PATHFINDING.md
git commit -m "docs: document combat-zone exclusion pathfinding heuristic"
```
