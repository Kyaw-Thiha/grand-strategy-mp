# Plan: Phase 6 — Branch K: Tactical Grid UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Save this plan to:** `plans/phase-6-task-k-tactical-grid-ui.md`

**Goal:** Implement the tactical combat UI entry flow for the strategic map. Adds an `EngagementBanner` Node2D that floats between two engaged division icons, shows a tug-of-war HP bar, and opens the `TacticalCombatPanel` on click. The `TacticalCombatPanel` is a full-screen cream overlay showing both opposing 5×5 grids. Also wires `ROUND_RESOLVED` client-side handling for the first time.

---

## ⚠️ Critical Facts — Read Before Starting

### 1. `AttackPatternRegistry` ALREADY EXISTS and is FULLY IMPLEMENTED

**DO NOT create, stub, or overwrite:**
```
client/src/ui/hud/attack_pattern_registry.gd
```

This file has complete implementations of all 8 attack patterns (`_horizontal_targets`, `_flamethrower_targets`, `_armour_column_targets`, `_at_column_targets`, `_sniper_targets`, `_artillery_area_targets`), a full `simulate_round()` with damage/incapacitation logic, and constants `BASE_ATTRITION := 2.5`, `HP_FLOOR_PCT`, `ARMOURED_TARGET_TYPES`.

Verify it exists and confirm its function signatures before writing any code that calls it:
```bash
grep -n "^func\|^static func\|^const" client/src/ui/hud/attack_pattern_registry.gd | head -20
```

### 2. Theme: TacticalCombatPanel uses CREAM, NOT dark

The HUD root has `hud_dark.tres` assigned. TacticalCombatPanel is a child of GameHUD (CanvasLayer) and will inherit this dark theme. You MUST explicitly override it.

- **Cream bg**: `Color(0.92, 0.88, 0.82, 1.0)`
- **Dark ink text**: `Color(0.20, 0.14, 0.06, 1.0)`
- **Brown border**: `Color(0.45, 0.35, 0.22, 1.0)`
- Set `theme = null` on the panel root in `_ready()` to break inheritance, then apply StyleBox overrides manually.

### 3. EngagementBanner lives in world space (Node2D), NOT CanvasLayer

Banner is a `Node2D` added to `_icon_layer` (same parent as division icons), exactly like `MoveOrderOverlay` at `client/src/systems/military/move_order_overlay.gd`. It uses `_draw()` for all visuals and `_input()` for click detection — NOT Godot Control/Button nodes. Position tracks the real-time midpoint of two icon `Node2D.position` values in `_process()`.

### 4. EventBus signals missing on client

These 4 signals do NOT currently exist in `client/src/core/event_bus.gd` and must be added:
- `round_resolved`
- `unit_incapacitated`
- `tactical_combat_opened`
- `tactical_combat_closed`

### 5. ROUND_RESOLVED has no client handler yet

`client/src/systems/session/session_manager.gd` handles many server messages but NOT `ROUND_RESOLVED`. The `COMBAT_RESULT` case is already reserved with `pass`. Add `ROUND_RESOLVED` as a new case that emits `EventBus.round_resolved`.

---

## Existing Files — DO NOT Recreate

| File | Notes |
|------|-------|
| `client/src/ui/hud/attack_pattern_registry.gd` | **FULLY IMPLEMENTED** — all patterns + `simulate_round()` |
| `client/src/core/event_bus.gd` | Add 4 signals only |
| `client/src/systems/session/session_manager.gd` | Add ROUND_RESOLVED case only |
| `client/src/systems/military/military_system.gd` | Add banner lifecycle (spawn/despawn) |
| `client/src/systems/military/division_icon.gd` | Reference for `.position` — DO NOT MODIFY |
| `client/src/systems/military/move_order_overlay.gd` | **Pattern reference** for Node2D floating UI |
| `client/src/ui/hud/game_hud.gd` | Add panel instantiation only |

## Files to Create

| File | Description |
|------|-------------|
| `client/src/systems/military/engagement_banner.gd` | Floating tug-of-war banner in map space |
| `client/scenes/systems/military/engagement_banner.tscn` | Node2D root, no child nodes |
| `client/src/ui/hud/tactical_combat_panel.gd` | Full-screen cream overlay |
| `client/scenes/game/panels/tactical_combat_panel.tscn` | PanelContainer root |
| `client/src/ui/hud/grid_cell.gd` | Single 5×5 grid cell |
| `client/scenes/game/panels/grid_cell.tscn` | PanelContainer with VBox layout |
| `client/test/gut/test_event_bus_signals.gd` | GUT: signal existence |
| `client/test/gut/test_engagement_banner.gd` | GUT: banner HP logic |
| `client/test/gut/test_tactical_combat_panel.gd` | GUT: panel lifecycle + theme |

---

## Visual Design

### EngagementBanner on Strategic Map

```
      [FRANCE DIV ●]                    [GERMANY DIV ●]
           │                                  │
           └──────────────────────────────────┘
                             ↑ midpoint − 30 px (Y offset upward)

      ┌──────────────────────────────────────────────┐
      │  [████████░░]   ⚔   [░░░░░░░░████████████]  │
      │    ATK HP %            DEF HP %              │
      └──────────────────────────────────────────────┘
              160 px × 28 px, cream bg, 2 px border
              AMBER PULSING border when suppression warning
```

**Sizes (in Node2D local units matching icon pixel scale):**
- Banner: 160 wide × 28 tall, centred on `position`
- Left HP bar: 60 wide × 10 tall (attacker)
- Center ⚔ clickable zone: 20 × 20, centred at (0, 0)
- Right HP bar: 60 wide × 10 tall (defender)
- Y offset from midpoint: -30 (above line connecting icons)

