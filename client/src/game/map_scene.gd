class_name MapScene
extends Node
## Shared map-scene composition for live matches and map diagnostics.
## Loads a selected map, wires display/input systems, and keeps debug fixtures
## out of the production scene through overridable hooks.

const VisionRenderLayers := preload("res://src/systems/map/vision_render_layers.gd")

var _nation_definitions_by_id: Dictionary = {}

@onready var _map_loader: Node = $MapLoader
@onready var _map_renderer: Node = $MapRenderer
@onready var _map_interaction: Node = $MapInteraction
@onready var _camera_system: Node = $CameraSystem
@onready var _camera: Camera2D = $Camera2D
@onready var _military_system: Node = $MilitarySystem
@onready var _division_layer: Node2D = $DivisionLayer
@onready var _vision_system: Node = $VisionSystem
@onready var _air_wing_system: Node = $AirWingSystem
@onready var _air_wing_layer: Node2D = $AirWingLayer
@onready var _pause_menu: PauseMenu = $PauseMenu
@onready var _game_hud: GameHUD = $GameHUD

var _naval_contact_marker_system: Node = null

var _chat_input_focused: bool = false


func _ready() -> void:
	VisionRenderLayers.configure_world_marker_layer(_division_layer)
	VisionRenderLayers.configure_world_marker_layer(_air_wing_layer)
	var naval_marker_layer: Node2D = get_node_or_null("NavalContactMarkerSystem") as Node2D
	if naval_marker_layer != null:
		VisionRenderLayers.configure_world_marker_layer(naval_marker_layer)
	_pause_menu.set_restore_clear_color(RenderingServer.get_default_clear_color())
	RenderingServer.set_default_clear_color(Color(0.0, 0.0, 0.0))
	_camera_system.setup(_camera, _map_loader)
	_camera_system.zoom_changed.connect(_map_renderer.on_zoom_changed)
	if not EventBus.chat_input_focus_changed.is_connected(_on_chat_input_focus_changed):
		EventBus.chat_input_focus_changed.connect(_on_chat_input_focus_changed)
	_map_loader.map_loaded.connect(_on_map_loaded)
	_map_loader.map_load_failed.connect(_on_map_load_failed)
	_naval_contact_marker_system = get_node_or_null("NavalContactMarkerSystem")

	var map_id: String = _get_map_id()
	if map_id.is_empty():
		_handle_missing_map_id()
		return
	_map_loader.load_map(map_id)


func _unhandled_input(event: InputEvent) -> void:
	if _chat_input_focused and event is InputEventKey:
		get_viewport().set_input_as_handled()
		return

	if _pause_menu.visible:
		if event is InputEventKey:
			var pause_key: InputEventKey = event
			if pause_key.pressed and not pause_key.echo and pause_key.physical_keycode == KEY_ESCAPE:
				_pause_menu.hide_menu()
		get_viewport().set_input_as_handled()
		return

	if event is InputEventKey:
		var key: InputEventKey = event
		if key.pressed and not key.echo and key.physical_keycode == KEY_ESCAPE:
			_pause_menu.show_menu()
			get_viewport().set_input_as_handled()
			return
		_military_system.handle_input(event)
		return

	if event is InputEventMouseButton or event is InputEventMouseMotion:
		var event_position: Vector2
		if event is InputEventMouseButton:
			event_position = (event as InputEventMouseButton).position
		else:
			event_position = (event as InputEventMouseMotion).position
		var world_pos: Vector2 = get_viewport().get_canvas_transform().affine_inverse() * event_position
		var hovered_province_id: String = _map_interaction.get_hovered_province_id()
		if _air_wing_system.handle_mouse_input(event, world_pos, hovered_province_id):
			get_viewport().set_input_as_handled()
			return
		if _military_system.handle_mouse_input(event, world_pos):
			get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if _pause_menu.visible or _chat_input_focused:
		return
	if event is InputEventKey:
		_military_system.handle_input(event)


## Returns the selected map identifier for this composition.
## Live scenes use the map announced by the game server; debug scenes override it.
func _get_map_id() -> String:
	return GameState.map_id


## Provides province display data to MapRenderer.
## Static map fields come from MapLoader; current ownership comes from GameState.
func _create_map_data_source() -> Object:
	return _RuntimeProvinceDataSource.new(_map_loader)


## Allows a diagnostic subclass to seed isolated state before display systems hydrate.
func _prepare_map_state() -> void:
	pass


## Returns true when map-loading failures should leave the current match flow.
func _returns_to_lobby_on_map_failure() -> bool:
	return true


func _on_chat_input_focus_changed(focused: bool) -> void:
	_chat_input_focused = focused


