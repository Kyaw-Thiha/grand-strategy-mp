extends Node
## Handles email-based login for local dev (Steam auth comes in Phase 7).
## Stores JWT in memory only — never written to disk.

signal logged_in(user_id: String)
signal login_failed(message: String)

var user_id: String = ""


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
	user_id = _parse_sub(token)
	logged_in.emit(user_id)


func is_logged_in() -> bool:
	return APIClient.jwt != ""


func logout() -> void:
	APIClient.jwt = ""
	user_id = ""


# Decodes the `sub` field from the JWT payload without verifying the signature.
# Verification is done server-side — this is only for reading our own user_id.
func _parse_sub(token: String) -> String:
	var parts := token.split(".")
	if parts.size() < 2:
		return ""
	var padded := parts[1]
	while padded.length() % 4 != 0:
		padded += "="
	var decoded := Marshalls.base64_to_raw(padded).get_string_from_utf8()
	var payload: Dictionary = JSON.parse_string(decoded)
	return payload.get("sub", "")
