# Configuration and Serialization

This system decides which local or online game services the player connects to. It also packs the small messages used while playing so lobby choices and in-game orders can travel reliably.

# Details

## Endpoint configuration

`Config`, implemented by `client/src/core/config.gd`, uses localhost endpoints for debug builds and deployed endpoints for release builds. It then accepts the first valid override from `user://server_config.json` or `res://server_config.json`, in that precedence order. The override contains only `api_url` and `colyseus_url`; `client/server_config.example.json` documents the expected shape.

`is_online_environment()` and `get_environment_label()` classify the active endpoint pair for menu display. Invalid or incomplete override files leave the selected defaults in place and emit a warning.

`client/src/core/config.gd`, `Config._load_default_urls()`, selects the development endpoints from the build type:

```gdscript
func _load_default_urls() -> void:
	if OS.is_debug_build():
		API_URL = "http://localhost:3000"
		COLYSEUS_URL = "ws://localhost:2567"
	else:
		API_URL = "https://api-server-production-ae7e.up.railway.app"
```

This is the default-selection step that happens before an optional server-config override is considered.

## MessagePack protocol support

`MsgPack`, implemented by `client/src/core/msgpack.gd`, encodes and decodes the values used in named Colyseus room messages. It is a protocol utility used by networking; it does not decide game results.

# Related Notes

- [[client/core/index|Client Core Runtime]]
- [[client/networking/index|Networking]]
- [[client/auth/index|Authentication]]