**Colors:**
- Background: `Color(0.92, 0.88, 0.82, 0.92)` (cream, slight alpha)
- Border normal: `Color(0.45, 0.35, 0.22, 1.0)` (dark brown)
- Border amber pulse: `Color(0.85, 0.55, 0.10, 1.0)` — alpha oscillates 0.6–1.0 at 2 Hz
- Bar fill (green): `Color(0.30, 0.65, 0.35, 1.0)`
- Bar empty (shadow): `Color(0.75, 0.70, 0.63, 1.0)`
- ⚔ glyph: `Color(0.25, 0.18, 0.08, 1.0)` (dark ink)

**Suppression warning thresholds:**
- Attacker HP < 20% → amber pulse
- Defender HP < 40% → amber pulse
(HP expressed as 0.0–1.0 fraction from `GameState.get_division().hp / 100.0`)

### TacticalCombatPanel (FULL_CENTER overlay)

```
╔══════════════════════════════════════════════════════════════════════╗
║  [✕]           TACTICAL COMBAT — Round 3  [LETHALITY]              ║
╠══════════════════════════════════════════════════════════════════════╣
║  France IV Division                   Germany 2nd Armour            ║
║                                                                      ║
║  ATTACKER                                  DEFENDER                  ║
║  (Row 4 = front, top)                      (Row 4 = front, top)     ║
║                                                                      ║
║  ┌────┬────┬────┬────┬────┐     ┌────┬────┬────┬────┬────┐         ║
║  │ IN │    │ MG │    │ IN │     │ TK │ TK │    │ AT │    │  ROW 4  ║
║  │▓▓░ │    │▓▓▓ │    │▓▓▓ │     │░░░ │▓▓░ │    │▓▓░ │    │ (front) ║
║  ├────┼────┼────┼────┼────┤     ├────┼────┼────┼────┼────┤         ║
║  │    │ IN │    │ IN │    │     │    │    │ TK │    │    │  ROW 3  ║
║  │    │▓▓▓ │    │▓▓░ │    │     │    │    │░░░ │    │    │         ║
║  ├────┼────┼────┼────┼────┤     ├────┼────┼────┼────┼────┤         ║
║  │ SN │    │    │    │ AR │     │    │    │    │    │    │  ROW 2  ║
║  │▓▓▓ │    │    │    │▓░░ │     │    │    │    │    │    │         ║
║  ├────┼────┼────┼────┼────┤     ├────┼────┼────┼────┼────┤         ║
║  │    │ AT │    │ AT │    │     │    │    │    │    │    │  ROW 1  ║
║  │    │▓▓░ │    │▓▓░ │    │     │    │    │    │    │    │         ║
║  ├────┼────┼────┼────┼────┤     ├────┼────┼────┼────┼────┤         ║
║  │ HQ │    │    │    │    │     │ HQ │    │    │    │    │  ROW 0  ║
║  │▓░░ │    │    │    │    │     │▓░░ │    │    │    │    │  (rear) ║
║  └────┴────┴────┴────┴────┘     └────┴────┴────┴────┴────┘         ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║   [WITHDRAW]           Round 3 of 10           [COMMIT]             ║
╚══════════════════════════════════════════════════════════════════════╝
```

**Key layout notes:**
- Row 4 (front/vanguard) is shown at TOP of the grid
- Row 0 (rear/HQ) is shown at BOTTOM
- Child index mapping: `child_idx = (4 - row) * 5 + col` (row=idx/5, col=idx%5)
- Each GridCell: approximately 72×72 px, 1 px brown border
- `▓▓▓` = HP bar (green, bottom of cell), `░░` = suppression bar (amber, above HP bar)

**GridCell color states (background):**
```
Empty cell:       Color(0.88, 0.83, 0.76, 1.0)   ← lightest cream
Occupied:         Color(0.78, 0.73, 0.65, 1.0)   ← slightly darker cream
Suppressed:       Color(0.80, 0.72, 0.55, 1.0)   ← amber tint (>50% suppression)
Incapacitated:    Color(0.68, 0.62, 0.58, 1.0)   ← gray tint
Stealthed:        Color(0.55, 0.62, 0.55, 1.0)   ← muted green tint
```

**Unit abbreviations for GridCell label:**
```
infantry → IN    commando → CM    recon_infantry → RC    sniper → SN
flamethrower → FL    mg → MG    at_gun → AT    at_gun_sp → SP
aa_gun → AA    artillery → AR    mortar → MO
light_tank → LT    medium_tank → MT    heavy_tank → HT    armoured_car → AC
```

---

## Task 1: EventBus signals (RED → GREEN)

- [ ] **Step 1 — Write GUT test for missing signals**

Create `client/test/gut/test_event_bus_signals.gd`:

```gdscript
extends GutTest

func test_round_resolved_signal_exists() -> void:
    assert_true(EventBus.has_signal("round_resolved"), "round_resolved must exist")

func test_unit_incapacitated_signal_exists() -> void:
    assert_true(EventBus.has_signal("unit_incapacitated"), "unit_incapacitated must exist")

func test_tactical_combat_opened_signal_exists() -> void:
    assert_true(EventBus.has_signal("tactical_combat_opened"), "tactical_combat_opened must exist")

func test_tactical_combat_closed_signal_exists() -> void:
    assert_true(EventBus.has_signal("tactical_combat_closed"), "tactical_combat_closed must exist")
```

- [ ] **Step 2 — Run GUT → expect RED (4 failures)**

- [ ] **Step 3 — Add signals to `client/src/core/event_bus.gd`**

After the existing military signals block (the block ending with `signal rear_attack`), add:

```gdscript
# Tactical combat UI signals
signal round_resolved(engagement_id: String, round_number: int, lethality_phase: bool, attacker_grid_delta: Array, defender_grid_delta: Array, formation_bonuses_active: bool)
signal unit_incapacitated(division_id: String, cell_index: int)
signal tactical_combat_opened(engagement_id: String)
signal tactical_combat_closed()
```