func _on_map_loaded(province_count: int) -> void:
	_prepare_map_state()
	_map_renderer.setup(_map_loader, _create_map_data_source())
	_map_renderer.on_map_loaded(province_count)

	_map_interaction.setup(_map_loader)
	_map_interaction.on_map_loaded(province_count)
	_map_interaction.province_clicked.connect(_on_province_clicked)
	_map_interaction.province_right_clicked.connect(_on_province_right_clicked)
	EventBus.division_selected.connect(func(_id: String) -> void:
		_map_interaction.deselect()
		_map_renderer.clear_highlights()
	)

	_military_system.setup(_map_loader, _division_layer, _vision_system)
	_air_wing_system.setup(_map_loader, _air_wing_layer, _military_system)
	_vision_system.setup(_map_loader)
	if _naval_contact_marker_system:
		_naval_contact_marker_system.setup($MapLoader)
	_vision_system.on_map_loaded(province_count)
	_game_hud.setup_game_context(
		_map_loader, _military_system, _map_interaction, _air_wing_system, _map_renderer
	)

	EventBus.map_mode_changed.connect(func(mode: String) -> void:
		_map_renderer.set_overlay_mode(mode)
	)
	EventBus.settings_requested.connect(_pause_menu.show_menu)
	EventBus.move_mode_requested.connect(func(division_id: String) -> void:
		_military_system.enter_move_mode(division_id)
	)
	_center_camera_on_selected_nation()


func _on_map_load_failed(error: String) -> void:
	push_error("Map scene load failed — %s" % error)
	if _returns_to_lobby_on_map_failure():
		EventBus.notification_requested.emit(error, "error")
		SceneManager.call_deferred("goto_lobby")


func _handle_missing_map_id() -> void:
	const MESSAGE: String = "Unable to open match: the server did not provide a map."
	push_error(MESSAGE)
	EventBus.notification_requested.emit(MESSAGE, "error")
	SceneManager.call_deferred("goto_lobby")


func _center_camera_on_selected_nation() -> void:
	var nation_id: String = GameState.get_my_nation_id()
	if nation_id.is_empty():
		return

	_ensure_nation_definitions_loaded()
	var nation_definition: Dictionary = _nation_definitions_by_id.get(nation_id, {})
	var capital_province_id: String = nation_definition.get("capital_province_id", "")
	if capital_province_id.is_empty():
		push_warning("Map scene: selected nation has no capital province: %s" % nation_id)
		return

	_camera_system.pan_to_province(capital_province_id)

	var nation_name: String = nation_definition.get("name", nation_id)
	var flag_path: String = nation_definition.get("flag_path", "")
	if not flag_path.is_empty():
		_game_hud.set_nation(nation_name, load(flag_path))
	else:
		_game_hud.set_nation(nation_name, null)


func _ensure_nation_definitions_loaded() -> void:
	if not _nation_definitions_by_id.is_empty():
		return

	var path: String = "res://assets/data/%s/nations.json" % _get_map_id()
	if not FileAccess.file_exists(path):
		push_warning("Map scene: missing nation metadata: " + path)
		return

	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		push_warning("Map scene: invalid nation metadata: " + path)
		return

	for raw_definition: Variant in parsed:
		if not raw_definition is Dictionary:
			continue
		var nation_definition: Dictionary = raw_definition
		var nation_id: String = nation_definition.get("id", "")
		if not nation_id.is_empty():
			_nation_definitions_by_id[nation_id] = nation_definition


func _on_province_clicked(province_id: String) -> void:
	_military_system.deselect()
	if _map_renderer.is_highlighted(province_id):
		_map_renderer.clear_highlights()
	else:
		_map_renderer.clear_highlights()
		_map_renderer.highlight_province(province_id)
		EventBus.province_selected.emit(province_id)


func _on_province_right_clicked(province_id: String) -> void:
	if _air_wing_system == null or _map_loader == null:
		return

	var world_pos: Vector2 = _map_loader.get_province_focus_position(province_id)
	if world_pos == Vector2.INF:
		var province_node: Node2D = _map_loader.get_province_node(province_id)
		if province_node == null:
			return
		world_pos = province_node.position

	var right_click: InputEventMouseButton = InputEventMouseButton.new()
	right_click.button_index = MOUSE_BUTTON_RIGHT
	right_click.pressed = true
	_air_wing_system.handle_mouse_input(right_click, world_pos, province_id)


class _RuntimeProvinceDataSource:
	extends RefCounted

	var _loader: Node

	func _init(loader: Node) -> void:
		_loader = loader

	func get_province(province_id: String) -> Dictionary:
		var province_data: Dictionary = _loader.get_province_data(province_id).duplicate(true)
		var runtime_data: Dictionary = GameState.get_province(province_id)
		var owner_id: String = runtime_data.get("owner_id", runtime_data.get("nation_id", ""))
		if not owner_id.is_empty():
			province_data["nation_id"] = owner_id
		return province_data
