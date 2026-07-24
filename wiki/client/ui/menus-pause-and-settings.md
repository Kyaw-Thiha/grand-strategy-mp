# Menus, Pause, and Settings

These screens let players sign in, enter a lobby, wait for a match, leave play, and adjust local controls without changing the multiplayer simulation.

# Details

## Menu-to-match screens

The main menu owns login controls, lobby creation, six-character code entry, public-game browsing, and access to settings. It shows hosting only when the locally decoded JWT reports a host pass, while the API server still enforces the permission.

The lobby scene shows the current join code, available nations, occupied slots, readiness, and the host-only Start button from `GameState`. Loading displays rotating local artwork and tips while it waits for `GAME_STARTED` when required and asynchronously loads the pending scene.

The postgame screen is intended to show the winner and end reason, then return to the main menu. **Current limitation:** the result signal is emitted before the postgame scene subscribes, so the payload is not retained for that screen.

Session mechanics and failure behavior are documented in [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]].

## Pause behavior

`PauseMenu`, implemented by `client/src/ui/game/pause_menu.gd`, is a visual/input overlay. It does not set the scene tree as paused, and the multiplayer server continues simulating while it is open.

Opening or closing it publishes `EventBus.pause_menu_blocking_changed` so map, camera, military, and HUD shortcuts stop reacting underneath the overlay. Quit returns through the loading screen to the main menu and requests a room disconnect. How To Play is currently a placeholder.

## Settings and key bindings

The same settings scene can open from the main menu or pause menu. Its Control page reads and changes actions through `KeybindManager`, including defaults, a left-handed preset, individual capture, clearing, and persistence to `user://keybinds.cfg`.

Sound, display, advanced, and mods pages are present as UI. Display controls are explicitly interactive placeholders, and the other non-control settings are not a complete persisted game-settings system.

## Required manual checks

Changes to these screens require manual Godot checks for button enable/disable state, keyboard focus, Escape behavior, lobby and loading transitions, pause blocking, key-capture cancellation, supported window sizes, and readable backgrounds/text. There is no broad visual-regression suite.

# Related Notes

- [[client/ui/index|Client User Interface]]
- [[client/auth/login-and-session|Login and Session Identity]]
- [[client/session/networked-lobby-and-match-lifecycle|Networked Lobby and Match Lifecycle]]
- [[client/core/scene-lifecycle|Scene Lifecycle]]
- [[client/core/local-preferences-and-templates|Local Preferences and Templates]]