- [ ] **Step 4 — Run GUT → expect GREEN (4 passing)**

- [ ] **Step 5 — Add ROUND_RESOLVED handler and wire COMBAT_ENDED → combat_resolved in `session_manager.gd`**

Find `_on_server_event()` (lines 14–96). Make two changes in the `match` block:

**5a.** Add a new `"ROUND_RESOLVED"` case **before** the existing `"COMBAT_RESULT"` case:

```gdscript
"ROUND_RESOLVED":
    var eng_id: String   = data.get("engagement_id", "")
    var rn: int          = data.get("round_number", 0)
    var lp: bool         = data.get("lethality_phase", false)
    var atk_delta: Array = data.get("attacker_grid_delta", [])
    var def_delta: Array = data.get("defender_grid_delta", [])
    var fb: bool         = data.get("formation_bonuses_active", false)
    EventBus.round_resolved.emit(eng_id, rn, lp, atk_delta, def_delta, fb)
```

**5b.** In the **existing** `"COMBAT_ENDED"` case (lines 56–63), append one line after the existing
`division_updated` emit so that `combat_resolved` fires and banners can clean up.
The COMBAT_ENDED data dict has keys `winner_id` and `retreated_id` (confirmed from codebase).

```gdscript
# Append inside the "COMBAT_ENDED": block, after the existing EventBus.division_updated line:
EventBus.combat_resolved.emit("", {"winner_id": winner_id, "retreated_id": retreated_id})
```

- [ ] **Step 6 — Commit**

```bash
git add client/src/core/event_bus.gd client/src/systems/session/session_manager.gd client/test/gut/test_event_bus_signals.gd
git commit -m "feat: add tactical combat EventBus signals, ROUND_RESOLVED handler, and combat_resolved emit on COMBAT_ENDED"
```

---

## Task 2: EngagementBanner (RED → GREEN)

The banner is a Node2D in world/map space. It uses `_draw()` for all visuals and `_input()` for click detection. No Control child nodes.

- [ ] **Step 7 — Write GUT tests**

Create `client/test/gut/test_engagement_banner.gd`:

```gdscript
extends GutTest

var _banner: Node2D

func before_each() -> void:
    _banner = preload("res://scenes/systems/military/engagement_banner.tscn").instantiate()
    add_child_autofree(_banner)

func test_banner_has_setup_method() -> void:
    assert_true(_banner.has_method("setup"), "must have setup()")

func test_banner_has_update_hp_method() -> void:
    assert_true(_banner.has_method("update_hp"), "must have update_hp()")

func test_initial_hp_is_fifty_fifty() -> void:
    assert_almost_eq(_banner.get_atk_hp_pct(), 0.5, 0.001, "default atk HP = 0.5")
    assert_almost_eq(_banner.get_def_hp_pct(), 0.5, 0.001, "default def HP = 0.5")

func test_update_hp_clamps_to_valid_range() -> void:
    _banner.update_hp(1.5, -0.2)
    assert_almost_eq(_banner.get_atk_hp_pct(), 1.0, 0.001, "atk HP clamped to 1.0")
    assert_almost_eq(_banner.get_def_hp_pct(), 0.0, 0.001, "def HP clamped to 0.0")

func test_suppression_warning_when_def_hp_below_40_pct() -> void:
    _banner.update_hp(0.90, 0.35)
    assert_true(_banner.get_suppression_warning(), "amber warning when def HP < 40%")

func test_suppression_warning_when_atk_hp_below_20_pct() -> void:
    _banner.update_hp(0.15, 0.80)
    assert_true(_banner.get_suppression_warning(), "amber warning when atk HP < 20%")

func test_no_warning_when_both_hp_healthy() -> void:
    _banner.update_hp(0.75, 0.75)
    assert_false(_banner.get_suppression_warning(), "no warning when both HP healthy")

func test_banner_has_cleanup_method() -> void:
    assert_true(_banner.has_method("cleanup"), "must have cleanup() for signal disconnection")
```

- [ ] **Step 8 — Run GUT → expect RED (scene not found)**

- [ ] **Step 9 — Create `client/scenes/systems/military/engagement_banner.tscn`**

Scene root: `Node2D` named `EngagementBanner`, script: `engagement_banner.gd`. No child nodes — all rendering via `_draw()`. The .tscn only needs the root node + script reference.

- [ ] **Step 10 — Create `client/src/systems/military/engagement_banner.gd`**

