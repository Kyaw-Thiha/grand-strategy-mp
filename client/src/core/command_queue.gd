extends Node
## Single conduit for all player commands to the Colyseus server.
## Nothing sends to NetManager except this module.
## Validates auth and connection state before forwarding.

signal command_rejected(type: String, reason: String)


## Submits a command to the server.
## type: Colyseus message type (e.g. "SELECT_NATION", "SET_READY")
## payload: optional data dict — pass {} if no payload needed
func submit(type: String, payload: Dictionary) -> void:
	if not AuthManager.is_logged_in():
		command_rejected.emit(type, "Not authenticated")
		return

	if NetManager.get_connection_state() != "connected":
		command_rejected.emit(type, "Not connected to server")
		return

	NetManager.send_command(type, payload)
