# Client Server Environment Override

## Goal

Allow the Godot editor/debug build to connect to deployed Railway services without exporting a release build or editing `config.gd` for every test.

## Phase 1 - Config Loading

- Extend `client/src/core/config.gd` to load a JSON override from `user://server_config.json` first.
- Fall back to `res://server_config.json` if no user override exists.
- Fall back to existing debug/release defaults if no override file exists or the file is invalid.
- Validate required fields before applying an override.

## Phase 2 - Team Example

- Add a committed `client/server_config.example.json` documenting local and staging values.
- Ignore `client/server_config.json` so each developer can choose their own target without committing endpoint changes.

## Phase 3 - Verification

- Run a lightweight GDScript syntax check where available.
- Provide usage steps for local and Railway testing.
