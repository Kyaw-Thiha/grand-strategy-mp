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

		"PROVINCE_INIT":
			GameState._apply_province_init(data)

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

		"DIPLOMACY_NOTIFICATION":
			EventBus.notification_requested.emit(
				data.get("message", "Diplomacy updated"),
				data.get("notification_type", "diplomacy")
			)

		"DIPLOMACY_INTERACTIVE_NOTIFICATION":
			EventBus.interactive_notification_requested.emit(data)

		"DIPLOMACY_VOTE_UPDATED":
			EventBus.interactive_notification_updated.emit(data)

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

		"AIR_WING_UPDATES":
			GameState._apply_air_wing_updates(data)

		"AIR_WING_PATH":
			GameState._apply_air_wing_path(data)
			EventBus.air_wing_path.emit(data)

		"WING_DETECTED":
			EventBus.air_wing_detected.emit(data.get("wing_id", ""))

		"WING_LOST_DETECTION":
			EventBus.air_wing_detection_lost.emit(data.get("wing_id", ""))

		"RADAR_UPDATED":
			EventBus.radar_updated.emit(data)

		"DIVISION_REVEALED":
			EventBus.division_revealed.emit(data.get("division_id", ""))

		"DIVISION_HIDDEN":
			EventBus.division_hidden.emit(data.get("division_id", ""))

		"AIR_WING_STAGING":
			EventBus.notification_requested.emit(
				"Wing out of range — auto-staging to closer airbase before executing order.",
				"info"
			)

		"AIR_WING_DESTROYED":
			GameState._apply_air_wing_destroyed(data)
		"DIVISION_APPEARED":
			GameState._apply_division_appeared(data)
		"DIVISION_VANISHED":
			EventBus.division_vanishing.emit(data.get("division_id", ""))
		"AIR_WING_VANISHED":
			EventBus.air_wing_vanishing.emit(data.get("wing_id", ""))

		"AIR_COMBAT_STARTED":
			EventBus.air_combat_started.emit(data)
		"AIR_COMBAT_ENDED":
			EventBus.air_combat_ended.emit(data)
		"AIR_WING_RTB_QUEUED":
			EventBus.notification_requested.emit(
				"Wing returning to base — will proceed to target after refuelling.", "info")
		"AIR_WING_MOVE_REJECTED":
			EventBus.notification_requested.emit(
				"Target out of range — no staging airbase available.", "warning")
		"AIR_BOMBING_RESULT":
			EventBus.air_bombing_result.emit(data)
		"AIR_BOMBING_PROVINCE_RESULT":
			EventBus.air_bombing_province_result.emit(data)
		"PROVINCE_AA_FIRED":
			EventBus.province_aa_fired.emit(data)
		"CONTACT_MARKER_EXPIRED":
			EventBus.naval_contact_marker_expired.emit(data)
		"NAVAL_CONTACT_UPDATES":
			GameState._apply_naval_contact_updates(data)