```gdscript
extends Node2D

# ── Public readable state ──────────────────────────────────────────
var _engagement_id:    String     = ""
var _div_a_id:         String     = ""
var _div_b_id:         String     = ""
var _atk_hp_pct:       float      = 0.5
var _def_hp_pct:       float      = 0.5
var _suppression_warn: bool       = false
var _icons:            Dictionary = {}

# ── Pulse animation state ──────────────────────────────────────────
var _pulse_alpha: float = 1.0
var _pulse_dir:   float = -1.0

# ── Layout constants ───────────────────────────────────────────────
const BANNER_W:   float = 160.0
const BANNER_H:   float = 28.0
const BAR_W:      float = 60.0
const BAR_H:      float = 10.0
const SWORD_ZONE: float = 20.0   # clickable zone half-size from centre
const OFFSET_Y:   float = -30.0  # pixels above midpoint

# ── Suppression warning thresholds ────────────────────────────────
const ATK_WARN_HP: float = 0.20
const DEF_WARN_HP: float = 0.40

# ── Colors ────────────────────────────────────────────────────────
const C_BG:        Color = Color(0.92, 0.88, 0.82, 0.92)
const C_BORDER:    Color = Color(0.45, 0.35, 0.22, 1.0)
const C_AMBER:     Color = Color(0.85, 0.55, 0.10, 1.0)
const C_BAR_FILL:  Color = Color(0.30, 0.65, 0.35, 1.0)
const C_BAR_EMPTY: Color = Color(0.75, 0.70, 0.63, 1.0)
const C_SWORD:     Color = Color(0.25, 0.18, 0.08, 1.0)

# ── Public API ────────────────────────────────────────────────────

func setup(div_a: String, div_b: String, icon_dict: Dictionary, eng_id: String) -> void:
    _div_a_id      = div_a
    _div_b_id      = div_b
    _icons         = icon_dict
    _engagement_id = eng_id
    EventBus.division_updated.connect(_on_division_updated)
    EventBus.round_resolved.connect(_on_round_resolved)

func get_atk_hp_pct()        -> float: return _atk_hp_pct
func get_def_hp_pct()        -> float: return _def_hp_pct
func get_suppression_warning()-> bool:  return _suppression_warn

func update_hp(atk: float, def_pct: float) -> void:
    _atk_hp_pct       = clamp(atk,     0.0, 1.0)
    _def_hp_pct       = clamp(def_pct, 0.0, 1.0)
    _suppression_warn = _atk_hp_pct < ATK_WARN_HP or _def_hp_pct < DEF_WARN_HP
    queue_redraw()

func cleanup() -> void:
    if EventBus.division_updated.is_connected(_on_division_updated):
        EventBus.division_updated.disconnect(_on_division_updated)
    if EventBus.round_resolved.is_connected(_on_round_resolved):
        EventBus.round_resolved.disconnect(_on_round_resolved)
    queue_free()

# ── Godot callbacks ───────────────────────────────────────────────

func _process(delta: float) -> void:
    # Track midpoint between the two division icons
    if _icons.has(_div_a_id) and _icons.has(_div_b_id):
        var pa: Vector2 = _icons[_div_a_id].position
        var pb: Vector2 = _icons[_div_b_id].position
        position = (pa + pb) * 0.5 + Vector2(0.0, OFFSET_Y)

    # Amber pulse animation
    if _suppression_warn:
        _pulse_alpha += _pulse_dir * delta * 2.0
        if _pulse_alpha <= 0.6:
            _pulse_alpha = 0.6
            _pulse_dir   = 1.0
        elif _pulse_alpha >= 1.0:
            _pulse_alpha = 1.0
            _pulse_dir   = -1.0
        queue_redraw()

func _draw() -> void:
    var hw := BANNER_W * 0.5
    var hh := BANNER_H * 0.5

    # Background
    draw_rect(Rect2(Vector2(-hw, -hh), Vector2(BANNER_W, BANNER_H)), C_BG)

    # Border
    var border := C_AMBER if _suppression_warn else C_BORDER
    if _suppression_warn:
        border.a = _pulse_alpha
    draw_rect(Rect2(Vector2(-hw, -hh), Vector2(BANNER_W, BANNER_H)), border, false, 2.0)

    # Attacker HP bar — left of centre sword zone
    var bar_y  := -BAR_H * 0.5
    var atk_x  := -hw + 8.0
    draw_rect(Rect2(Vector2(atk_x, bar_y), Vector2(BAR_W, BAR_H)), C_BAR_EMPTY)
    draw_rect(Rect2(Vector2(atk_x, bar_y), Vector2(BAR_W * _atk_hp_pct, BAR_H)), C_BAR_FILL)

    # Defender HP bar — right of centre sword zone
    var def_x := SWORD_ZONE * 0.5 + 4.0
    draw_rect(Rect2(Vector2(def_x, bar_y), Vector2(BAR_W, BAR_H)), C_BAR_EMPTY)
    draw_rect(Rect2(Vector2(def_x, bar_y), Vector2(BAR_W * _def_hp_pct, BAR_H)), C_BAR_FILL)

    # ⚔ centre glyph
    draw_string(ThemeDB.fallback_font, Vector2(-6.0, 6.0), "⚔",
        HORIZONTAL_ALIGNMENT_LEFT, -1, 14, C_SWORD)

func _input(event: InputEvent) -> void:
    if not (event is InputEventMouseButton):
        return
    if not event.pressed or event.button_index != MOUSE_BUTTON_LEFT:
        return
    # Convert viewport mouse position to this node's local space
    var local := to_local(get_global_mouse_position())
    var zone  := Rect2(
        Vector2(-SWORD_ZONE * 0.5, -SWORD_ZONE * 0.5),
        Vector2(SWORD_ZONE, SWORD_ZONE)
    )
    if zone.has_point(local):
        EventBus.tactical_combat_opened.emit(_engagement_id)
        get_viewport().set_input_as_handled()

# ── Signal handlers ───────────────────────────────────────────────

func _on_division_updated(div_id: String) -> void:
    if div_id == _div_a_id or div_id == _div_b_id:
        _refresh_hp()

func _on_round_resolved(eng_id: String, _rn: int, _lp: bool,
                        _ad: Array, _dd: Array, _fb: bool) -> void:
    # Server engagement_id format: "divA_vs_divB_<timestamp>"
    if (eng_id.begins_with(_div_a_id + "_vs_" + _div_b_id) or
        eng_id.begins_with(_div_b_id + "_vs_" + _div_a_id)):
        _refresh_hp()

func _refresh_hp() -> void:
    var div_a = GameState.get_division(_div_a_id)
    var div_b = GameState.get_division(_div_b_id)
    if div_a == null or div_b == null:
        return
    # GameState returns Dictionary — confirm method name matches game_state.gd
    var hp_a := float(div_a.get("hp", 100)) / 100.0
    var hp_b := float(div_b.get("hp", 100)) / 100.0
    update_hp(hp_a, hp_b)
```

