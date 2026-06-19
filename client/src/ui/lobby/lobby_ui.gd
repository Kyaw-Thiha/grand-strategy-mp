extends Control

const DEFAULT_MAP_ID: String = "western_europe_6"
const MIN_PLAYERS_TO_START: int = 1
const SELECT_NATION_TEXT: String = "Select a nation"

@onready var _code_label: Label          = %CodeLabel
@onready var _nations_list: VBoxContainer = %NationsList
@onready var _players_list: VBoxContainer = %PlayersList
@onready var _ready_btn: Button          = %ReadyBtn
@onready var _start_btn: Button          = %StartBtn
@onready var _status_label: Label        = %StatusLabel
@onready var _selected_flag_panel: PanelContainer = %SelectedFlagPanel
@onready var _selected_flag_texture: TextureRect = %SelectedFlagTexture
@onready var _selected_flag_label: Label = %SelectedFlagLabel

var _is_ready: bool = false
var _loaded_map_id: String = ""
var _nation_definitions: Array[Dictionary] = []
var _nation_by_id: Dictionary = {}


func _ready() -> void:
	_code_label.text = "Code: " + LobbySystem.get_join_code()
	_start_btn.visible = GameState.is_host()

	EventBus.phase_changed.connect(_on_phase_changed)
	EventBus.lobby_state_updated.connect(_refresh_ui)

	# Populate initial state if already received
	_refresh_ui()


func _on_ready_btn_pressed() -> void:
	_is_ready = !_is_ready
	_ready_btn.text = "Cancel Ready" if _is_ready else "Ready Up"
	LobbySystem.set_ready(_is_ready)


func _on_start_btn_pressed() -> void:
	LobbySystem.start_game()


func _on_nation_btn_pressed(nation_id: String) -> void:
	var my_nation: String = GameState.get_my_nation_id()
	if my_nation == nation_id:
		LobbySystem.deselect_nation()
	else:
		LobbySystem.select_nation(nation_id)


func _on_phase_changed(phase: String) -> void:
	if phase == "running":
		_status_label.text = "Starting game..."


func _refresh_ui() -> void:
	_ensure_nation_definitions_loaded()
	var has_nation := GameState.get_my_nation_id() != ""
	if not has_nation and _is_ready:
		_is_ready = false
		_ready_btn.text = "Ready Up"
	_ready_btn.disabled = not has_nation
	_rebuild_nations()
	_rebuild_players()
	_refresh_selected_flag()
	_start_btn.visible = GameState.is_host()
	_start_btn.disabled = not _can_start_game()


func _rebuild_nations() -> void:
	for child: Node in _nations_list.get_children():
		child.queue_free()

	var nations: Dictionary = GameState.nations
	for definition: Dictionary in _nation_definitions:
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty():
			continue
		var slot: Dictionary = nations.get(nation_id, {})
		var player_id: String = slot.get("player_id", "")
		var is_ready: bool = slot.get("is_ready", false)

		var btn: Button = Button.new()
		var label: String = _get_nation_name(nation_id)
		if player_id != "":
			label += "  [taken]"
			if is_ready:
				label += " ✓"
		btn.text = label
		btn.disabled = player_id != "" and player_id != AuthManager.user_id
		btn.pressed.connect(_on_nation_btn_pressed.bind(nation_id))
		_nations_list.add_child(btn)


func _rebuild_players() -> void:
	for child: Node in _players_list.get_children():
		child.queue_free()

	var nations: Dictionary = GameState.nations
	for nation_id: String in nations:
		var slot: Dictionary = nations[nation_id]
		var player_id: String = slot.get("player_id", "")
		if player_id == "":
			continue

		var is_ready: bool = slot.get("is_ready", false)
		var lbl: Label = Label.new()
		var display_name: String = _get_nation_name(nation_id)
		lbl.text = player_id.left(8) + "  [" + display_name + "]" + ("  ✓" if is_ready else "")
		_players_list.add_child(lbl)


## Returns whether the server-confirmed lobby state is ready to start.
## Parameters: none.
## Returns: true when this client is host and at least MIN_PLAYERS_TO_START occupied nation slots are ready.
func _can_start_game() -> bool:
	if not GameState.is_host():
		return false

	var ready_count: int = 0
	for nation_id: String in GameState.nations:
		var slot: Dictionary = GameState.nations[nation_id]
		var player_id: String = slot.get("player_id", "")
		var is_ready: bool = slot.get("is_ready", false)
		if player_id != "" and is_ready:
			ready_count += 1

	return ready_count >= MIN_PLAYERS_TO_START


## Ensures lobby nation metadata matches the current server map id.
## Parameters: none.
## Returns: nothing.
func _ensure_nation_definitions_loaded() -> void:
	var map_id: String = GameState.map_id
	if map_id.is_empty():
		map_id = DEFAULT_MAP_ID
	if map_id == _loaded_map_id and not _nation_definitions.is_empty():
		return
	_load_nation_definitions(map_id)


## Loads map-scoped nation metadata from assets/data/<map_id>/nations.json.
## Parameters:
## - map_id: map data folder id to read.
## Returns: nothing.
func _load_nation_definitions(map_id: String) -> void:
	_loaded_map_id = map_id
	_nation_definitions.clear()
	_nation_by_id.clear()

	var path: String = "res://assets/data/%s/nations.json" % map_id
	if not FileAccess.file_exists(path):
		push_warning("LobbyUI: missing nation metadata: " + path)
		return

	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		push_warning("LobbyUI: invalid nation metadata: " + path)
		return

	var raw_definitions: Array = parsed
	for raw_definition: Variant in raw_definitions:
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		var nation_id: String = definition.get("id", "")
		if nation_id.is_empty():
			continue
		_nation_definitions.append(definition)
		_nation_by_id[nation_id] = definition


## Refreshes the bottom-left flag preview from the confirmed GameState nation selection.
## Parameters: none.
## Returns: nothing.
func _refresh_selected_flag() -> void:
	var nation_id: String = GameState.get_my_nation_id()
	if nation_id.is_empty():
		_selected_flag_texture.texture = null
		_selected_flag_label.text = SELECT_NATION_TEXT
		_selected_flag_panel.modulate = Color(1, 1, 1, 0.72)
		return

	var definition: Dictionary = _nation_by_id.get(nation_id, {})
	var flag_path: String = definition.get("flag_path", "")
	var flag_texture: Texture2D = null
	if not flag_path.is_empty() and ResourceLoader.exists(flag_path):
		flag_texture = load(flag_path) as Texture2D

	_selected_flag_texture.texture = flag_texture
	_selected_flag_label.text = _get_nation_name(nation_id)
	_selected_flag_panel.modulate = Color.WHITE


## Returns the display name for a nation id using loaded metadata with id fallback.
## Parameters:
## - nation_id: nation identifier from server state.
## Returns: human-readable nation name.
func _get_nation_name(nation_id: String) -> String:
	var definition: Dictionary = _nation_by_id.get(nation_id, {})
	return definition.get("name", nation_id)
