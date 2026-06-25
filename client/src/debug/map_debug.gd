extends Node
## Standalone debug scene — wires MapLoader, MapRenderer, MapInteraction,
## and CameraSystem without any auth, server, or SessionManager dependency.
## Launch by setting scenes/debug/map_debug.tscn as main scene, or via
## Scene → Run Specific Scene in the Godot editor.

const MAP_ID := "western_europe_6"
#const FrontlineOverlay := preload("res://src/systems/frontline/frontline_overlay.gd")  # deferred


var _nation_definitions_by_id: Dictionary = {}

@onready var _map_loader: Node       = $MapLoader
@onready var _map_renderer: Node     = $MapRenderer
@onready var _map_interaction: Node  = $MapInteraction
@onready var _camera_system: Node    = $CameraSystem
@onready var _camera: Camera2D       = $Camera2D
@onready var _military_system: Node  = $MilitarySystem
@onready var _division_layer: Node2D = $DivisionLayer
@onready var _vision_system: Node    = $VisionSystem
@onready var _pause_menu = $PauseMenu
@onready var _game_hud   = $GameHUD


func _ready() -> void:
	_pause_menu.set_restore_clear_color(RenderingServer.get_default_clear_color())
	RenderingServer.set_default_clear_color(Color(0.0, 0.0, 0.0))
	_camera_system.setup(_camera, _map_loader)
	_camera_system.zoom_changed.connect(_map_renderer.on_zoom_changed)
	_map_loader.map_loaded.connect(_on_map_loaded)
	_map_loader.map_load_failed.connect(_on_map_load_failed)
	_map_loader.load_map(MAP_ID) 


func _unhandled_input(event: InputEvent) -> void:
	if _pause_menu.visible:
		if event is InputEventKey:
			var key: InputEventKey = event
			if key.pressed and not key.echo and key.physical_keycode == KEY_ESCAPE:
				_pause_menu.hide_menu()
		get_viewport().set_input_as_handled()
		return

	if event is InputEventKey:
		var key: InputEventKey = event
		if key.pressed and not key.echo and key.physical_keycode == KEY_ESCAPE:
			_pause_menu.show_menu()
			get_viewport().set_input_as_handled()
			return

	# Forward key events to military system (M, H, X hotkeys)
	if event is InputEventKey:
		_military_system.handle_input(event)
		return

	if not event is InputEventMouseButton:
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return

	var world_pos: Vector2 = get_viewport().get_canvas_transform().affine_inverse() * mb.position

	if mb.button_index == MOUSE_BUTTON_LEFT:
		if _military_system.try_click_at_world(world_pos, mb.shift_pressed):
			get_viewport().set_input_as_handled()
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		if _military_system.try_right_click_at_world(world_pos):
			get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	# Forward key events to military system (M, H, X, Escape hotkeys)
	if event is InputEventKey:
		_military_system.handle_input(event)
		return

	if not event is InputEventMouseButton:
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return

	var world_pos: Vector2 = get_viewport().get_canvas_transform().affine_inverse() * mb.position

	if mb.button_index == MOUSE_BUTTON_LEFT:
		if _military_system.try_click_at_world(world_pos, mb.shift_pressed):
			get_viewport().set_input_as_handled()
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		if _military_system.try_right_click_at_world(world_pos):
			get_viewport().set_input_as_handled()


func _on_map_loaded(province_count: int) -> void:
	_map_renderer.setup(_map_loader, _DebugDataSource.new(_map_loader))
	_map_renderer.on_map_loaded(province_count)

	_map_interaction.setup(_map_loader)
	_map_interaction.on_map_loaded(province_count)
	_map_interaction.province_clicked.connect(_on_province_clicked)
	_map_interaction.province_clicked.connect(func(_id: String) -> void: _military_system.deselect())
	EventBus.division_selected.connect(func(_id: String) -> void:
		_map_interaction.deselect()
		_map_renderer.clear_highlights()
	)

	# Frontline overlay deferred — see frontline_overlay.gd
	#var frontline_overlay: Node2D = FrontlineOverlay.new()
	#_division_layer.add_child(frontline_overlay)
	#frontline_overlay.setup(_map_loader)

	# Wire MilitarySystem — inject stub divisions for visual testing
	_military_system.setup(_map_loader, _division_layer)
	#frontline_overlay.set_icons_ref(_military_system.get_icons())
	if GameState.divisions.is_empty():
		_inject_debug_divisions()

	# Setup VisionSystem after debug state is injected so first refresh sees correct data
	_vision_system.setup(_map_loader)
	_vision_system.on_map_loaded(province_count)

	EventBus.map_mode_changed.connect(func(mode: String) -> void:
		_map_renderer.set_overlay_mode(mode)
	)
	EventBus.settings_requested.connect(_pause_menu.show_menu)
	_center_camera_on_selected_nation()


func _on_map_load_failed(error: String) -> void:
	push_error("MapDebug: map load failed — %s" % error)


## Centers the camera on the selected player's nation capital after the map loads.
## Parameters: none.
## Returns: nothing.
func _center_camera_on_selected_nation() -> void:
	var nation_id: String = GameState.get_my_nation_id()
	if nation_id.is_empty():
		return

	_ensure_nation_definitions_loaded()
	var nation_definition: Dictionary = _nation_definitions_by_id.get(nation_id, {})
	var capital_province_id: String = nation_definition.get("capital_province_id", "")
	if capital_province_id.is_empty():
		push_warning("MapDebug: selected nation has no capital province: %s" % nation_id)
		return

	_camera_system.pan_to_province(capital_province_id)

	var nation_name: String = nation_definition.get("name", nation_id)
	var flag_path: String   = nation_definition.get("flag_path", "")
	if not flag_path.is_empty():
		_game_hud.set_nation(nation_name, load(flag_path))
	else:
		_game_hud.set_nation(nation_name, null)


## Loads nation metadata for the active debug map if it has not been loaded yet.
## Parameters: none.
## Returns: nothing.
func _ensure_nation_definitions_loaded() -> void:
	if not _nation_definitions_by_id.is_empty():
		return

	var path: String = "res://assets/data/%s/nations.json" % MAP_ID
	if not FileAccess.file_exists(path):
		push_warning("MapDebug: missing nation metadata: " + path)
		return

	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		push_warning("MapDebug: invalid nation metadata: " + path)
		return

	var raw_definitions: Array = parsed
	for raw_definition: Variant in raw_definitions:
		if not raw_definition is Dictionary:
			continue
		var nation_definition: Dictionary = raw_definition
		var nation_id: String = nation_definition.get("id", "")
		if nation_id.is_empty():
			continue
		_nation_definitions_by_id[nation_id] = nation_definition


func _on_province_clicked(province_id: String) -> void:
	if _map_renderer.is_highlighted(province_id):
		_map_renderer.clear_highlights()
	else:
		_map_renderer.clear_highlights()
		_map_renderer.highlight_province(province_id)



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


# ── thin data source wrapper ──────────────────────────────────────────────────

class _DebugDataSource:
	var _loader: Node

	func _init(loader: Node) -> void:
		_loader = loader

	func get_province(province_id: String) -> Dictionary:
		return _loader.get_province_data(province_id)
