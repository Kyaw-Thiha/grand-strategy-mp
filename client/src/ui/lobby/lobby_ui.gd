extends Control

const NATION_LABELS: Dictionary = {
	"united_kingdom": "United Kingdom",
	"france":         "France",
	"germany":        "Germany",
	"spain":          "Spain",
	"algeria":        "Algeria",
	"italy":          "Italy",
}

@onready var _code_label: Label          = %CodeLabel
@onready var _nations_list: VBoxContainer = %NationsList
@onready var _players_list: VBoxContainer = %PlayersList
@onready var _ready_btn: Button          = %ReadyBtn
@onready var _start_btn: Button          = %StartBtn
@onready var _status_label: Label        = %StatusLabel

var _is_ready: bool = false


func _ready() -> void:
	_code_label.text = "Code: " + LobbySystem.get_join_code()
	_start_btn.visible = GameState.is_host()

	EventBus.phase_changed.connect(_on_phase_changed)
	NetManager.server_event_received.connect(_on_server_event)

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


func _on_server_event(type: String, _data: Dictionary) -> void:
	if type == "LOBBY_STATE_UPDATE":
		_refresh_ui()


func _on_phase_changed(phase: String) -> void:
	if phase == "running":
		_status_label.text = "Starting game..."


func _refresh_ui() -> void:
	_rebuild_nations()
	_rebuild_players()
	_start_btn.visible = GameState.is_host()


func _rebuild_nations() -> void:
	for child: Node in _nations_list.get_children():
		child.queue_free()

	var nations: Dictionary = GameState.nations
	for nation_id: String in NATION_LABELS:
		var slot: Dictionary = nations.get(nation_id, {})
		var player_id: String = slot.get("player_id", "")
		var is_ready: bool = slot.get("is_ready", false)

		var btn: Button = Button.new()
		var label: String = NATION_LABELS[nation_id]
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
		var display_name: String = NATION_LABELS.get(nation_id, nation_id)
		lbl.text = player_id.left(8) + "  [" + display_name + "]" + ("  ✓" if is_ready else "")
		_players_list.add_child(lbl)
