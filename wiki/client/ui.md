# User Interface

The interface gives players the menus, HUD, map controls, panels, chat, notifications, pause menu, and settings they use to play and manage a match.

# Details

## Screen flow

The main menu signs in, creates/joins/browses lobbies, and opens keybind settings. The lobby shows server-mirrored players and nation selection. The loading screen asynchronously loads a target scene, rotates backgrounds/tips, and may wait for server confirmation. Postgame displays the session-ended result and returns to the main menu.

## HUD and panels

`GameHUD` composes the top bar, dock rail, map-mode controls, toasts, chat, selection panels, economy, military, diplomacy, research, air, and tactical panels. `HUDManager` is the local panel registry: it controls side-docked versus centered placement, shortcuts, escape behavior, overlay dimming, and panel visibility. It is explicitly forbidden from networking or game-state mutation.

`PauseMenu` visually pauses local input only; a multiplayer match continues on the server. `KeybindManager` registers default actions, applies presets/remaps, and persists local bindings in `user://keybinds.cfg`. UI pointer and text-focus signals prevent map/camera/military controls from reacting beneath active controls.

## Manual UI checks

Any UI change needs manual checks in the Godot editor: confirm responsive layout at the supported window sizes; keyboard focus and Escape behavior; that visible controls block map input while text fields block keyboard commands; dock, panel, chat, pause, and settings transitions; and readable map/HUD overlays in political, cover, and elevation modes. There is no broad visual-regression suite.

## Verified UI boundary example

`client/src/core/event_bus.gd` publishes UI input-boundary signals shared by map and interface systems:

```gdscript
signal pause_menu_blocking_changed(blocking: bool)
signal ui_pointer_blocking_changed(blocking: bool)
signal ui_text_input_focus_changed(focused: bool)
signal chat_input_focus_changed(focused: bool)
```

These signals are how controls tell map-facing systems to stop consuming pointer or keyboard input; they do not mutate match state.

# Related Notes

- [[client/index|Client]]
- [[client/commands-sessions-and-events|Commands, Sessions, and Events]]
- [[client/map-and-input|Map Rendering, Camera, and Input]]
- [[client/testing-and-debugging|Testing and Debugging]]