**NOTE FOR EXECUTOR:** Confirm `GameState.get_division(id)` exists and returns a Dictionary by checking `client/src/core/game_state.gd`. If the method is named differently (e.g. `divisions.get(id)`, `get_division_data(id)`), update all calls accordingly.

- [ ] **Step 11 — Run GUT → expect GREEN (8 passing)**

- [ ] **Step 12 — Commit**

```bash
git add client/src/systems/military/engagement_banner.gd client/scenes/systems/military/engagement_banner.tscn client/test/gut/test_engagement_banner.gd
git commit -m "feat: add EngagementBanner floating map overlay with tug-of-war HP display"
```

---

## Task 3: MilitarySystem banner lifecycle

- [ ] **Step 13 — Modify `client/src/systems/military/military_system.gd`**

**3a.** Add scene preload near `DIVISION_ICON_SCENE` (around line 5):

```gdscript
const ENGAGEMENT_BANNER_SCENE := preload("res://scenes/systems/military/engagement_banner.tscn")
```

**3b.** Add banner dictionary near `_icons` declaration (around line 46):

```gdscript
var _banners: Dictionary = {}  # engagement_key → EngagementBanner node
```

**3c.** Connect signals in `setup()` **after line 138** (where the other EventBus connections are — `military_system.gd` has no `_ready()`; all connections go in `setup()`):

```gdscript
EventBus.combat_started.connect(_on_combat_started_banner)
EventBus.combat_resolved.connect(_on_combat_resolved_banner)
```

**3d.** Add handler methods at the bottom of the file:

```gdscript
func _on_combat_started_banner(division_a: String, division_b: String, _is_meeting: bool) -> void:
    var eng_key := division_a + "_vs_" + division_b
    if _banners.has(eng_key):
        return
    if not _icons.has(division_a) or not _icons.has(division_b):
        return
    var banner: Node2D = ENGAGEMENT_BANNER_SCENE.instantiate()
    _icon_layer.add_child(banner)
    banner.setup(division_a, division_b, _icons, eng_key)
    _banners[eng_key] = banner

func _on_combat_resolved_banner(_province_id: String, outcome: Dictionary) -> void:
    # outcome dict keys confirmed from COMBAT_ENDED handler: winner_id, retreated_id
    var div_a: String = str(outcome.get("winner_id", ""))
    var div_b: String = str(outcome.get("retreated_id", ""))
    for key in [div_a + "_vs_" + div_b, div_b + "_vs_" + div_a]:
        if _banners.has(key):
            _banners[key].cleanup()
            _banners.erase(key)
            return
```

**Note:** `outcome` dict keys are `winner_id` and `retreated_id` — confirmed from `session_manager.gd` COMBAT_ENDED handler.

- [ ] **Step 14 — Commit**

```bash
git add client/src/systems/military/military_system.gd
git commit -m "feat: MilitarySystem spawns/despawns EngagementBanner on combat lifecycle signals"
```

---

## Task 4: GridCell

- [ ] **Step 15 — Create `client/scenes/game/panels/grid_cell.tscn`**

Scene tree:
```
GridCell (PanelContainer)              ← root, script: grid_cell.gd
                                         custom_minimum_size = Vector2(72, 72)
  └── VBoxContainer                    ← size_flags: EXPAND_FILL both axes
        ├── UnitLabel   (Label)        ← centred, font_size 11, expand/fill horizontal
        └── BarsBox     (VBoxContainer)← anchored at bottom of cell
              ├── SuppBar (ColorRect)  ← amber, height 4, hidden when supp = 0
              └── HpBar   (ColorRect)  ← green, height 6
```

- [ ] **Step 16 — Create `client/src/ui/hud/grid_cell.gd`**

```gdscript
extends PanelContainer

@onready var _unit_label: Label     = $VBoxContainer/UnitLabel
@onready var _hp_bar:     ColorRect = $VBoxContainer/BarsBox/HpBar
@onready var _supp_bar:   ColorRect = $VBoxContainer/BarsBox/SuppBar

const ABBREV: Dictionary = {
    "infantry": "IN", "commando": "CM", "recon_infantry": "RC", "sniper": "SN",
    "flamethrower": "FL", "mg": "MG", "at_gun": "AT", "at_gun_sp": "SP",
    "aa_gun": "AA", "artillery": "AR", "mortar": "MO",
    "light_tank": "LT", "medium_tank": "MT", "heavy_tank": "HT", "armoured_car": "AC",
}

const C_EMPTY:    Color = Color(0.88, 0.83, 0.76, 1.0)
const C_OCCUPY:   Color = Color(0.78, 0.73, 0.65, 1.0)
const C_SUPP_BG:  Color = Color(0.80, 0.72, 0.55, 1.0)
const C_INCAP:    Color = Color(0.68, 0.62, 0.58, 1.0)
const C_STEALTH:  Color = Color(0.55, 0.62, 0.55, 1.0)
const C_HP_BAR:   Color = Color(0.30, 0.65, 0.35, 1.0)
const C_SUPP_BAR: Color = Color(0.85, 0.55, 0.10, 1.0)
const C_BORDER:   Color = Color(0.45, 0.35, 0.22, 1.0)
const C_TEXT:     Color = Color(0.20, 0.14, 0.06, 1.0)
const MAX_BAR_W:  float = 60.0

func display(cell_data: Dictionary) -> void:
    var utype:    String = cell_data.get("unit_type", "")
    var hp_pct:   float  = cell_data.get("hp", 100.0) / 100.0
    var supp_pct: float  = cell_data.get("suppression", 0.0) / 100.0
    var incap:    bool   = cell_data.get("incapacitated", false)
    var stealth:  bool   = cell_data.get("stealthed", false)

    _unit_label.text = ABBREV.get(utype, utype.left(2).to_upper() if utype != "" else "")
    _unit_label.add_theme_color_override("font_color", C_TEXT)

    var bg_color: Color
    if utype == "":       bg_color = C_EMPTY
    elif incap:           bg_color = C_INCAP
    elif stealth:         bg_color = C_STEALTH
    elif supp_pct > 0.5:  bg_color = C_SUPP_BG
    else:                 bg_color = C_OCCUPY

    var style := StyleBoxFlat.new()
    style.bg_color = bg_color
    style.set_border_width_all(1)
    style.border_color = C_BORDER
    add_theme_stylebox_override("panel", style)

    _hp_bar.color = C_HP_BAR
    _hp_bar.custom_minimum_size.x = max(2.0, hp_pct * MAX_BAR_W)

    _supp_bar.color = C_SUPP_BAR
    _supp_bar.custom_minimum_size.x = max(0.0, supp_pct * MAX_BAR_W)
    _supp_bar.visible = supp_pct > 0.02
```

