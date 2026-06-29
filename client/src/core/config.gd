extends Node
## Central endpoint config.
## Optional JSON overrides allow editor builds to test deployed servers without export.

var API_URL: String
var COLYSEUS_URL: String

const USER_SERVER_CONFIG_PATH: String = "user://server_config.json"
const PROJECT_SERVER_CONFIG_PATH: String = "res://server_config.json"


## Loads network endpoint configuration.
## Parameters: none.
## Returns: void.
## Example:
## - Create client/server_config.json from client/server_config.example.json to test Railway from the editor.
func _ready() -> void:
	_load_default_urls()
	_load_server_config_override()
	print("Config endpoints: api=%s colyseus=%s debug=%s" % [API_URL, COLYSEUS_URL, OS.is_debug_build()])


## Sets default endpoints based on build type.
## Parameters: none.
## Returns: void.
func _load_default_urls() -> void:
	if OS.is_debug_build():
		API_URL = "http://localhost:3000"
		COLYSEUS_URL = "ws://localhost:2567"
	else:
		API_URL = "https://api-server-production-ae7e.up.railway.app"
		COLYSEUS_URL = "wss://game-server-production-fdea.up.railway.app"


## Applies the first valid server config override found.
## Parameters: none.
## Returns: void.
func _load_server_config_override() -> void:
	var config_paths: Array[String] = [
		USER_SERVER_CONFIG_PATH,
		PROJECT_SERVER_CONFIG_PATH,
	]

	for config_path: String in config_paths:
		if not FileAccess.file_exists(config_path):
			continue

		var parsed_config: Variant = _read_json_file(config_path)
		if typeof(parsed_config) != TYPE_DICTIONARY:
			push_warning("Ignoring invalid server config at %s: root must be an object." % config_path)
			continue

		var config_data: Dictionary = parsed_config as Dictionary
		if not _apply_server_config(config_data, config_path):
			continue

		return


## Reads and parses a JSON file.
## Parameters:
## - file_path: Godot resource or user path to parse.
## Returns: Parsed JSON value, or null on read/parse failure.
func _read_json_file(file_path: String) -> Variant:
	var file: FileAccess = FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		push_warning("Unable to open server config at %s." % file_path)
		return null

	var json_text: String = file.get_as_text()
	var parsed_json: Variant = JSON.parse_string(json_text)
	if parsed_json == null:
		push_warning("Unable to parse server config JSON at %s." % file_path)
		return null

	return parsed_json


## Applies endpoint overrides from a parsed server config dictionary.
## Parameters:
## - config_data: Parsed JSON object with api_url and colyseus_url strings.
## - source_path: File path used for warning messages.
## Returns: true when the config was valid and applied.
func _apply_server_config(config_data: Dictionary, source_path: String) -> bool:
	var api_url_value: Variant = config_data.get("api_url", "")
	var colyseus_url_value: Variant = config_data.get("colyseus_url", "")

	if typeof(api_url_value) != TYPE_STRING or typeof(colyseus_url_value) != TYPE_STRING:
		push_warning("Ignoring server config at %s: api_url and colyseus_url must be strings." % source_path)
		return false

	var api_url: String = api_url_value as String
	var colyseus_url: String = colyseus_url_value as String

	if api_url.is_empty() or colyseus_url.is_empty():
		push_warning("Ignoring server config at %s: api_url and colyseus_url are required." % source_path)
		return false

	API_URL = api_url
	COLYSEUS_URL = colyseus_url
	return true


## Reports whether the active endpoints target deployed/non-local servers.
## Parameters: none.
## Returns: true when either API_URL or COLYSEUS_URL is not a localhost/loopback URL.
func is_online_environment() -> bool:
	return not _is_local_endpoint(API_URL) or not _is_local_endpoint(COLYSEUS_URL)


## Provides the user-facing environment label for menus.
## Parameters: none.
## Returns: "Online" for deployed endpoints, otherwise "Local".
func get_environment_label() -> String:
	return "Online" if is_online_environment() else "Local"


## Checks whether a URL points at a local development endpoint.
## Parameters:
## - endpoint_url: URL string to classify.
## Returns: true when the endpoint host is localhost or loopback.
func _is_local_endpoint(endpoint_url: String) -> bool:
	var lower_url: String = endpoint_url.to_lower()
	return (
		lower_url.contains("://localhost")
		or lower_url.contains("://127.0.0.1")
		or lower_url.contains("://0.0.0.0")
		or lower_url.begins_with("localhost:")
		or lower_url.begins_with("127.0.0.1:")
		or lower_url.begins_with("0.0.0.0:")
	)
