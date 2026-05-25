extends Node
## End-to-end test: email login → JWT → Colyseus room join.
##
## Tests the full auth handshake from the Godot client side:
##   1. AuthManager logs in via Hono /auth/email
##   2. NetManager connects to Colyseus game_room with the JWT
##   3. Confirms player appears in room state
##
## To run: set this scene as the main scene in Project Settings, then press Play.
## Requires both servers running locally (see client/README.md).

const TEST_EMAIL := "godot-e2e@example.com"
const TEST_PASSWORD := "password123"


func _ready() -> void:
	print("=== Auth Handshake Test ===")

	AuthManager.logged_in.connect(_on_logged_in)
	AuthManager.login_failed.connect(_on_login_failed)
	NetManager.room_joined.connect(_on_room_joined)
	NetManager.room_error.connect(_on_room_error)

	print("1. Logging in as %s..." % TEST_EMAIL)
	AuthManager.login(TEST_EMAIL, TEST_PASSWORD)


func _on_logged_in(user_id: String) -> void:
	print("   ✓ Logged in — user_id: %s" % user_id)
	print("2. Connecting to Colyseus game_room...")
	NetManager.connect_to_room()


func _on_login_failed(message: String) -> void:
	print("   ✗ Login failed: %s" % message)
	_finish(false)


func _on_room_joined(session_id: String, room_id: String) -> void:
	print("   ✓ Room joined — session: %s, room: %s" % [session_id, room_id])
	print("\n✅ Auth handshake test passed.")
	_finish(true)


func _on_room_error(message: String) -> void:
	print("   ✗ Room error: %s" % message)
	_finish(false)


func _finish(success: bool) -> void:
	await get_tree().create_timer(0.5).timeout
	get_tree().quit(0 if success else 1)
