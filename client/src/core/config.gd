extends Node
## Central config — URLs switch automatically between debug and release builds.
## Debug = editor / local dev. Release = exported production build on Railway.

var API_URL: String
var COLYSEUS_URL: String


func _ready() -> void:
	if OS.is_debug_build():
		API_URL = "http://localhost:3000"
		COLYSEUS_URL = "ws://localhost:2567"
	else:
		API_URL = "https://your-api.railway.app"
		COLYSEUS_URL = "wss://your-colyseus.railway.app"
