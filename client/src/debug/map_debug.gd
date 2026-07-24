extends "res://src/game/map_scene.gd"
## Standalone debug scene that uses the shared map composition with fixtures.
## Launch by setting scenes/debug/map_debug.tscn as main scene, or via
## Scene → Run Specific Scene in the Godot editor.

const MAP_ID := "western_europe_6"
#const FrontlineOverlay := preload("res://src/systems/frontline/frontline_overlay.gd")  # deferred


func _get_map_id() -> String:
	return MAP_ID


func _create_map_data_source() -> Object:
	return _DebugProvinceDataSource.new(_map_loader)


func _prepare_map_state() -> void:
	if GameState.divisions.is_empty():
		_inject_debug_divisions()
	if GameState.air_wings.is_empty():
		_inject_debug_air_wings()


func _returns_to_lobby_on_map_failure() -> bool:
	return false



## Inject one division per playable nation at their capital positions for visual testing.
## Mirrors the starting_positions.ts data so the debug scene matches the server spawn.
func _inject_debug_divisions() -> void:
	var sample_divisions := [
		{ "division_id": "germany_div_06",       "nation_id": "germany",        "position_lng": 13.385771, "position_lat": 52.483566, "hp": 100.0, "suppression": 0.0, "combat_state": "idle", "supply_status": "normal", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
		{ "division_id": "france_div_03",         "nation_id": "france",         "position_lng": 2.335453,  "position_lat": 48.896725, "hp": 100.0, "suppression": 0.0, "combat_state": "idle", "supply_status": "normal", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
		{ "division_id": "united_kingdom_div_08", "nation_id": "united_kingdom", "position_lng": -0.209940, "position_lat": 51.538663, "hp": 100.0, "suppression": 0.0, "combat_state": "idle", "supply_status": "normal", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
		{ "division_id": "italy_div_03",          "nation_id": "italy",          "position_lng": 12.443317, "position_lat": 41.979254, "hp": 80.0,  "suppression": 20.0, "combat_state": "idle", "supply_status": "out_of_supply", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
		{ "division_id": "spain_div_06",          "nation_id": "spain",          "position_lng": -3.675196, "position_lat": 40.373968, "hp": 60.0,  "suppression": 40.0, "combat_state": "idle", "supply_status": "normal", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
		{ "division_id": "algeria_div_05",        "nation_id": "algeria",        "position_lng": 3.080039,  "position_lat": 36.747008, "hp": 100.0, "suppression": 0.0,  "combat_state": "idle", "supply_status": "normal", "engagement_radius": 50.0, "observation_radius": 100.0, "move_order": [] },
	]

	# Directly populate GameState.divisions and emit signals (bypasses server)
	for div_data: Dictionary in sample_divisions:
		var div_id: String = div_data["division_id"]
		GameState.divisions[div_id] = div_data.duplicate()
		EventBus.division_added.emit(div_id)

	# Establish a debug player nation so VisionSystem can compute visibility.
	# VisionSystem.on_map_loaded() is called after this and picks up the state on first refresh.
	if AuthManager.user_id.is_empty():
		AuthManager.user_id = "debug_player"
	GameState.nations["germany"] = {"player_id": "debug_player", "is_ready": true}


func _inject_debug_air_wings() -> void:
	var aircraft_types: Array[String] = [
		"fighter", "tactical_bomber", "cas_plane", "strategic_bomber", "recon_plane"
	]
	var readiness_values: Array[float] = [1.0, 0.8, 0.6, 0.35, 0.15]
	var capitals: Array[Dictionary] = [
		{ "nation_id": "germany",        "lng": 13.385771,  "lat": 52.483566 },
		{ "nation_id": "france",         "lng": 2.335453,   "lat": 48.896725 },
		{ "nation_id": "united_kingdom", "lng": -0.209940,  "lat": 51.538663 },
		{ "nation_id": "italy",          "lng": 12.443317,  "lat": 41.979254 },
		{ "nation_id": "spain",          "lng": -3.675196,  "lat": 40.373968 },
		{ "nation_id": "algeria",        "lng": 3.080039,   "lat": 36.747008 },
	]
	for cap: Dictionary in capitals:
		var nation_id: String = cap["nation_id"]
		for i: int in range(5):
			var wing_id: String = "%s_wing_%02d" % [nation_id, i + 1]
			var wing_data: Dictionary = {
				"wing_id":                  wing_id,
				"nation_id":                nation_id,
				"aircraft_type":            aircraft_types[i],
				"count":                    10,
				"combat_readiness":         readiness_values[i],
				"position_lng":             float(cap["lng"]) + i * 0.18,
				"position_lat":             float(cap["lat"]) + i * 0.06,
				"heading_deg":              0.0,
				"lifecycle_state":          "transit",
				"mission":                  "interception",
				"target_id":                "",
				"home_airbase_province_id": "",
				"weapon_ready":             true,
			}
			GameState.air_wings[wing_id] = wing_data.duplicate()
			EventBus.air_wing_added.emit(wing_id)


# ── thin data source wrapper ──────────────────────────────────────────────────

class _DebugProvinceDataSource:
	var _loader: Node

	func _init(loader: Node) -> void:
		_loader = loader

	func get_province(province_id: String) -> Dictionary:
		return _loader.get_province_data(province_id)