- [ ] **Step 17 — Commit**

```bash
git add client/src/ui/hud/grid_cell.gd client/scenes/game/panels/grid_cell.tscn
git commit -m "feat: add GridCell scene for tactical grid cell display"
```

---

## Task 5: TacticalCombatPanel

⚠️ **DO NOT touch `attack_pattern_registry.gd`** — it is complete. No stub, no overwrite.

- [ ] **Step 18 — Write GUT tests**

Create `client/test/gut/test_tactical_combat_panel.gd`:

```gdscript
extends GutTest

var _panel: Control

func before_each() -> void:
    _panel = preload("res://scenes/game/panels/tactical_combat_panel.tscn").instantiate()
    add_child_autofree(_panel)

func test_panel_has_setup_engagement_method() -> void:
    assert_true(_panel.has_method("setup_engagement"), "must have setup_engagement()")

func test_panel_starts_hidden() -> void:
    assert_false(_panel.visible, "panel must start hidden")

func test_panel_bg_is_cream_not_dark() -> void:
    var style = _panel.get_theme_stylebox("panel")
    if style is StyleBoxFlat:
        assert_true(style.bg_color.r > 0.85, "red > 0.85 (cream, not dark)")
        assert_true(style.bg_color.g > 0.80, "green > 0.80 (cream, not dark)")
        assert_true(style.bg_color.b > 0.75, "blue > 0.75 (cream, not dark)")
    else:
        fail("panel must have StyleBoxFlat with cream bg applied in _ready()")

func test_attacker_grid_exists() -> void:
    assert_not_null(_panel.get_node_or_null("PanelContent/GridRow/AttackerGrid"),
        "AttackerGrid must exist")

func test_defender_grid_exists() -> void:
    assert_not_null(_panel.get_node_or_null("PanelContent/GridRow/DefenderGrid"),
        "DefenderGrid must exist")

func test_tactical_combat_opened_shows_panel() -> void:
    EventBus.tactical_combat_opened.emit("div-a_vs_div-b")
    await get_tree().process_frame
    assert_true(_panel.visible, "panel shows on tactical_combat_opened")

func test_tactical_combat_closed_hides_panel() -> void:
    EventBus.tactical_combat_opened.emit("div-a_vs_div-b")
    await get_tree().process_frame
    EventBus.tactical_combat_closed.emit()
    await get_tree().process_frame
    assert_false(_panel.visible, "panel hides on tactical_combat_closed")

func test_attacker_grid_has_25_cells() -> void:
    var grid = _panel.get_node_or_null("PanelContent/GridRow/AttackerGrid")
    if grid != null:
        assert_eq(grid.get_child_count(), 25, "AttackerGrid must have 25 GridCell children")
```

- [ ] **Step 19 — Run GUT → expect RED**

- [ ] **Step 20 — Create `client/scenes/game/panels/tactical_combat_panel.tscn`**

Scene tree:
```
TacticalCombatPanel (PanelContainer)   ← root, script: tactical_combat_panel.gd
                                         visible: false
                                         anchor_left=0, anchor_top=0
                                         anchor_right=1, anchor_bottom=1
                                         NO theme assigned in .tscn (leave blank)
  └── VBoxContainer  (name: PanelContent)
        ├── HeaderRow (HBoxContainer)
        │     ├── CloseButton       (Button)  ← text "✕"
        │     ├── TitleLabel        (Label)   ← "TACTICAL COMBAT", expand/fill
        │     └── RoundLabel        (Label)   ← "Round –", align right
        ├── SubtitleRow (HBoxContainer)
        │     ├── AttackerNameLabel (Label)   ← expand/fill
        │     └── DefenderNameLabel (Label)   ← expand/fill, align right
        ├── GridRow (HBoxContainer)            ← size_flags: EXPAND_FILL vertical
        │     ├── AttackerGrid (GridContainer, columns=5)  ← expand/fill
        │     └── DefenderGrid (GridContainer, columns=5)  ← expand/fill
        └── EscalationStrip (HBoxContainer)
              ├── WithdrawButton (Button)      ← "WITHDRAW"
              ├── EscLabel       (Label)       ← expand/fill, centred
              └── CommitButton   (Button)      ← "COMMIT"
```

**Do NOT assign `hud_dark.tres` as theme.** Leave Theme property blank in the .tscn inspector.

- [ ] **Step 21 — Create `client/src/ui/hud/tactical_combat_panel.gd`**

