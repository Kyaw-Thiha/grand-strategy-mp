extends Node
## Listens to server events from NetManager and owns the high-level session phase.
## Bridges GAME_STARTED / GAME_ENDED server events to SceneManager transitions.

signal session_started(nation_assignments: Dictionary, game_speed: int)
signal session_ended(winner_id: String, reason: String)
signal speed_changed(new_speed: int)


func _ready() -> void:
	NetManager.server_event_received.connect(_on_server_event)


func _on_server_event(type: String, data: Dictionary) -> void:
	match type:
		"GAME_STARTED":
			var assignments: Dictionary = data.get("nation_assignments", {})
			var speed: int = data.get("game_speed", 1)
			session_started.emit(assignments, speed)
			if SceneManager.is_game_loading_pending():
				SceneManager.confirm_game_start()
			else:
				SceneManager.goto_game()

		"ERROR":
			var message: String = data.get("message", "Server error")
			if SceneManager.should_loading_wait_for_game_start():
				SceneManager.cancel_game_start_loading(message)
			else:
				EventBus.notification_requested.emit(message, "error")

		"GAME_ENDED":
			var winner: String = data.get("winner_id", "")
			var reason: String = data.get("reason", "")
			session_ended.emit(winner, reason)
			SceneManager.goto_postgame()

		"SPEED_CHANGED":
			var new_speed: int = data.get("game_speed", 1)
			speed_changed.emit(new_speed)

		"DIVISIONS_SPAWNED":
			GameState._apply_divisions_spawned(data)

		"DIVISION_UPDATES":
			GameState._apply_division_updates(data)

		"COMBAT_STARTED":
			GameState._apply_combat_started(data)
			EventBus.combat_started.emit(
				data.get("division_a", ""),
				data.get("division_b", ""),
				data.get("is_meeting_battle", false)
			)

		"COMBAT_ENDED":
			var winner_id: String = data.get("winner_id", "")
			var retreated_id: String = data.get("retreated_id", "")
			for div_id: String in [winner_id, retreated_id]:
				if GameState.divisions.has(div_id):
					GameState.divisions[div_id]["is_meeting_battle"] = false
			if not winner_id.is_empty():
				EventBus.division_updated.emit(winner_id)
			EventBus.combat_resolved.emit("", {"winner_id": winner_id, "retreated_id": retreated_id})

		"ROUND_RESOLVED":
			var eng_id: String   = data.get("engagement_id", "")
			var rn: int          = data.get("round_number", 0)
			var lp: String       = data.get("lethality_phase", "")
			var atk_delta: Array = data.get("attacker_grid_delta", [])
			var def_delta: Array = data.get("defender_grid_delta", [])
			var fb: Array        = data.get("formation_bonuses_active", [])
			var tur: int          = data.get("ticks_until_next_round", 20)
			EventBus.round_resolved.emit(eng_id, rn, lp, atk_delta, def_delta, fb, tur)

		"COMBAT_RESULT":
			pass  # reserved for future tactical panel use

		"UNIT_DESTROYED":
			GameState._apply_unit_destroyed(data)

		"PROVINCE_CAPTURED":
			GameState._apply_province_captured(data)

		"STACK_FORMED":
			GameState._apply_stack_formed(data)

		"STACK_ROTATION":
			GameState._apply_stack_rotation(data)

		"STACK_DISSOLVED":
			GameState._apply_stack_dissolved(data)

		"FLANK_ATTACK":
			EventBus.flank_attack.emit(data.get("attacker_a", ""), data.get("defender_id", ""))

		"REAR_ATTACK":
			EventBus.rear_attack.emit(data.get("attacker_a", ""), data.get("defender_id", ""))

		"RELATIONS_UPDATED":
			GameState._apply_relations_updated(data)

		"CHAT_MESSAGE":
			EventBus.chat_message_received.emit(
				data.get("time", ""),
				data.get("email", ""),
				data.get("message", "")
			)

		"MOVE_ORDER_REJECTED":
			EventBus.notification_requested.emit(
				"Move rejected: " + data.get("reason", "unknown"), "error"
			)
