extends Node
## Handles email-based login for local dev (Steam auth comes in Phase 7).
## Stores JWT in memory only — never written to disk.

signal logged_in(user_id: String)
signal login_failed(message: String)

var user_id: String = ""
var has_host_pass: bool = false


func login(email: String, password: String) -> void:
	var result := await APIClient.post("/auth/email", {
		"email": email,
		"password": password,
	})

	if result["code"] != 200:
		var message: String = result["data"].get("error", "Login failed")
		login_failed.emit(message)
		return

	var token: String = result["data"].get("token", "")
	if token == "":
		login_failed.emit("No token in response")
		return

	APIClient.jwt = token
	var payload: Dictionary = _decode_payload(token)
	user_id = payload.get("sub", "")
	has_host_pass = payload.get("has_host_pass", false)
	logged_in.emit(user_id)


func is_logged_in() -> bool:
	return APIClient.jwt != ""


func logout() -> void:
	APIClient.jwt = ""
	user_id = ""
	has_host_pass = false


# Decodes the JWT payload without verifying the signature.
# Verification is done server-side — this is only for reading our own claims.
func _decode_payload(token: String) -> Dictionary:
	var parts := token.split(".")
	if parts.size() < 2:
		return {}
	var padded := parts[1]
	while padded.length() % 4 != 0:
		padded += "="
	var decoded := Marshalls.base64_to_raw(padded).get_string_from_utf8()
	var result: Variant = JSON.parse_string(decoded)
	return result if result is Dictionary else {}