```gdscript
extends PanelContainer

const GRID_CELL := preload("res://scenes/game/panels/grid_cell.tscn")

@onready var _title_label:  Label         = $PanelContent/HeaderRow/TitleLabel
@onready var _round_label:  Label         = $PanelContent/HeaderRow/RoundLabel
@onready var _atk_name:     Label         = $PanelContent/SubtitleRow/AttackerNameLabel
@onready var _def_name:     Label         = $PanelContent/SubtitleRow/DefenderNameLabel
@onready var _atk_grid:     GridContainer = $PanelContent/GridRow/AttackerGrid
@onready var _def_grid:     GridContainer = $PanelContent/GridRow/DefenderGrid
@onready var _esc_label:    Label         = $PanelContent/EscalationStrip/EscLabel
@onready var _close_btn:    Button        = $PanelContent/HeaderRow/CloseButton

const C_BG:     Color = Color(0.92, 0.88, 0.82, 1.0)
const C_BORDER: Color = Color(0.45, 0.35, 0.22, 1.0)
const C_TEXT:   Color = Color(0.20, 0.14, 0.06, 1.0)

var _engagement_id: String = ""

func _ready() -> void:
    hide()

    # Block all map clicks from passing through the panel
    mouse_filter = MOUSE_FILTER_STOP

    # Break theme inheritance from GameHUD (which uses hud_dark.tres)
    theme = null
    _apply_cream_style()
    _tint_all_labels()

    _build_grid(_atk_grid)
    _build_grid(_def_grid)

    _close_btn.pressed.connect(func(): EventBus.tactical_combat_closed.emit())
    EventBus.tactical_combat_opened.connect(_on_opened)
    EventBus.tactical_combat_closed.connect(_on_closed)
    EventBus.round_resolved.connect(_on_round_resolved)

func setup_engagement(eng_id: String, atk_name: String, def_name: String) -> void:
    _engagement_id = eng_id
    _atk_name.text = atk_name
    _def_name.text = def_name

func _apply_cream_style() -> void:
    var s := StyleBoxFlat.new()
    s.bg_color = C_BG
    s.border_color = C_BORDER
    s.set_border_width_all(3)
    s.set_corner_radius_all(4)
    add_theme_stylebox_override("panel", s)

func _tint_all_labels() -> void:
    for lbl in [_title_label, _round_label, _atk_name, _def_name, _esc_label]:
        if lbl != null:
            lbl.add_theme_color_override("font_color", C_TEXT)

func _build_grid(grid: GridContainer) -> void:
    grid.columns = 5
    for _i in range(25):
        var cell = GRID_CELL.instantiate()
        grid.add_child(cell)
        cell.display({})  # empty cell

func _on_opened(eng_id: String) -> void:
    _engagement_id = eng_id
    _refresh_from_game_state()
    show()

func _on_closed() -> void:
    hide()

func _on_round_resolved(eng_id: String, rn: int, lp: bool,
                        atk_delta: Array, def_delta: Array, _fb: bool) -> void:
    if eng_id != _engagement_id:
        return
    _round_label.text = "Round %d%s" % [rn, "  [LETHALITY]" if lp else ""]
    _apply_grid_deltas(_atk_grid, atk_delta)
    _apply_grid_deltas(_def_grid, def_delta)

func _apply_grid_deltas(grid: GridContainer, deltas: Array) -> void:
    for delta in deltas:
        var idx: int = int(delta.get("cell_index", -1))
        if idx < 0 or idx >= 25:
            continue
        # Row 4 (front) at top → child_idx 0–4; Row 0 (rear) at bottom → child_idx 20–24
        var row: int    = idx / 5
        var col: int    = idx % 5
        var child_i:int = (4 - row) * 5 + col
        var cell_node   = grid.get_child(child_i)
        if cell_node and cell_node.has_method("display"):
            cell_node.display(delta)

func _refresh_from_game_state() -> void:
    # Derive division IDs from engagement_id ("divA_vs_divB_…")
    var parts := _engagement_id.split("_vs_")
    if parts.size() < 2:
        return
    var div_a_id := parts[0]
    var div_b_id := parts[1].split("_")[0]  # strip any trailing _<timestamp>

    var div_a = GameState.get_division(div_a_id)
    var div_b = GameState.get_division(div_b_id)
    if div_a:
        # GameState division dict has no "name" field — use division_id as display label
        _atk_name.text = div_a_id
        _load_grid_from_division(_atk_grid, div_a)
    if div_b:
        _def_name.text = div_b_id
        _load_grid_from_division(_def_grid, div_b)

func _load_grid_from_division(grid: GridContainer, div_data: Dictionary) -> void:
    var cells: Array = div_data.get("grid", {}).get("cells", [])
    for idx in range(min(cells.size(), 25)):
        var row: int    = idx / 5
        var col: int    = idx % 5
        var child_i:int = (4 - row) * 5 + col
        var cell_node   = grid.get_child(child_i)
        var cell_data   = cells[idx] if cells[idx] is Dictionary else {}
        if cell_node and cell_node.has_method("display"):
            cell_node.display(cell_data)
```

**NOTE FOR EXECUTOR:** If `GameState.get_division()` returns a Colyseus schema object (not a plain Dictionary), adapt `.get("key", default)` calls to attribute access or `.to_dict()`. Check `division_icon.gd`'s `update_data()` method to see the actual format.

- [ ] **Step 22 — Run GUT → expect GREEN (8 passing)**

- [ ] **Step 23 — Commit**

```bash
git add client/src/ui/hud/tactical_combat_panel.gd client/scenes/game/panels/tactical_combat_panel.tscn client/test/gut/test_tactical_combat_panel.gd
git commit -m "feat: add TacticalCombatPanel with cream theme, dual 5x5 grids, round display"
```

---

## Task 6: GameHUD registration

- [ ] **Step 24 — Add panel to `game_hud.gd`**

The `TacticalCombatPanel` manages its own visibility via EventBus — do NOT register it through `HUDManager`. Add it directly as a child of the GameHUD CanvasLayer so it overlays the entire HUD.

