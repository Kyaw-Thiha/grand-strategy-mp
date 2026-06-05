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
			SceneManager.goto_game()

		"GAME_ENDED":
			var winner: String = data.get("winner_id", "")
			var reason: String = data.get("reason", "")
			session_ended.emit(winner, reason)
			SceneManager.goto_postgame()

		"SPEED_CHANGED":
			var new_speed: int = data.get("game_speed", 1)
			speed_changed.emit(new_speed)
