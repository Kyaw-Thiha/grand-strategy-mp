# Phase 12 — Task K-stubs: Air Client Stubs

## Purpose

Branch A (`feat/air-wing-schema`) added `AirWingState` to the server schema and a test-only
`SPAWN_WING` handler, but nothing is visible on the client yet. K-stubs adds the minimal
GDScript client layer so that every subsequent server branch (B, C, D, E, G, H) can be
verified visually as it lands:

- Wing icons appear on the map when a wing is in TRANSIT / ENGAGED / LOITER / RTB
- Wing icons are hidden when lifecycle_state is IDLE (wing is at home base)
- Icon tint shifts green → yellow → red as `combat_readiness` falls
- Wing stacking: multiple wings at the same home airbase collapse to a single icon with a
  count badge (same pattern as land division stacking)
- Icons snap to schema position every server tick (no smooth interpolation yet — that is
  Branch C's job)

This branch contains **no mission UI, no panels, no fleet panel, no notification toasts**
— those are K-ui (`feat/air-client-ui`), which comes last.

---

## Critical Background: How the Client Receives Server Data

**DO NOT assume Colyseus schema patches are used on the client.** The client does NOT
implement the Colyseus GDScript schema SDK. Instead, the server calls
`this.broadcast("MESSAGE_TYPE", payload)` which is sent as a MsgPack room message, decoded
by `NetManager`, and routed via `SessionManager` to `GameState`.

The full pipeline is:
```
Server: this.broadcast("AIR_WING_UPDATES", { wings: [...] })
  ↓
NetManager._handle_room_data() → MsgPack.decode → server_event_received.emit(type, data)
  ↓
SessionManager._on_server_event(type, data) → match type → GameState._apply_*(data)
  ↓
GameState emits EventBus signals (air_wing_added / air_wing_updated / air_wing_removed)
  ↓
AirWingSystem._on_air_wing_added(wing_id) → spawns AirWingIcon node on map
```

The `air_wings: MapSchema` on `GameRoomState` is used internally by Colyseus for its own
binary state sync — the client ignores those patches. Wing data reaches the client ONLY
through explicit `this.broadcast(...)` calls.

---

## Architecture Decisions

- **AirWingSystem is a scene Node, NOT an autoload.** MilitarySystem (the land division
  equivalent) is a scene node added to `map_debug.tscn`. Follow the same pattern. Do NOT
  register AirWingSystem in `project.godot`.

- **No sprites.** `DivisionIcon` uses zero PNG/SVG assets — it is entirely procedural
  `_draw()`. AirWingIcon must follow the same approach. There are no aircraft sprites in
  the asset folder.

- **New directory `client/src/systems/air/`.** All air GDScript goes here, not in
  `military/`. K-stubs establishes this directory.

- **`set_process(false)` in `_ready()`.** All existing icon/system scripts call
  `set_process(false)` by default and only enable it during animations. Follow this.

- **EventBus is the ONLY inter-system communication channel.** Do not store direct node
  references between AirWingSystem and other systems. See AGENTS.md Rule 8.

- **GameState is read-only from AirWingSystem.** AirWingSystem reads `GameState.get_air_wing(id)`
  but never writes to GameState. See AGENTS.md Rule 1.

---

## Files to Create

| File | Purpose |
|---|---|
| `client/src/systems/air/air_wing_system.gd` | Orchestrator: spawns/removes/updates icons |
| `client/src/systems/air/air_wing_icon.gd` | Procedural canvas-drawn wing icon |
| `client/scenes/systems/air/air_wing_icon.tscn` | Scene file for the icon |
| `client/test/test_air_wing_state.gd` | Tests for GameState air_wings storage |
| `client/test/test_air_wing_icon.gd` | Tests for AirWingIcon visibility + tint logic |
| `client/scenes/test/test_air_wing_state.tscn` | Test scene runner |
| `client/scenes/test/test_air_wing_icon.tscn` | Test scene runner |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/GameRoom.ts` | Add `_serializeWing()`, update `SPAWN_WING` to broadcast, add DEV_MODE gate |
| `game-server/test/12a-air-wing-schema.test.ts` | Add test: SPAWN_WING broadcasts AIR_WING_UPDATES |
| `client/src/core/event_bus.gd` | Add 5 new air wing signals |
| `client/src/core/game_state.gd` | Add `air_wings` dict + `_apply_*` methods + getter |
| `client/src/systems/session/session_manager.gd` | Add `AIR_WING_UPDATES` + `AIR_WING_DESTROYED` routes |
| `client/scenes/debug/map_debug.tscn` | Add `AirWingLayer` (Node2D) + `AirWingSystem` (Node) |
| `client/src/debug/map_debug.gd` | Wire `air_wing_system.setup(map_loader, air_wing_layer)` |

---

## Step-by-Step Implementation

### STEP 1 — Server: Add wing serialization and update SPAWN_WING

**File:** `game-server/src/rooms/GameRoom.ts`

Add a private helper method `_serializeWing` that converts an `AirWingState` schema
object into a plain serializable object:

```typescript
private _serializeWing(wing: AirWingState): Record<string, unknown> {
  return {
    wing_id:                  wing.wing_id,
    nation_id:                wing.nation_id,
    aircraft_type:            wing.aircraft_type,
    count:                    wing.count,
    combat_readiness:         wing.combat_readiness,
    position_lng:             wing.position_lng,
    position_lat:             wing.position_lat,
    heading_deg:              wing.heading_deg,
    lifecycle_state:          wing.lifecycle_state,
    mission:                  wing.mission,
    target_id:                wing.target_id,
    home_airbase_province_id: wing.home_airbase_province_id,
    weapon_ready:             wing.weapon_ready,
  };
}
```

Then update the `SPAWN_WING` test handler to broadcast after adding the wing:

```typescript
// Inside the existing if (process.env.NODE_ENV === "test") block:
this.onMessage("SPAWN_WING", (_client, msg: { ... }) => {
  const wing = new AirWingState();
  // ... existing field assignments ...
  this.state.air_wings.set(msg.wing_id, wing);
  // ADD this broadcast:
  this.broadcast("AIR_WING_UPDATES", { wings: [this._serializeWing(wing)] });
});
```

Also add the same SPAWN_WING handler (with broadcast) under the DEV_MODE gate so it can
be used for manual visual testing when running the server with `DEV_MODE=true`:

```typescript
if (process.env.DEV_MODE === "true") {
  this.onMessage("DEV_TELEPORT",   ...);  // existing
  this.onMessage("DEV_SET_SUPPLY", ...);  // existing
  this.onMessage("SPAWN_WING", (_client, msg: { ... }) => {
    const wing = new AirWingState();
    // same field assignments as above
    this.state.air_wings.set(msg.wing_id, wing);
    this.broadcast("AIR_WING_UPDATES", { wings: [this._serializeWing(wing)] });
  });
}
```

**Caution:** The DEV_MODE SPAWN_WING handler is separate from the NODE_ENV=test one.
Do not merge them. They serve different purposes (visual dev testing vs automated tests).

---

### STEP 2 — Server test: Verify AIR_WING_UPDATES broadcast

**File:** `game-server/test/12a-air-wing-schema.test.ts`

Add a new test that verifies `SPAWN_WING` now broadcasts an `AIR_WING_UPDATES` message
with the correct wing data. Add this inside the existing `describe("12a — Air Wing Schema")` block:

```typescript
it("SPAWN_WING broadcasts AIR_WING_UPDATES to all clients with correct wing data", async () => {
  const { client, room } = await joinRoom();

  const broadcastReceived = new Promise<any>((resolve) => {
    client.onMessage("AIR_WING_UPDATES", resolve);
  });

  client.send("SPAWN_WING", {
    wing_id:      "wing-broadcast-test",
    nation_id:    "france",
    aircraft_type: "fighter",
    count:        18,
    position_lng: 2.35,
    position_lat: 48.85,
  });

  const msg = await broadcastReceived;
  assert.ok(Array.isArray(msg.wings), "AIR_WING_UPDATES.wings must be an array");
  assert.strictEqual(msg.wings.length, 1);
  const w = msg.wings[0];
  assert.strictEqual(w.wing_id,      "wing-broadcast-test");
  assert.strictEqual(w.nation_id,    "france");
  assert.strictEqual(w.aircraft_type,"fighter");
  assert.strictEqual(w.count,        18);
  assert.strictEqual(w.position_lng, 2.35);
  assert.strictEqual(w.position_lat, 48.85);
});
```

Run after adding: `NODE_ENV=test npx mocha -r tsx test/12a-air-wing-schema.test.ts --exit --timeout 15000`

All 12 tests (11 original + 1 new) must pass before proceeding.

---

### STEP 3 — EventBus: Add air wing signals

**File:** `client/src/core/event_bus.gd`

Add a new comment block and signals **at the end of the file** (before the last closing
line if any, or just appended):

```gdscript
## Air Wings
signal air_wing_added(wing_id: String)
signal air_wing_updated(wing_id: String)
signal air_wing_removed(wing_id: String)
signal air_wing_selected(wing_id: String)
signal air_wing_deselected()
```

Do NOT modify any existing signals. The existing 50 signals must remain unchanged.

---

### STEP 4 — Client test: Verify EventBus signals exist

**File:** `client/test/test_air_wing_state.gd`

Write this test file before implementing GameState changes:

```gdscript
extends Node

func _ready() -> void:
    _test_eventbus_has_air_signals()
    print("[PASS] test_air_wing_state: all EventBus signal tests passed")
    get_tree().quit()

func _test_eventbus_has_air_signals() -> void:
    assert(EventBus.has_signal("air_wing_added"),    "EventBus missing air_wing_added")
    assert(EventBus.has_signal("air_wing_updated"),  "EventBus missing air_wing_updated")
    assert(EventBus.has_signal("air_wing_removed"),  "EventBus missing air_wing_removed")
    assert(EventBus.has_signal("air_wing_selected"), "EventBus missing air_wing_selected")
    assert(EventBus.has_signal("air_wing_deselected"), "EventBus missing air_wing_deselected")
```

**File:** `client/scenes/test/test_air_wing_state.tscn`

Create a minimal scene with a root Node that has `test_air_wing_state.gd` attached.
Pattern: same structure as existing test scenes like `test_relations_sync.tscn`.

---

### STEP 5 — GameState: Add air_wings storage

**File:** `client/src/core/game_state.gd`

Add the following **after** the existing `var proposals: Dictionary = {}` (or whichever
is the last Dictionary var). Do not modify existing vars or methods:

```gdscript
var air_wings: Dictionary = {}  # wing_id → {wing_id, nation_id, aircraft_type, count,
                                #   combat_readiness, position_lng, position_lat,
                                #   heading_deg, lifecycle_state, mission, target_id,
                                #   home_airbase_province_id, weapon_ready}

func get_air_wing(wing_id: String) -> Dictionary:
    return air_wings.get(wing_id, {})

func get_air_wings_for_nation(nation_id: String) -> Array:
    var result: Array = []
    for w in air_wings.values():
        if w.get("nation_id", "") == nation_id:
            result.append(w)
    return result

func _apply_air_wing_updates(data: Dictionary) -> void:
    for wing_data in data.get("wings", []):
        var id: String = wing_data.get("wing_id", "")
        if id.is_empty():
            continue
        var is_new: bool = not air_wings.has(id)
        air_wings[id] = wing_data
        if is_new:
            EventBus.air_wing_added.emit(id)
        else:
            EventBus.air_wing_updated.emit(id)

func _apply_air_wing_destroyed(data: Dictionary) -> void:
    var id: String = data.get("wing_id", "")
    if id.is_empty() or not air_wings.has(id):
        return
    air_wings.erase(id)
    EventBus.air_wing_removed.emit(id)
```

**Caution:** GameState is an autoload singleton. Do NOT add `_ready()` or `_process()`
overrides unless they already exist — just add the new vars and methods.

---

### STEP 6 — Client test: GameState air_wings apply methods

Extend `client/test/test_air_wing_state.gd` with these additional test functions (call
them from `_ready()` before the print statement):

```gdscript
func _test_gamestate_apply_wing_updates() -> void:
    # Setup: ensure clean state
    GameState.air_wings.clear()

    var added_ids: Array = []
    EventBus.air_wing_added.connect(func(id): added_ids.append(id))

    # Test: new wing is added and signal fires
    GameState._apply_air_wing_updates({
        "wings": [{
            "wing_id": "test-wing-1",
            "nation_id": "germany",
            "aircraft_type": "fighter",
            "count": 10,
            "combat_readiness": 1.0,
            "position_lng": 13.4,
            "position_lat": 52.5,
            "heading_deg": 0.0,
            "lifecycle_state": "transit",
            "mission": "interception",
            "target_id": "",
            "home_airbase_province_id": "berlin",
            "weapon_ready": true,
        }]
    })
    assert(GameState.air_wings.has("test-wing-1"), "wing should be stored in air_wings")
    assert(added_ids.has("test-wing-1"), "air_wing_added should have fired")

    # Test: same wing id triggers updated, not added
    var updated_ids: Array = []
    EventBus.air_wing_updated.connect(func(id): updated_ids.append(id))
    GameState._apply_air_wing_updates({
        "wings": [{"wing_id": "test-wing-1", "nation_id": "germany",
                   "aircraft_type": "fighter", "count": 8,
                   "combat_readiness": 0.9, "position_lng": 13.5, "position_lat": 52.5,
                   "heading_deg": 0.0, "lifecycle_state": "transit",
                   "mission": "interception", "target_id": "",
                   "home_airbase_province_id": "berlin", "weapon_ready": true}]
    })
    assert(not updated_ids.is_empty(), "air_wing_updated should fire on re-apply")
    assert(added_ids.size() == 1, "air_wing_added should NOT fire again on update")
    assert(GameState.air_wings["test-wing-1"]["count"] == 8, "count should update to 8")

    # Test: _apply_air_wing_destroyed removes and signals
    var removed_ids: Array = []
    EventBus.air_wing_removed.connect(func(id): removed_ids.append(id))
    GameState._apply_air_wing_destroyed({"wing_id": "test-wing-1"})
    assert(not GameState.air_wings.has("test-wing-1"), "wing should be removed")
    assert(removed_ids.has("test-wing-1"), "air_wing_removed should fire")

    # Test: empty wing_id is a no-op (no crash)
    GameState._apply_air_wing_updates({"wings": [{"wing_id": ""}]})

    # Test: get_air_wing returns {} for unknown id
    var missing = GameState.get_air_wing("nonexistent")
    assert(missing.is_empty(), "get_air_wing should return {} for unknown id")

    # Cleanup
    GameState.air_wings.clear()
```

---

### STEP 7 — SessionManager: Route AIR_WING_UPDATES and AIR_WING_DESTROYED

**File:** `client/src/systems/session/session_manager.gd`

Find the `match type:` block (inside `_on_server_event`). Add two new cases alongside
the existing division cases. Do NOT touch any existing cases:

```gdscript
"AIR_WING_UPDATES":
    GameState._apply_air_wing_updates(data)
"AIR_WING_DESTROYED":
    GameState._apply_air_wing_destroyed(data)
```

---

### STEP 8 — AirWingIcon: Write tests first, then implement

#### 8a — Test file (write FIRST)

**File:** `client/test/test_air_wing_icon.gd`

```gdscript
extends Node

var icon: Node2D

func _ready() -> void:
    # AirWingIcon will be instantiated by the test scene
    icon = $AirWingIcon
    _test_idle_hidden()
    _test_visible_states()
    _test_readiness_tint()
    _test_count_badge()
    print("[PASS] test_air_wing_icon: all tests passed")
    get_tree().quit()

func _test_idle_hidden() -> void:
    icon.lifecycle_state = "idle"
    icon._update_visibility()
    assert(not icon.visible, "IDLE wing icon must be hidden")

func _test_visible_states() -> void:
    for state in ["transit", "engaged", "loiter", "rtb", "refuel"]:
        icon.lifecycle_state = state
        icon._update_visibility()
        assert(icon.visible, "Wing in '%s' state must be visible" % state)

func _test_readiness_tint() -> void:
    # Full readiness → green tint
    icon.combat_readiness = 1.0
    var c = icon._readiness_color()
    assert(c.g > c.r, "High readiness should be green-dominant")

    # Mid readiness → yellow tint
    icon.combat_readiness = 0.55
    c = icon._readiness_color()
    assert(c.r > 0.4 and c.g > 0.4, "Mid readiness should be yellow (r+g both present)")
    assert(c.b < 0.2, "Mid readiness should not be blue")

    # Low readiness → red tint
    icon.combat_readiness = 0.2
    c = icon._readiness_color()
    assert(c.r > c.g, "Low readiness should be red-dominant")

func _test_count_badge() -> void:
    # No badge when count == 1
    icon.wing_count = 1
    assert(not icon._should_show_count_badge(), "No badge for count=1")

    # Badge shown when count > 1
    icon.wing_count = 3
    assert(icon._should_show_count_badge(), "Badge required for count=3")
```

**File:** `client/scenes/test/test_air_wing_icon.tscn`

Create a test scene with:
- Root `Node` with `test_air_wing_icon.gd` attached
- Child `AirWingIcon` node (instance of `air_wing_icon.tscn`) named "AirWingIcon"

#### 8b — Implement AirWingIcon

**File:** `client/src/systems/air/air_wing_icon.gd`

```gdscript
extends Node2D

## Wing identifier (set by AirWingSystem after instantiation)
var wing_id: String = ""
var nation_id: String = ""
var nation_color: Color = Color(0.5, 0.5, 0.5)
var aircraft_type: String = "fighter"
var wing_count: int = 10          # total aircraft in wing (used for badge)
var combat_readiness: float = 1.0 # 0.0–1.0
var lifecycle_state: String = "idle"
var is_selected: bool = false

## Visual constants — mirror DivisionIcon dimensions where sensible
const DIAMOND_HALF := 11.0        # half-width of the diamond shape in px
const READINESS_BAR_H := 3.0
const READINESS_BAR_Y := DIAMOND_HALF + 4.0
const BADGE_RADIUS := 5.5
const HIT_THRESHOLD_PX := 20.0   # for click detection in AirWingSystem

func _ready() -> void:
    set_process(false)            # only enable during animations

func setup(data: Dictionary, color: Color) -> void:
    wing_id          = data.get("wing_id", "")
    nation_id        = data.get("nation_id", "")
    nation_color     = color
    aircraft_type    = data.get("aircraft_type", "fighter")
    wing_count       = data.get("count", 10)
    combat_readiness = float(data.get("combat_readiness", 1.0))
    lifecycle_state  = data.get("lifecycle_state", "idle")
    _update_visibility()
    queue_redraw()

func update_data(data: Dictionary) -> void:
    wing_count       = data.get("count", wing_count)
    combat_readiness = float(data.get("combat_readiness", combat_readiness))
    lifecycle_state  = data.get("lifecycle_state", lifecycle_state)
    aircraft_type    = data.get("aircraft_type", aircraft_type)
    _update_visibility()
    queue_redraw()

func _update_visibility() -> void:
    visible = lifecycle_state != "idle"

func _readiness_color() -> Color:
    ## Returns green (1.0) → yellow (0.5) → red (0.0) based on combat_readiness.
    if combat_readiness >= 0.7:
        return Color(0.2, 0.85, 0.2)   # green
    elif combat_readiness >= 0.4:
        return Color(0.9, 0.8, 0.1)    # yellow
    else:
        return Color(0.9, 0.2, 0.1)    # red

func _should_show_count_badge() -> bool:
    return wing_count > 1

func set_selected(selected: bool) -> void:
    if is_selected != selected:
        is_selected = selected
        queue_redraw()

func _draw() -> void:
    ## Diamond shape (rotated square) — differentiates from land division rectangles.
    var points := PackedVector2Array([
        Vector2(0, -DIAMOND_HALF),       # top
        Vector2(DIAMOND_HALF, 0),        # right
        Vector2(0, DIAMOND_HALF),        # bottom
        Vector2(-DIAMOND_HALF, 0),       # left
    ])

    # Fill with nation color
    draw_colored_polygon(points, nation_color)

    # Outline: dark border
    draw_polyline(points + PackedVector2Array([points[0]]), Color(0.1, 0.1, 0.1, 0.9), 1.5)

    # Aircraft type symbol inside diamond (simple lines)
    _draw_aircraft_symbol()

    # Selection ring
    if is_selected:
        draw_arc(Vector2.ZERO, DIAMOND_HALF + 7.0, 0, TAU, 32,
                 Color(1.0, 0.78, 0.08, 0.96), 2.0)

    # Readiness bar (below diamond)
    var bar_w := DIAMOND_HALF * 2.0
    var bar_x := -DIAMOND_HALF
    # Background
    draw_rect(Rect2(bar_x, READINESS_BAR_Y, bar_w, READINESS_BAR_H),
              Color(0.2, 0.2, 0.2, 0.8))
    # Fill
    draw_rect(Rect2(bar_x, READINESS_BAR_Y, bar_w * combat_readiness, READINESS_BAR_H),
              _readiness_color())

    # Count badge (top-right of diamond)
    if _should_show_count_badge():
        var badge_pos := Vector2(DIAMOND_HALF - 2.0, -DIAMOND_HALF + 2.0)
        draw_circle(badge_pos, BADGE_RADIUS, Color(1, 1, 1, 0.9))
        draw_string(ThemeDB.fallback_font, badge_pos + Vector2(-3, 4),
                    str(wing_count), HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color(0, 0, 0, 1))

func _draw_aircraft_symbol() -> void:
    ## Minimal wing silhouette: two diagonal lines representing swept wings.
    var c := Color(1, 1, 1, 0.85)
    draw_line(Vector2(-7, 2), Vector2(0, -3), c, 1.5)  # left wing
    draw_line(Vector2(7, 2), Vector2(0, -3), c, 1.5)   # right wing
    draw_line(Vector2(0, -3), Vector2(0, 5), c, 1.0)   # fuselage
```

**File:** `client/scenes/systems/air/air_wing_icon.tscn`

Create a minimal scene with a root `Node2D` node, attach `air_wing_icon.gd` as its script.
No child nodes are needed (all drawing is procedural in `_draw()`). Save as binary `.tscn`.

Pattern to follow: `client/scenes/systems/military/division_icon.tscn` — open it to see
the exact scene format, then replicate for the air wing icon.

---

### STEP 9 — AirWingSystem: Implement

**File:** `client/src/systems/air/air_wing_system.gd`

```gdscript
extends Node

const AIR_WING_ICON_SCENE := preload("res://scenes/systems/air/air_wing_icon.tscn")

## Same nation color dict as MilitarySystem — keep in sync manually until shared.
const NATION_COLORS: Dictionary = {
    "germany":        Color(0.29, 0.29, 0.29),
    "france":         Color(0.0,  0.14, 0.58),
    "united_kingdom": Color(0.0,  0.07, 0.41),
    "italy":          Color(0.0,  0.57, 0.27),
    "spain":          Color(0.78, 0.04, 0.12),
    "algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR := Color(0.45, 0.45, 0.45)
const HIT_THRESHOLD_PX := 20.0

var _map_loader: Node = null
var _icon_layer: Node2D = null
var _icons: Dictionary = {}                # wing_id → AirWingIcon node
var _target_positions: Dictionary = {}     # wing_id → Vector2 (screen space)
var _selected_wing_id: String = ""

func setup(map_loader: Node, icon_layer: Node2D) -> void:
    _map_loader = map_loader
    _icon_layer = icon_layer
    EventBus.air_wing_added.connect(_on_air_wing_added)
    EventBus.air_wing_updated.connect(_on_air_wing_updated)
    EventBus.air_wing_removed.connect(_on_air_wing_removed)
    # Hydrate any wings already in GameState (handles late join / scene reload)
    for wing_id in GameState.air_wings:
        _on_air_wing_added(wing_id)

func _on_air_wing_added(wing_id: String) -> void:
    if _map_loader == null or _icon_layer == null:
        return
    if _icons.has(wing_id):
        _on_air_wing_updated(wing_id)  # dedup guard: treat as update
        return
    var data := GameState.get_air_wing(wing_id)
    if data.is_empty():
        return

    var icon: Node2D = AIR_WING_ICON_SCENE.instantiate()
    var color: Color = NATION_COLORS.get(data.get("nation_id", ""), NEUTRAL_COLOR)
    icon.setup(data, color)
    icon.position = _map_loader.project_lng_lat(
        float(data.get("position_lng", 0.0)),
        float(data.get("position_lat", 0.0))
    )
    _target_positions[wing_id] = icon.position
    _icon_layer.add_child(icon)
    _icons[wing_id] = icon

func _on_air_wing_updated(wing_id: String) -> void:
    var icon = _icons.get(wing_id)
    if icon == null:
        return
    var data := GameState.get_air_wing(wing_id)
    if data.is_empty():
        return
    icon.update_data(data)
    # Snap position to server value (no interpolation in K-stubs — that is Branch C)
    var pos := _map_loader.project_lng_lat(
        float(data.get("position_lng", 0.0)),
        float(data.get("position_lat", 0.0))
    )
    icon.position = pos
    _target_positions[wing_id] = pos

func _on_air_wing_removed(wing_id: String) -> void:
    var icon = _icons.get(wing_id)
    if icon != null:
        icon.queue_free()
        _icons.erase(wing_id)
    _target_positions.erase(wing_id)
    if _selected_wing_id == wing_id:
        _selected_wing_id = ""
        EventBus.air_wing_deselected.emit()

func handle_mouse_input(event: InputEvent, world_pos: Vector2) -> bool:
    ## Returns true if the event was consumed. Called by map_debug.gd input handler.
    if not event is InputEventMouseButton:
        return false
    if not (event as InputEventMouseButton).pressed:
        return false
    if (event as InputEventMouseButton).button_index != MOUSE_BUTTON_LEFT:
        return false

    # Find closest icon within hit threshold
    var best_id := ""
    var best_dist := HIT_THRESHOLD_PX
    for wing_id in _icons:
        var icon = _icons[wing_id]
        if not icon.visible:
            continue
        var dist := icon.position.distance_to(world_pos)
        if dist < best_dist:
            best_dist = dist
            best_id = wing_id

    if best_id.is_empty():
        # Click missed all wings — deselect if something was selected
        if not _selected_wing_id.is_empty():
            _deselect()
        return false

    _select(best_id)
    return true

func _select(wing_id: String) -> void:
    if _selected_wing_id == wing_id:
        return
    _deselect()
    _selected_wing_id = wing_id
    var icon = _icons.get(wing_id)
    if icon != null:
        icon.set_selected(true)
    EventBus.air_wing_selected.emit(wing_id)

func _deselect() -> void:
    if _selected_wing_id.is_empty():
        return
    var icon = _icons.get(_selected_wing_id)
    if icon != null:
        icon.set_selected(false)
    _selected_wing_id = ""
    EventBus.air_wing_deselected.emit()
```

---

### STEP 10 — map_debug.tscn: Add AirWingLayer and AirWingSystem nodes

**File:** `client/scenes/debug/map_debug.tscn`

Open `map_debug.tscn` in Godot editor. Add two new nodes as children of the root `MapDebug`
node, **after** the existing `DivisionLayer` and `MilitarySystem` nodes:

1. `AirWingLayer` — type: `Node2D`, no script. This is the parent container for all air
   wing icon nodes. (Mirrors the existing `DivisionLayer` Node2D.)

2. `AirWingSystem` — type: `Node`, attach script:
   `res://src/systems/air/air_wing_system.gd`. No exported properties; `setup()` is called
   from `map_debug.gd`.

Node order inside the scene (matters for draw order — AirWingLayer after DivisionLayer
means air icons render on top of land icons):

```
MapDebug
├── Camera2D
├── MapLoader
├── MapRenderer
├── MapInteraction
├── CameraSystem
├── MilitarySystem
├── VisionSystem
├── DivisionLayer (Node2D)     ← existing
├── AirWingLayer  (Node2D)     ← NEW: sibling after DivisionLayer
├── AirWingSystem (Node)       ← NEW: sibling after MilitarySystem
├── PauseMenu
└── GameHUD
```

---

### STEP 11 — map_debug.gd: Wire AirWingSystem.setup()

**File:** `client/src/debug/map_debug.gd`

Read the file first. Find where `military_system.setup(...)` is called. Add an analogous
call immediately after it:

```gdscript
# Existing line (do NOT change):
military_system.setup(_map_loader, $DivisionLayer, _vision_system)

# ADD after it:
$AirWingSystem.setup(_map_loader, $AirWingLayer)
```

Also, if `map_debug.gd` has an input handler that calls
`military_system.handle_mouse_input(event, world_pos)`, add an analogous call for air wings.
The air wing handler should be checked BEFORE the division handler (air icons are on top):

```gdscript
func _on_map_input(event: InputEvent) -> void:
    var world_pos: Vector2 = ... # existing world_pos computation
    # Check air wings first (they render on top)
    if $AirWingSystem.handle_mouse_input(event, world_pos):
        return
    # Then divisions
    military_system.handle_mouse_input(event, world_pos)
```

If the existing function has a different name or structure, adapt accordingly — do not
copy-paste blindly. Read the function first.

---

### STEP 12 — Run all server tests

```bash
cd game-server
NODE_ENV=test npx mocha -r tsx test/12a-air-wing-schema.test.ts --exit --timeout 15000
```

Expected: 12 tests passing (11 original + 1 new broadcast test).

---

## Visual Verification Checklist

Run the game server with `DEV_MODE=true npm start` and connect the Godot client. Then send
`SPAWN_WING` messages from a test script or the Godot debug console:

**Check 1 — Icon appears on map:**
- Send: `SPAWN_WING { wing_id: "w1", nation_id: "germany", lifecycle_state: "transit", position_lng: 8.0, position_lat: 50.0, count: 12, combat_readiness: 1.0 }`
- Expected: gray diamond icon appears at roughly central-Germany position on map

**Check 2 — IDLE wing is hidden:**
- Send: `SPAWN_WING { wing_id: "w2", nation_id: "france", lifecycle_state: "idle", position_lng: 2.3, position_lat: 48.9, count: 8, combat_readiness: 0.9 }`
- Expected: no icon appears for w2

**Check 3 — Readiness tint changes:**
- Send three wings with `combat_readiness: 1.0`, `0.55`, `0.2`
- Expected: first icon has green bar, second yellow, third red

**Check 4 — Count badge:**
- Send wing with `count: 1` → no badge
- Send wing with `count: 24` → badge with "24" in top-right of diamond

**Check 5 — Selection:**
- Click a visible wing icon → gold ring appears around it
- Click elsewhere → ring disappears

---

## What K-stubs Does NOT Include

These are explicitly out of scope and belong to later branches:

- Smooth movement / Dubins interpolation → Branch C
- Enemy wings hiding/showing on detection → Branch D  
- Combat crosshairs / destruction animation → Branch E
- Mission assignment UI / panels → Branch K-ui
- Flight path arc overlay → Branch C
- Air Fleet panel → Branch K-ui
- Notification toasts → Branch K-ui
- Stacking wings at strategic zoom (airport-level collapse) → K-ui or later
