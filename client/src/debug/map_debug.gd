extends Node
## Standalone debug scene — wires MapLoader, MapRenderer, MapInteraction,
## and CameraSystem without any auth, server, or SessionManager dependency.
## Launch by setting scenes/debug/map_debug.tscn as main scene, or via
## Scene → Run Specific Scene in the Godot editor.

const MAP_ID := "western_europe_6"
const FrontlineOverlay := preload("res://src/systems/frontline/frontline_overlay.gd")

@onready var _map_loader: Node       = $MapLoader
@onready var _map_renderer: Node     = $MapRenderer
@onready var _map_interaction: Node  = $MapInteraction
@onready var _camera_system: Node    = $CameraSystem
@onready var _camera: Camera2D       = $Camera2D
@onready var _military_system: Node  = $MilitarySystem
@onready var _division_layer: Node2D = $DivisionLayer

@onready var _hud_name:   Label = $HUD/Panel/VBox/ProvinceName
@onready var _hud_nation: Label = $HUD/Panel/VBox/NationId
@onready var _hud_elev:   Label = $HUD/Panel/VBox/Elevation
@onready var _hud_cover:  Label = $HUD/Panel/VBox/Cover
@onready var _hud_vp:     Label = $HUD/Panel/VBox/VP
@onready var _hud_count:  Label = $HUD/Panel/VBox/ProvinceCount


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.20, 0.50, 0.80))
	_camera_system.setup(_camera, _map_loader)
	_camera_system.zoom_changed.connect(_map_renderer.on_zoom_changed)
	_map_loader.map_loaded.connect(_on_map_loaded)
	_map_loader.map_load_failed.connect(_on_map_load_failed)
	_map_loader.load_map(MAP_ID)


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
	_map_interaction.province_hovered.connect(_on_province_hovered)
	_map_interaction.province_clicked.connect(_on_province_clicked)
	_map_interaction.province_clicked.connect(func(_id: String) -> void: _military_system.deselect())
	EventBus.division_selected.connect(func(_id: String) -> void:
		_map_interaction.deselect()
		_map_renderer.clear_highlights()
	)

	# Frontline overlay: additive colored circles around each unit, above terrain, below icons
	var frontline_overlay: Node2D = FrontlineOverlay.new()
	_division_layer.add_child(frontline_overlay)
	frontline_overlay.setup(_map_loader)

	# Wire MilitarySystem — inject stub divisions for visual testing
	_military_system.setup(_map_loader, _division_layer)
	frontline_overlay.set_icons_ref(_military_system.get_icons())
	_inject_debug_divisions()

	_hud_count.text = "Provinces: %d" % province_count
	_clear_info_panel()

	$HUD/Panel/VBox/OverlayButtons/BtnPolitical.pressed.connect(_on_overlay_political)
	$HUD/Panel/VBox/OverlayButtons/BtnElevation.pressed.connect(_on_overlay_elevation)
	$HUD/Panel/VBox/OverlayButtons/BtnCover.pressed.connect(_on_overlay_cover)


func _on_map_load_failed(error: String) -> void:
	push_error("MapDebug: map load failed — %s" % error)


func _on_province_hovered(province_id: String) -> void:
	var pdata: Dictionary = _map_loader.get_province_data(province_id)
	_hud_name.text   = pdata.get("name", "")
	_hud_nation.text = "Nation: %s" % pdata.get("nation_id", "")
	_hud_elev.text   = "Elevation: %s" % pdata.get("terrain_elevation", "")
	_hud_cover.text  = "Cover: %s" % pdata.get("terrain_cover", "")
	var vp: int      = pdata.get("vp_value", 0)
	_hud_vp.text     = "VP: %d" % vp


func _on_province_clicked(province_id: String) -> void:
	if _map_renderer.is_highlighted(province_id):
		_map_renderer.clear_highlights()
	else:
		_map_renderer.clear_highlights()
		_map_renderer.highlight_province(province_id)


func _on_overlay_political() -> void:
	_map_renderer.set_overlay_mode("political")


func _on_overlay_elevation() -> void:
	_map_renderer.set_overlay_mode("elevation")


func _on_overlay_cover() -> void:
	_map_renderer.set_overlay_mode("cover")


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


func _clear_info_panel() -> void:
	_hud_name.text   = "Hover a province"
	_hud_nation.text = ""
	_hud_elev.text   = ""
	_hud_cover.text  = ""
	_hud_vp.text     = ""


# ── thin data source wrapper ──────────────────────────────────────────────────

class _DebugDataSource:
	var _loader: Node

	func _init(loader: Node) -> void:
		_loader = loader

	func get_province(province_id: String) -> Dictionary:
		return _loader.get_province_data(province_id)
