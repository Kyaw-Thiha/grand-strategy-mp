extends Node
## Targeted Hold eligibility and remappable-input test for MilitarySystem.

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
	var selected_divisions: Array[String] = ["moving"]
	military.set("_selected_division_ids", selected_divisions)
	military.set("_selected_division_id", "moving")

	var rejected_commands: Array[String] = []
	CommandQueue.command_rejected.connect(func(type: String, _reason: String) -> void:
		rejected_commands.append(type)
	)

	var original_hold_events: Array[InputEvent] = InputMap.action_get_events("unit_hold")
	InputMap.action_erase_events("unit_hold")
	var remapped_hold := InputEventKey.new()
	remapped_hold.physical_keycode = KEY_K
	InputMap.action_add_event("unit_hold", remapped_hold)

	var hold_key := InputEventKey.new()
	hold_key.pressed = true
	hold_key.physical_keycode = KEY_K
	military.handle_input(hold_key)
	_check(rejected_commands == ["HOLD"], "remapped unit_hold submits eligible movement through CommandQueue")

	GameState.divisions["moving"]["move_order"] = []
	military.handle_input(hold_key)
	_check(rejected_commands == ["HOLD"], "remapped unit_hold ignores a stopped division")

	GameState.divisions["moving"]["move_order"] = ["wp"]
	GameState.divisions["moving"]["combat_state"] = "engaged"
	military.handle_input(hold_key)
	_check(rejected_commands == ["HOLD"], "remapped unit_hold ignores combat movement")

	selected_divisions.assign(["foreign"])
	military.set("_selected_division_ids", selected_divisions)
	military.call("_hold_selected_divisions")
	_check(rejected_commands == ["HOLD"], "Hold ignores selected foreign divisions")

	military.call("_hold_division", "moving")
	_check(rejected_commands == ["HOLD"], "specific Hold intent rejects an unselected division context")

	selected_divisions.assign(["moving"])
	military.set("_selected_division_ids", selected_divisions)
	military.set("_selected_division_id", "moving")
	GameState.divisions["moving"]["combat_state"] = "idle"
	EventBus.division_hold_requested.emit("moving")
	_check(rejected_commands == ["HOLD", "HOLD"], "specific Hold EventBus intent reaches the shared command path")

	InputMap.action_erase_events("unit_hold")
	for original_event: InputEvent in original_hold_events:
		InputMap.action_add_event("unit_hold", original_event)
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
		"moving": {
			"nation_id": "germany",
			"combat_state": "idle",
			"move_order": ["wp"],
			"final_position_lng": -999.0,
		},
		"foreign": {
			"nation_id": "france",
			"combat_state": "idle",
			"move_order": ["wp"],
			"final_position_lng": -999.0,
		},
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
