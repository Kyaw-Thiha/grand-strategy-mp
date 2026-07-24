# Local Preferences and Templates

This system stores preferences a player sets outside a match, such as key bindings and saved division templates. It lets players reuse familiar controls and army layouts when preparing an army.

# Details

## Key bindings

`KeybindManager`, implemented by `client/src/core/keybind_manager.gd`, registers default input actions, applies remaps or named presets, persists mappings to `user://keybinds.cfg`, and returns display text for UI controls. `client/src/core/keybind_presets.gd` defines the supported action list and the left-handed preset data.

## Division templates

`client/src/core/keybind_manager.gd` keeps remaps in the local Godot user-data directory:

```gdscript
const _CONFIG_PATH := "user://keybinds.cfg"

func _ready() -> void:
	_register_all_actions()
	_load_from_config()
```

This runs when the autoload starts, so saved controls remain a local preference rather than room state.

`DivisionTemplateStore`, implemented by `client/src/core/division_template_store.gd`, loads built-in combined-arms, infantry, and armoured templates into local memory. It exposes reads, saves, deletion, and a `templates_changed` signal for the division-builder UI. Assigning a template to a live division remains a separate server command.

# Related Notes

- [[client/core/index|Client Core Runtime]]
- [[client/military/index|Military]]
- [[client/ui/index|User Interface]]
