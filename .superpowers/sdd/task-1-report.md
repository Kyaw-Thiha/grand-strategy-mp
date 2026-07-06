# Task 1 Report: Air Wing Path Bridge

## What I implemented

Added the missing `AIR_WING_PATH` client bridge:

- `client/src/core/event_bus.gd` now declares `signal air_wing_path(path_data: Dictionary)`.
- `client/src/systems/session/session_manager.gd` now forwards `AIR_WING_PATH` room messages with `EventBus.air_wing_path.emit(data)`.
- Added a scene-based client test pair:
  - `client/test/test_air_wing_path_bridge.gd`
  - `client/scenes/test/test_air_wing_path_bridge.tscn`

The test verifies the payload is emitted unchanged and uses the existing headless Godot scene test style.

## TDD evidence

### RED

Ran:

```bash
godot --headless --path client --scene res://scenes/test/test_air_wing_path_bridge.tscn
```

Observed failure:

```text
ASSERT TRUE FAILED: EventBus missing air_wing_path
```

### GREEN

Ran the same command again after the bridge implementation. Result:

```text
[PASS] test_air_wing_path_bridge: all tests passed
```

Also reran the existing `client/scenes/test/test_air_wing_state.tscn` smoke test; it still passed.

## Files changed

- `client/src/core/event_bus.gd`
- `client/src/systems/session/session_manager.gd`
- `client/test/test_air_wing_path_bridge.gd`
- `client/scenes/test/test_air_wing_path_bridge.tscn`
- `docs/superpowers/plans/2026-07-03-air-wing-path-bridge.md`

## Concerns

- Godot prints an unrelated `ERR_FILE_CORRUPT` warning while starting headless tests, and `.env` is still missing in the client runtime; neither blocked the bridge test.
