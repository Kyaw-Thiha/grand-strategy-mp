extends Node
## Targeted Retreat eligibility and remappable-input test for MilitarySystem.

const MilitarySystemScript = preload("res://src/systems/military/military_system.gd")

class MockMapLoader:
	extends Node

	func get_waypoint_graph() -> Dictionary:
		return {}


var _pass_count: int = 0
var _fail_count: int = 0


func _ready() -> void:
	_setup_game_state()
	var military: Node = MilitarySystemScript.new()
	add_child(military)
	var map_loader := MockMapLoader.new()
	var icon_layer := Node2D.new()
	add_child(map_loader)
	add_child(icon_layer)
	var divisions: Dictionary = GameState.divisions
	GameState.divisions = {}
	military.setup(map_loader, icon_layer)
	GameState.divisions = divisions
	var selected_divisions: Array[String] = ["engaged"]
	military.set("_selected_division_ids", selected_divisions)
	military.set("_selected_division_id", "engaged")

	_check(
		MilitarySystemScript.can_retreat_division_data(GameState.divisions["engaged"], true),
		"Retreat eligibility accepts engaged owned divisions"
	)
	_check(
		MilitarySystemScript.can_retreat_division_data(GameState.divisions["suppressed"], true),
		"Retreat eligibility accepts suppressed owned divisions"
	)
	for ineligible_state: String in ["idle", "retreating", "destroyed"]:
		_check(
			not MilitarySystemScript.can_retreat_division_data(
				{"combat_state": ineligible_state},
				true
			),
			"Retreat eligibility rejects %s divisions" % ineligible_state
		)
	_check(
		not MilitarySystemScript.can_retreat_division_data(GameState.divisions["engaged"], false),
		"Retreat eligibility rejects foreign divisions"
	)

	var rejected_commands: Array[String] = []
	CommandQueue.command_rejected.connect(func(type: String, _reason: String) -> void:
		rejected_commands.append(type)
	)
	var original_retreat_events: Array[InputEvent] = InputMap.action_get_events("unit_retreat")
	InputMap.action_erase_events("unit_retreat")
	var remapped_retreat := InputEventKey.new()
	remapped_retreat.physical_keycode = KEY_K
	InputMap.action_add_event("unit_retreat", remapped_retreat)

	var retreat_key := InputEventKey.new()
	retreat_key.pressed = true
	retreat_key.physical_keycode = KEY_K
	military.handle_input(retreat_key)
	_check(rejected_commands == ["RETREAT"], "remapped unit_retreat submits eligible combat withdrawal")

	GameState.divisions["engaged"]["combat_state"] = "idle"
	military.handle_input(retreat_key)
	_check(rejected_commands == ["RETREAT"], "remapped unit_retreat ignores an idle division")

	selected_divisions.assign(["suppressed"])
	military.set("_selected_division_id", "suppressed")
	EventBus.division_retreat_requested.emit("suppressed")
	_check(
		rejected_commands == ["RETREAT", "RETREAT"],
		"specific Retreat EventBus intent reaches the shared command path"
	)

	EventBus.division_retreat_requested.emit("engaged")
	_check(
		rejected_commands == ["RETREAT", "RETREAT"],
		"specific Retreat intent rejects an unselected division context"
	)
	selected_divisions.assign(["foreign"])
	military.set("_selected_division_id", "foreign")
	military.call("_retreat_selected_divisions")
	_check(rejected_commands == ["RETREAT", "RETREAT"], "Retreat ignores selected foreign divisions")

	GameState.divisions["engaged"]["combat_state"] = "engaged"
	selected_divisions.assign(["engaged", "suppressed", "idle", "foreign"])
	military.call("_retreat_selected_divisions")
	_check(
		rejected_commands == ["RETREAT", "RETREAT", "RETREAT", "RETREAT"],
		"group Retreat submits only selected owned engaged and suppressed divisions"
	)

	InputMap.action_erase_events("unit_retreat")
	for original_event: InputEvent in original_retreat_events:
		InputMap.action_add_event("unit_retreat", original_event)
	military.queue_free()
	_report()


func _setup_game_state() -> void:
	AuthManager.user_id = "user-a"
	GameState.players = {"session-a": {"user_id": "user-a"}}
	GameState.nations = {
		"germany": {"player_id": "user-a"},
		"france": {"player_id": "user-b"},
	}
	GameState.divisions = {
		"engaged": {"nation_id": "germany", "combat_state": "engaged"},
		"suppressed": {"nation_id": "germany", "combat_state": "suppressed"},
		"idle": {"nation_id": "germany", "combat_state": "idle"},
		"retreating": {"nation_id": "germany", "combat_state": "retreating"},
		"destroyed": {"nation_id": "germany", "combat_state": "destroyed"},
		"foreign": {"nation_id": "france", "combat_state": "engaged"},
	}


func _check(condition: bool, label: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		print("FAIL: ", label)


func _report() -> void:
	if _fail_count == 0:
		print("ALL PASS (%d checks)" % _pass_count)
		get_tree().quit(0)
	else:
		print("FAILED %d / %d checks" % [_fail_count, _pass_count + _fail_count])
		get_tree().quit(1)