In `_ready()`, after the existing dynamic panel instantiation blocks (around line 131):

```gdscript
# TacticalCombatPanel — self-manages visibility via EventBus signals
var _tcp_scene := preload("res://scenes/game/panels/tactical_combat_panel.tscn")
var _tactical_combat_panel: Control = _tcp_scene.instantiate()
add_child(_tactical_combat_panel)
# Anchors to full rect are set in the .tscn — no position code needed here

# Deselect map state when panel opens (mirrors division_builder_open_requested pattern)
EventBus.tactical_combat_opened.connect(func(_eng_id: String) -> void:
    if _military_system != null and _military_system.has_method("deselect"):
        _military_system.deselect()
    if _map_interaction != null and _map_interaction.has_method("deselect"):
        _map_interaction.deselect()
    if _map_renderer != null and _map_renderer.has_method("clear_highlights"):
        _map_renderer.clear_highlights()
    if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
        _map_interaction.set_player_input_enabled(false)
)
EventBus.tactical_combat_closed.connect(func() -> void:
    if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
        _map_interaction.set_player_input_enabled(true)
)
```

**NOTE FOR EXECUTOR:** Check `game_hud.gd` to confirm the exact variable names for `_military_system`, `_map_interaction`, and `_map_renderer` — they mirror what the `division_builder_open_requested` handler already uses (around line 107).

- [ ] **Step 25 — Verify cream theme is not overridden by hud_dark.tres inheritance**

After Step 24, run the GUT test `test_panel_bg_is_cream_not_dark` with the panel as a child of the real GameHUD. If it fails (dark theme bleeds through despite `theme = null` in `_ready()`), add this to `tactical_combat_panel.gd`'s `_ready()`:

```gdscript
# Allow parent to assign inherited theme first, then override
await get_tree().process_frame
theme = null
_apply_cream_style()
_tint_all_labels()
```

- [ ] **Step 26 — Commit**

```bash
git add client/src/ui/hud/game_hud.gd
git commit -m "feat: instantiate TacticalCombatPanel in GameHUD as full-screen overlay"
```

---

## ⚠️ Section F: AttackPatternRegistry — Verify Only, Do NOT Recreate

```bash
# Confirm the file exists and is NOT a stub
grep -c "func" client/src/ui/hud/attack_pattern_registry.gd
# Expected: output > 5 (file has 8+ functions)
```

If `TacticalCombatPanel` later needs to call `simulate_round()` for client-side round preview:

```gdscript
const AttackPatternRegistry := preload("res://src/ui/hud/attack_pattern_registry.gd")
var preview: Dictionary = AttackPatternRegistry.simulate_round(atk_cells, def_cells, _round_number)
```

No changes to `attack_pattern_registry.gd` are needed in this branch.

---

## Task 7: End-to-end smoke test

- [ ] **Step 27 — Manual test in running Godot project**

1. `F5` — run project, start a game session
2. Spawn two opposing divisions in proximity → combat triggers automatically
3. **Check:** `EngagementBanner` appears between the two division icons on the strategic map
4. **Check:** Banner shows balanced HP bars (≈50/50) before first round
5. Wait for first `ROUND_RESOLVED`: **Check** HP bars shift (attacker bar shrinks or defender bar shrinks based on round result)
6. If HP drops below thresholds (ATK < 20% or DEF < 40%): **Check** amber border pulsing appears
7. Click the ⚔ glyph area: **Check** `TacticalCombatPanel` opens — background must be CREAM/PAPER coloured, NOT dark brown
8. **Check** left grid = attacker cells, right grid = defender cells, row 4 at top (front), row 0 at bottom (rear)
9. **Check** GridCell colours match state (empty=light, occupied=cream, suppressed=amber tint)
10. Next round fires: **Check** grid cells update with new values
11. Click ✕: **Check** panel hides but banner remains on map
12. Combat ends: **Check** banner disappears from map

- [ ] **Step 28 — Run all new GUT tests**

```
client/test/gut/test_event_bus_signals.gd        → 4 passing
client/test/gut/test_engagement_banner.gd         → 8 passing
client/test/gut/test_tactical_combat_panel.gd     → 8 passing
```

Expected: **20 passing**, 0 failures.

---

## Verification Checklist

- [ ] `event_bus.gd` has `round_resolved`, `unit_incapacitated`, `tactical_combat_opened`, `tactical_combat_closed`
- [ ] `session_manager.gd` handles `ROUND_RESOLVED` → emits `EventBus.round_resolved`
- [ ] `EngagementBanner` scene created (Node2D root, no Control children)
- [ ] Banner positions at midpoint between two division icons in `_icon_layer` world space, −30 Y
- [ ] Banner HP bars update on `division_updated` and `round_resolved` signals
- [ ] Amber pulse triggers when ATK HP < 20% or DEF HP < 40%
- [ ] Click on ⚔ zone emits `tactical_combat_opened` via `_input()` — NOT a Button node
- [ ] `MilitarySystem` spawns banner on `combat_started`, despawns on `combat_resolved`
- [ ] `TacticalCombatPanel` background is cream `Color(0.92, 0.88, 0.82, 1.0)` — **NOT dark**
- [ ] `theme = null` set in panel's `_ready()` to break `hud_dark.tres` inheritance
- [ ] Grids show row 4 (front) at TOP, row 0 (rear) at BOTTOM — child index = `(4 - row) * 5 + col`
- [ ] `GridCell` states: empty=light cream, occupied=darker cream, suppressed=amber tint, incap=gray, stealthed=green tint
- [ ] `attack_pattern_registry.gd` is **unchanged** — verified with `grep -c "func"`
- [ ] GUT tests: **20 passing** across 3 test files
- [ ] `TacticalCombatPanel` added to GameHUD with full-rect anchors (fills viewport when shown)
