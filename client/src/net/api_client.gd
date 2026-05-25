extends Node
## HTTP client for all Hono api-server calls.
## Automatically attaches the JWT set by AuthManager.

var BASE_URL: String:
	get: return Config.API_URL

var jwt: String = ""


func post(endpoint: String, body: Dictionary) -> Dictionary:
	return await _request(HTTPClient.METHOD_POST, endpoint, body)


func get_req(endpoint: String) -> Dictionary:
	return await _request(HTTPClient.METHOD_GET, endpoint, {})


func put(endpoint: String, body: Dictionary) -> Dictionary:
	return await _request(HTTPClient.METHOD_PUT, endpoint, body)


func _request(method: int, endpoint: String, body: Dictionary) -> Dictionary:
	var http := HTTPRequest.new()
	add_child(http)

	var headers := ["Content-Type: application/json"]
	if jwt != "":
		headers.append("Authorization: Bearer " + jwt)

	var body_string := JSON.stringify(body) if not body.is_empty() else ""
	http.request(BASE_URL + endpoint, headers, method, body_string)

	var result: Array = await http.request_completed
	http.queue_free()

	var code: int = result[1]
	var data = JSON.parse_string(result[3].get_string_from_utf8())
	return {"code": code, "data": data}
