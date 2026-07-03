# Air Wing Path Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge `AIR_WING_PATH` room messages from `SessionManager` to `EventBus` unchanged so downstream air-route rendering can subscribe later.

**Architecture:** Keep the change limited to the client session bridge. Add one new EventBus signal that carries the raw payload dictionary, then forward the matching server event from `SessionManager._on_server_event()` without transforming the data.

**Tech Stack:** Godot 4 GDScript, EventBus autoload, SessionManager autoload, scene-based client test runner.

## Global Constraints

- Client uses `EventBus` for cross-system signals.
- `SessionManager._on_server_event(type, data)` is the room-message bridge.
- Keep scope to the event bridge only; no interpolation/UI yet.
- Use a single `Dictionary` payload on `EventBus.air_wing_path`, forwarded unchanged from `SessionManager._on_server_event()`.

---

### Task 1: Add the failing bridge test

**Files:**
- Create: `client/test/test_air_wing_path_bridge.gd`
- Create: `client/scenes/test/test_air_wing_path_bridge.tscn`

**Interfaces:**
- Consumes: `SessionManager._on_server_event("AIR_WING_PATH", payload)`
- Produces: a red test that expects `EventBus.air_wing_path` to emit the same payload

- [ ] **Step 1: Write the failing test**

```gdscript
extends Node

func _ready() -> void:
	var observed_payloads: Array = []
	EventBus.air_wing_path.connect(func(payload: Dictionary) -> void: observed_payloads.append(payload))

	var payload: Dictionary = {
		"wing_id": "test-wing-1",
		"path_gen_id": "path-1",
		"path_type": "dubins",
		"segments": [],
		"total_length_deg": 12.5,
		"start_lng": 0.0,
		"start_lat": 0.0,
		"start_heading_compass_deg": 90.0,
		"end_lng": 1.0,
		"end_lat": 1.0,
		"end_heading_compass_deg": 180.0,
		"turn_radius_deg": 0.5,
		"speed_deg_per_ms": 0.01,
	}

	var session_manager: SessionManager = SessionManager.new()
	session_manager._on_server_event("AIR_WING_PATH", payload)

	assert(not observed_payloads.is_empty(), "AIR_WING_PATH must emit EventBus.air_wing_path")
	assert(observed_payloads[0] == payload, "AIR_WING_PATH must forward the payload unchanged")
	print("[PASS] test_air_wing_path_bridge: all tests passed")
	get_tree().quit()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `godot --headless --path client --scene res://scenes/test/test_air_wing_path_bridge.tscn`
Expected: failure because `EventBus.air_wing_path` and the `AIR_WING_PATH` branch do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add the signal to `client/src/core/event_bus.gd` and forward the message in `client/src/systems/session/session_manager.gd`.

- [ ] **Step 4: Run test to verify it passes**

Run: `godot --headless --path client --scene res://scenes/test/test_air_wing_path_bridge.tscn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/test/test_air_wing_path_bridge.gd client/scenes/test/test_air_wing_path_bridge.tscn client/src/core/event_bus.gd client/src/systems/session/session_manager.gd docs/superpowers/plans/2026-07-03-air-wing-path-bridge.md
git commit -m "feat: bridge air wing path events"
```
