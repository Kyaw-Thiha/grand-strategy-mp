# Plan: Phase 6 — Branch K-Polish: Tactical Grid UI Polish

> **Branch:** `feat/tactical-grid-ui-polish`
> **Depends on:** `feat/tactical-grid-ui` (Branch K) fully merged
> **Save plan to:** `plans/phase-6-task-k-polish.md`
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the TacticalCombatPanel and GridCell with richer visuals: NATO-style unit glyphs, XP tier corner badges, formation bonus teal outlines, fog-of-war dashed borders, 5-phase escalation strip with countdown, row perk labels, nation color squares, flanking status chip, and an engagement context banner. Also fixes a silent field-name mismatch in FLANK_ATTACK / REAR_ATTACK handling.

---

## ⚠️ Critical Facts — Read Before Starting

### 1. Branch K created these files — verify they exist before starting

```bash
ls client/src/ui/hud/grid_cell.gd
ls client/src/ui/hud/tactical_combat_panel.gd
ls client/scenes/game/panels/grid_cell.tscn
ls client/scenes/game/panels/tactical_combat_panel.tscn
```

If any are missing, Branch K has not yet executed. Do not proceed.

### 2. UnitGlyphCell already implements NATO-style symbols — reuse its logic

**File:** `client/src/ui/hud/unit_glyph_cell.gd`

Drawing logic is in `_draw_glyph()` (lines 129–159). Unit type categories:
```
CROSS_TYPES  (diagonal X):  infantry, assault_infantry, recon_infantry, mg,
                             commando, flamethrower, at_infantry, sniper
OVAL_TYPES   (ellipse):      light_tank, medium_tank, heavy_tank, armoured_car,
                             at_gun_sp, self_propelled_gun
DOT_TYPES    (filled circle): artillery, howitzer
Default      (diagonal line): cavalry, aa_gun, and everything else
```

Color map in `_get_unit_color()` (lines 161–169):
```
infantry/MG/commando/FLM/AT-inf/sniper/assault/recon → _COLOR_INF = Color(0.55, 0.45, 0.25)
armour/armoured_car/at_gun_sp                        → _COLOR_ARM = Color(0.20, 0.40, 0.70)
artillery/howitzer                                   → _COLOR_ART = Color(0.75, 0.25, 0.20)
recon_infantry/force_recon_sniper                    → _COLOR_RCN = Color(0.20, 0.65, 0.70)
cavalry                                              → _COLOR_CAV = Color(0.75, 0.60, 0.10)
at_gun                                               → _COLOR_ATG = Color(0.80, 0.45, 0.10)
aa_gun                                               → _COLOR_AA  = Color(0.50, 0.20, 0.70)
```

Do NOT import UnitGlyphCell as a scene/child — copy the drawing constants and `_draw_glyph()` logic directly into `grid_cell.gd`.

### 3. Row perk constants already defined in division_builder_panel.gd

**File:** `client/src/ui/hud/division_builder_panel.gd`

Reuse these exact names/hints (displayed top-to-bottom = front-to-rear = row 4 down to row 0):
```
Top of panel = front row (row 4 = Vanguard), bottom = rear (row 0)
["VANGUARD", "+supp dealt"]
["ASSAULT",  "+HP dmg"]
["SUPPORT",  "+supp res"]
["RESERVE",  "+recovery"]
["REAR",     "+range/cmd"]
```

### 4. Nation colors defined in military_system.gd — copy the dict

**File:** `client/src/systems/military/military_system.gd` lines 9–16

```gdscript
const NATION_COLORS: Dictionary = {
    "germany":        Color(0.29, 0.29, 0.29),
    "france":         Color(0.0,  0.14, 0.58),
    "united_kingdom": Color(0.0,  0.07, 0.41),
    "italy":          Color(0.0,  0.57, 0.27),
    "spain":          Color(0.78, 0.04, 0.12),
    "algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR := Color(0.40, 0.40, 0.40)
```

Copy this dict into `tactical_combat_panel.gd` (do not import military_system).

### 5. FLANK_ATTACK / REAR_ATTACK field mismatch — silent bug

Server broadcasts (`combat_system.ts` line 508):
```typescript
broadcast("FLANK_ATTACK", { defender_id, attacker_a, attacker_b })
```

Client reads (`session_manager.gd` line 83):
```gdscript
EventBus.flank_attack.emit(data.get("flanker_id", ""), ...)
                                    ^^^^^^^^^^^^ WRONG — key does not exist
```

Result: `flanker_id` is always `""`. Fix in Task 7 below.

### 6. lethality_phase is a String, not a bool

`RoundResolvedPayload.lethality_phase` is typed as:
`"contact" | "firefight" | "intense" | "decisive" | "annihilation"`

The base K plan declared `round_resolved(... lethality_phase: bool ...)` which is wrong.
If K executed with that bool type, fix it to `String` as part of Task 3 below.

### 7. formation_bonuses_active is at PAYLOAD level, not cell level

`RoundResolvedPayload.formation_bonuses_active: FormationBonusActive[]`

Where `FormationBonusActive = { cell_a: number, cell_b: number, bonus_type: string }`.

It is currently always `[]` (no active rules yet — Branch I shipped the engine but zero rules). The teal outline must handle the empty-array case gracefully (no outlines = correct default).

### 8. Grid cell delta shape

`GridCellDelta` fields (all optional except `cell_index`):
```
cell_index   int     — 0–24; row = floor(idx/5), col = idx%5; row 0=rear, row 4=vanguard/front
hp           float   — 0–100
suppression  float   — 0–100
xp_tier      String  — "green"|"seasoned"|"veteran"|"elite"
incapacitated bool
stealthed    bool
unit_type    String
```

### 9. GameState.get_division() returns Dictionary

```gdscript
func get_division(division_id: String) -> Dictionary:
    return divisions.get(division_id, {})
```

Fields available from DivisionState schema (schema-synced):
`division_id`, `nation_id`, `division_type`, `hp`, `suppression`, `combat_state`,
`attacker_role` ("attacker"|"defender"|"meeting"|""), `engaged_with` (Array), `template_id`

Grid cell data is NOT schema-synced — only available via ROUND_RESOLVED delta.

---

## Existing Files — DO NOT Recreate

| File | Role |
|------|------|
| `client/src/ui/hud/unit_glyph_cell.gd` | Source of NATO glyph logic to copy from |
| `client/src/ui/hud/division_builder_panel.gd` | Source of row name/perk constants |
| `client/src/systems/military/military_system.gd` | Source of NATION_COLORS |
| `client/src/core/event_bus.gd` | Fix lethality_phase signal type if needed |
| `client/src/core/game_state.gd` | Read-only — `get_division()` |

## Files to Modify

| File | Changes |
|------|---------|
| `client/src/ui/hud/grid_cell.gd` | NATO glyphs, XP badge, fog-of-war dashed border, formation teal outline |
| `client/src/ui/hud/tactical_combat_panel.gd` | Escalation strip, row labels, nation squares, context banner, flank chip, countdown timer, close-anytime subtitle |
| `client/src/systems/session/session_manager.gd` | Fix FLANK_ATTACK/REAR_ATTACK field names |

## Test Files to Create

| File | Tests |
|------|-------|
| `client/test/gut/test_grid_cell_polish.gd` | Glyph category, XP badge, fog-of-war, formation outline |
| `client/test/gut/test_tactical_panel_polish.gd` | Escalation pills, row labels, nation squares, flank chip |

---

## Visual Design Reference (ASCII)

### GridCell — all states

```
EMPTY CELL:
┌──────────────────────────────┐
│                              │  ← bg Color(0.88, 0.83, 0.76)
│         +   +                │  ← plus-sign crosshair, Color(0.70, 0.65, 0.58)
│         +   +                │
│                              │
└──────────────────────────────┘

OCCUPIED CELL (infantry, veteran):
┌──────────────────────────────┐
│                      [V]     │  ← XP badge top-right: V=blue, E=purple,
│      ╳╳╳╳╳╳                 │    S=yellow-green, G=no badge
│      ╳╳╳╳╳╳                 │  ← NATO X glyph (_COLOR_INF)
│  ▓▓▓▓▓░░░░░  supp(amber)    │
│  ▓▓▓▓▓▓▓▓▓  HP(green)       │
└──────────────────────────────┘

STEALTHED / FOG-OF-WAR (dashed border, no unit shown):
╔ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─╗
│                              │  ← bg Color(0.55, 0.62, 0.55) muted green
│           ?                  │  ← "?" label centred
│                              │
╚ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─╝

FORMATION BONUS CELL (teal border override):
╔══════════════════════════════╗  ← border Color(0.20, 0.70, 0.70) 2px
│                      [E]     │
│      ╳╳╳╳╳╳                 │
│  ▓▓▓▓▓░░░░░                 │
│  ▓▓▓▓▓▓▓▓▓                  │
╚══════════════════════════════╝

XP badge colours:
  green    → no badge
  seasoned → Color(0.55, 0.72, 0.25)  letter "S"
  veteran  → Color(0.25, 0.45, 0.80)  letter "V"
  elite    → Color(0.60, 0.20, 0.80)  letter "E"
```

### TacticalCombatPanel — full layout after polish

```
╔══════════════════════════════════════════════════════════════════════╗
║  [✕]  TACTICAL COMBAT · Round 3    close anytime – resolves below  ║
╠══════════════════════════════════════════════════════════════════════╣
║  [■] France IV Division  ATTACKER  ║  DEFENDER  [■] Germany 2nd   ║
║  (SubtitleRow: ColorRect + name label on left, name label + ColorRect on right)
╠══════════════════════════════════════════════════════════════════════╣
║  ENGAGEMENT  Attacking — defender terrain bonuses active  [FLANK]  ║
║  (ContextBanner: styled PanelContainer with chip + label)           ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  VANGUARD   ┌────┬────┬────┬────┬────┐  ┌────┬────┬────┬────┬────┐ ║
║  +supp dealt│    │    │    │    │    │  │    │    │    │    │    │ ║
║  ASSAULT    ├────┼────┼────┼────┼────┤  ├────┼────┼────┼────┼────┤ ║
║  +HP dmg    │    │    │    │    │    │  │    │    │    │    │    │ ║
║  SUPPORT    ├────┼────┼────┼────┼────┤  ├────┼────┼────┼────┼────┤ ║
║  +supp res  │    │    │    │    │    │  │    │    │    │    │    │ ║
║  RESERVE    ├────┼────┼────┼────┼────┤  ├────┼────┼────┼────┼────┤ ║
║  +recovery  │    │    │    │    │    │  │    │    │    │    │    │ ║
║  REAR       ├────┼────┼────┼────┼────┤  ├────┼────┼────┼────┼────┤ ║
║  +range/cmd │    │    │    │    │    │  │    │    │    │    │    │ ║
║             └────┴────┴────┴────┴────┘  └────┴────┴────┴────┴────┘ ║
║  (RowLabels VBoxContainer inserted at index 0 of GridRow in code)   ║
╠══════════════════════════════════════════════════════════════════════╣
║  [CONTACT] [FIREFIGHT] [· INTENSE · 0:14] [decisive] [annihilation]║
║  (5 Label pills replace EscLabel; active pill has countdown)        ║
╠══════════════════════════════════════════════════════════════════════╣
║  [WITHDRAW]                                              [COMMIT]   ║
╚══════════════════════════════════════════════════════════════════════╝

Row labels are on LEFT of attacker grid (RowLabels VBoxContainer, child idx 0 of GridRow).
[■] = ColorRect 10×10px using NATION_COLORS[nation_id].
[FLANK] / [REAR ATTACK] chip in SubtitleRow, hidden by default.
```

### Escalation strip pill colours

```
contact:      Color(0.47, 0.53, 0.43, 1.0)  muted sage green
firefight:    Color(0.72, 0.57, 0.17, 1.0)  golden amber
intense:      Color(0.80, 0.40, 0.10, 1.0)  orange
decisive:     Color(0.60, 0.25, 0.10, 1.0)  dark orange-red
annihilation: Color(0.55, 0.10, 0.10, 1.0)  dark crimson

Active pill text:    "· {PHASE_NAME} · M:SS"   (countdown in M:SS format)
Inactive pill text:  lower-case phase name
Active pill alpha:   1.0
Inactive pill alpha: 0.45
```

---

## Task 1: NATO glyphs + XP badge + fog-of-war + formation outline in GridCell (RED → GREEN)

This task fully rewrites `grid_cell.gd` to use `_draw()` for all rendering, replacing the
Label + ColorRect child node approach from Branch K. The `grid_cell.tscn` scene root stays
as a bare PanelContainer — remove any child nodes if K created them.

### Step 1 — Write GUT tests

Create `client/test/gut/test_grid_cell_polish.gd`:

```gdscript
extends GutTest

var _cell: Control

func before_each() -> void:
    _cell = preload("res://scenes/game/panels/grid_cell.tscn").instantiate()
    add_child_autofree(_cell)

# ── Glyph category ────────────────────────────────────────────────────────

func test_glyph_category_infantry_is_cross() -> void:
    assert_eq(_cell.get_glyph_category("infantry"), "cross",
        "infantry must map to cross (diagonal X)")

func test_glyph_category_medium_tank_is_oval() -> void:
    assert_eq(_cell.get_glyph_category("medium_tank"), "oval",
        "medium_tank must map to oval (ellipse)")

func test_glyph_category_artillery_is_dot() -> void:
    assert_eq(_cell.get_glyph_category("artillery"), "dot",
        "artillery must map to dot (filled circle)")

func test_glyph_category_cavalry_is_line() -> void:
    assert_eq(_cell.get_glyph_category("cavalry"), "line",
        "cavalry must map to line (single diagonal)")

func test_glyph_category_unknown_is_line() -> void:
    assert_eq(_cell.get_glyph_category(""), "line",
        "empty unit_type falls back to line")

# ── XP badge ──────────────────────────────────────────────────────────────

func test_xp_tier_stored_after_display() -> void:
    _cell.display({"unit_type": "infantry", "hp": 80.0, "xp_tier": "veteran"})
    assert_eq(_cell.get_xp_tier(), "veteran", "xp_tier stored after display()")

func test_xp_tier_defaults_to_green_when_missing() -> void:
    _cell.display({"unit_type": "infantry", "hp": 80.0})
    assert_eq(_cell.get_xp_tier(), "green",
        "missing xp_tier in delta defaults to green")

# ── Fog of war / stealth ──────────────────────────────────────────────────

func test_stealthed_cell_shows_fog_state() -> void:
    _cell.display({"unit_type": "sniper", "hp": 80.0, "stealthed": true})
    assert_true(_cell.is_fog_state(), "stealthed cell must be in fog state")

func test_non_stealthed_occupied_cell_is_not_fog() -> void:
    _cell.display({"unit_type": "infantry", "hp": 80.0, "stealthed": false})
    assert_false(_cell.is_fog_state(), "non-stealthed cell must not be fog")

func test_empty_cell_is_not_fog() -> void:
    _cell.display({})
    assert_false(_cell.is_fog_state(), "empty cell is not fog state")

# ── Formation bonus ───────────────────────────────────────────────────────

func test_formation_bonus_false_by_default() -> void:
    _cell.display({"unit_type": "infantry", "hp": 80.0})
    assert_false(_cell.get_formation_bonus(), "no formation bonus by default")

func test_set_formation_bonus_true() -> void:
    _cell.display({"unit_type": "infantry", "hp": 80.0})
    _cell.set_formation_bonus(true)
    assert_true(_cell.get_formation_bonus(), "set_formation_bonus(true) takes effect")

func test_set_formation_bonus_false_clears() -> void:
    _cell.set_formation_bonus(true)
    _cell.set_formation_bonus(false)
    assert_false(_cell.get_formation_bonus(), "set_formation_bonus(false) clears it")
```

### Step 2 — Run GUT → expect RED (13 failures)

### Step 3 — Rewrite `client/src/ui/hud/grid_cell.gd`

Replace the entire file content with the following. This replaces the Label + ColorRect
approach from Branch K. The scene root stays as bare PanelContainer — `_draw()` does
everything.

```gdscript
extends PanelContainer

# ── State ─────────────────────────────────────────────────────────────────
var _unit_type:       String = ""
var _hp_pct:          float  = 1.0
var _supp_pct:        float  = 0.0
var _incap:           bool   = false
var _stealthed:       bool   = false
var _xp_tier:         String = "green"
var _formation_bonus: bool   = false

# ── Glyph category sets (copied from unit_glyph_cell.gd) ─────────────────
const _CROSS_TYPES: Array = [
    "infantry", "assault_infantry", "recon_infantry", "mg",
    "commando", "flamethrower", "at_infantry", "sniper", "force_recon_sniper",
]
const _OVAL_TYPES: Array = [
    "light_tank", "medium_tank", "heavy_tank", "armoured_car",
    "at_gun_sp", "self_propelled_gun",
]
const _DOT_TYPES: Array = ["artillery", "howitzer"]

# ── Cell background colours ───────────────────────────────────────────────
const C_EMPTY:     Color = Color(0.88, 0.83, 0.76, 1.0)
const C_OCCUPY:    Color = Color(0.78, 0.73, 0.65, 1.0)
const C_SUPP_BG:   Color = Color(0.80, 0.72, 0.55, 1.0)
const C_INCAP:     Color = Color(0.68, 0.62, 0.58, 1.0)
const C_STEALTH:   Color = Color(0.55, 0.62, 0.55, 1.0)
const C_BORDER:    Color = Color(0.45, 0.35, 0.22, 1.0)
const C_FORMATION: Color = Color(0.20, 0.70, 0.70, 1.0)   # teal
const C_FOG_BDR:   Color = Color(0.50, 0.58, 0.50, 1.0)   # fog border
const C_HP_BAR:    Color = Color(0.30, 0.65, 0.35, 1.0)
const C_SUPP_BAR:  Color = Color(0.85, 0.55, 0.10, 1.0)
const C_CROSSHAIR: Color = Color(0.70, 0.65, 0.58, 1.0)   # empty cell plus
const C_BAR_EMPTY: Color = Color(0.60, 0.55, 0.48, 1.0)

# ── Glyph unit colours (copied from unit_glyph_cell.gd _get_unit_color) ──
const _COLOR_INF := Color(0.55, 0.45, 0.25)
const _COLOR_ARM := Color(0.20, 0.40, 0.70)
const _COLOR_ART := Color(0.75, 0.25, 0.20)
const _COLOR_RCN := Color(0.20, 0.65, 0.70)
const _COLOR_CAV := Color(0.75, 0.60, 0.10)
const _COLOR_ATG := Color(0.80, 0.45, 0.10)
const _COLOR_AA  := Color(0.50, 0.20, 0.70)

# ── XP badge colours ──────────────────────────────────────────────────────
const C_XP_S := Color(0.55, 0.72, 0.25)   # seasoned — yellow-green
const C_XP_V := Color(0.25, 0.45, 0.80)   # veteran  — blue
const C_XP_E := Color(0.60, 0.20, 0.80)   # elite    — purple

const MAX_BAR_W: float = 56.0

# ── Public API ────────────────────────────────────────────────────────────

func get_glyph_category(unit_type: String) -> String:
    if unit_type in _CROSS_TYPES: return "cross"
    if unit_type in _OVAL_TYPES:  return "oval"
    if unit_type in _DOT_TYPES:   return "dot"
    return "line"

func get_xp_tier()        -> String: return _xp_tier
func is_fog_state()       -> bool:   return _stealthed
func get_formation_bonus()-> bool:   return _formation_bonus

func set_formation_bonus(active: bool) -> void:
    _formation_bonus = active
    _apply_panel_style()
    queue_redraw()

func display(cell_data: Dictionary) -> void:
    _unit_type  = cell_data.get("unit_type",     "")
    _hp_pct     = cell_data.get("hp",            100.0) / 100.0
    _supp_pct   = cell_data.get("suppression",   0.0)   / 100.0
    _incap      = cell_data.get("incapacitated", false)
    _stealthed  = cell_data.get("stealthed",     false)
    _xp_tier    = cell_data.get("xp_tier",       "green")
    _formation_bonus = false   # reset each display(); caller calls set_formation_bonus() after
    _apply_panel_style()
    queue_redraw()

# ── Private helpers ───────────────────────────────────────────────────────

func _apply_panel_style() -> void:
    var bg: Color
    if _unit_type == "":    bg = C_EMPTY
    elif _stealthed:        bg = C_STEALTH
    elif _incap:            bg = C_INCAP
    elif _supp_pct > 0.5:  bg = C_SUPP_BG
    else:                   bg = C_OCCUPY

    var s := StyleBoxFlat.new()
    s.bg_color = bg
    if _stealthed:
        # Dashed border drawn in _draw(); hide StyleBox border.
        s.set_border_width_all(0)
    elif _formation_bonus:
        s.set_border_width_all(2)
        s.border_color = C_FORMATION
    else:
        s.set_border_width_all(1)
        s.border_color = C_BORDER
    add_theme_stylebox_override("panel", s)

func _draw() -> void:
    var sz := size

    if _unit_type == "" and not _stealthed:
        # Empty cell — faint plus-sign crosshair
        var cx := sz.x * 0.5
        var cy := sz.y * 0.45
        var arm := 6.0
        draw_line(Vector2(cx - arm, cy), Vector2(cx + arm, cy), C_CROSSHAIR, 1.0)
        draw_line(Vector2(cx, cy - arm), Vector2(cx, cy + arm), C_CROSSHAIR, 1.0)
        return

    if _stealthed:
        # Fog-of-war: dashed border + "?" label
        _draw_dashed_border(Rect2(Vector2.ZERO, sz), C_FOG_BDR, 4.0, 4.0)
        draw_string(ThemeDB.fallback_font,
            Vector2(sz.x * 0.5 - 4.0, sz.y * 0.5 + 5.0),
            "?", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, C_FOG_BDR)
        return

    # ── Unit glyph ────────────────────────────────────────────────────────
    var g_cx := sz.x * 0.5
    var g_cy := sz.y * 0.38
    var g_r  := min(sz.x, sz.y) * 0.22
    _draw_glyph(g_cx, g_cy, g_r, _get_unit_color(_unit_type))

    # ── XP badge (top-right corner, 12×12 px) ────────────────────────────
    if _xp_tier != "green":
        var badge_col: Color
        var badge_letter: String
        match _xp_tier:
            "seasoned": badge_col = C_XP_S; badge_letter = "S"
            "veteran":  badge_col = C_XP_V; badge_letter = "V"
            "elite":    badge_col = C_XP_E; badge_letter = "E"
            _:          return  # unknown tier — skip
        var bx := sz.x - 14.0
        draw_rect(Rect2(Vector2(bx, 2.0), Vector2(12.0, 12.0)), badge_col)
        draw_string(ThemeDB.fallback_font, Vector2(bx + 2.0, 12.0),
            badge_letter, HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color.WHITE)

    # ── HP bar (bottom of cell) ───────────────────────────────────────────
    var bar_y := sz.y - 8.0
    var bar_x := (sz.x - MAX_BAR_W) * 0.5
    draw_rect(Rect2(Vector2(bar_x, bar_y), Vector2(MAX_BAR_W, 5.0)), C_BAR_EMPTY)
    draw_rect(Rect2(Vector2(bar_x, bar_y),
        Vector2(MAX_BAR_W * clamp(_hp_pct, 0.0, 1.0), 5.0)), C_HP_BAR)

    # ── Suppression bar (just above HP bar) ──────────────────────────────
    if _supp_pct > 0.02:
        var s_y := bar_y - 6.0
        draw_rect(Rect2(Vector2(bar_x, s_y), Vector2(MAX_BAR_W, 4.0)), C_BAR_EMPTY)
        draw_rect(Rect2(Vector2(bar_x, s_y),
            Vector2(MAX_BAR_W * clamp(_supp_pct, 0.0, 1.0), 4.0)), C_SUPP_BAR)

func _draw_glyph(cx: float, cy: float, r: float, col: Color) -> void:
    match get_glyph_category(_unit_type):
        "oval":
            # 24-point parametric ellipse
            var prev := Vector2(cx + r * 1.6, cy)
            for i in range(1, 25):
                var a  := (i / 24.0) * TAU
                var pt := Vector2(cx + cos(a) * r * 1.6, cy + sin(a) * r * 0.85)
                draw_line(prev, pt, col, 1.5)
                prev = pt
        "dot":
            draw_circle(Vector2(cx, cy), r * 0.7, col)
        "cross":
            # NATO infantry diagonal X
            draw_line(Vector2(cx - r, cy - r), Vector2(cx + r, cy + r), col, 1.5)
            draw_line(Vector2(cx + r, cy - r), Vector2(cx - r, cy + r), col, 1.5)
        _:  # "line"
            draw_line(Vector2(cx - r, cy + r), Vector2(cx + r, cy - r), col, 1.5)

func _get_unit_color(unit_type: String) -> Color:
    if unit_type in ["recon_infantry", "force_recon_sniper"]: return _COLOR_RCN
    if unit_type in _CROSS_TYPES: return _COLOR_INF
    if unit_type in ["at_gun", "at_gun_sp", "at_infantry"]:  return _COLOR_ATG
    if unit_type in _OVAL_TYPES: return _COLOR_ARM
    if unit_type in _DOT_TYPES:  return _COLOR_ART
    if unit_type == "cavalry":   return _COLOR_CAV
    if unit_type == "aa_gun":    return _COLOR_AA
    return _COLOR_INF

func _draw_dashed_border(rect: Rect2, col: Color, dash: float, gap: float) -> void:
    var corners := [
        rect.position,
        rect.position + Vector2(rect.size.x, 0),
        rect.position + rect.size,
        rect.position + Vector2(0, rect.size.y),
    ]
    for i in range(4):
        var a      := corners[i]
        var b      := corners[(i + 1) % 4]
        var total  := a.distance_to(b)
        var dir    := (b - a).normalized()
        var travel := 0.0
        while travel < total:
            var d_end := min(travel + dash, total)
            draw_line(a + dir * travel, a + dir * d_end, col, 1.0)
            travel += dash + gap
```

**NOTE FOR EXECUTOR:**
- If `grid_cell.tscn` has child nodes (VBoxContainer, UnitLabel, ColorRect bars), remove them. The rewritten script uses no child nodes — all rendering is via `_draw()`.
- Set `custom_minimum_size = Vector2(72, 72)` on the scene root PanelContainer if not already set.

### Step 4 — Run GUT → expect GREEN (13 passing)

### Step 5 — Commit

```bash
git add client/src/ui/hud/grid_cell.gd \
        client/scenes/game/panels/grid_cell.tscn \
        client/test/gut/test_grid_cell_polish.gd
git commit -m "feat: GridCell draws NATO glyphs, XP badges, fog-of-war dashes, formation teal outline"
```

---

## Task 2: Formation bonus wiring in TacticalCombatPanel (RED → GREEN)

Formation bonuses arrive in `ROUND_RESOLVED` payload as:
`formation_bonuses_active: [ {cell_a: int, cell_b: int, bonus_type: string}, ... ]`

The panel must apply teal outlines to the cells named in each pair.

### Step 6 — Write GUT tests

Create `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
extends GutTest

var _panel: Control

func before_each() -> void:
    _panel = preload("res://scenes/game/panels/tactical_combat_panel.tscn").instantiate()
    add_child_autofree(_panel)

func test_panel_has_apply_formation_bonuses_method() -> void:
    assert_true(_panel.has_method("_apply_formation_bonuses"),
        "panel must have _apply_formation_bonuses(bonuses: Array)")

func test_apply_formation_bonuses_marks_correct_cells() -> void:
    # cell_a=0 (row 0 rear, col 0) → child_idx = (4-0)*5+0 = 20
    # cell_b=5 (row 1, col 0)     → child_idx = (4-1)*5+0 = 15
    var bonuses := [{"cell_a": 0, "cell_b": 5, "bonus_type": "at_mg"}]
    _panel._apply_formation_bonuses(bonuses)
    var atk_grid = _panel.get_node("PanelContent/GridRow/AttackerGrid")
    assert_true(atk_grid.get_child(20).get_formation_bonus(),
        "cell_a=0 → child 20 must have formation bonus")
    assert_true(atk_grid.get_child(15).get_formation_bonus(),
        "cell_b=5 → child 15 must have formation bonus")

func test_empty_formation_bonuses_clears_all_outlines() -> void:
    _panel._apply_formation_bonuses([{"cell_a": 0, "cell_b": 1, "bonus_type": "mg_mg"}])
    _panel._apply_formation_bonuses([])
    var atk_grid = _panel.get_node("PanelContent/GridRow/AttackerGrid")
    for i in range(25):
        assert_false(atk_grid.get_child(i).get_formation_bonus(),
            "all cells must have formation bonus cleared after empty array")
```

### Step 7 — Run GUT → expect RED

### Step 8 — Add `_apply_formation_bonuses()` to `tactical_combat_panel.gd`

```gdscript
func _apply_formation_bonuses(bonuses: Array) -> void:
    # Clear all existing teal outlines
    for cell in _atk_grid.get_children():
        if cell.has_method("set_formation_bonus"):
            cell.set_formation_bonus(false)
    for cell in _def_grid.get_children():
        if cell.has_method("set_formation_bonus"):
            cell.set_formation_bonus(false)
    # Apply new bonuses (formation_bonuses_active references attacker grid cell indices)
    for bonus in bonuses:
        for idx in [int(bonus.get("cell_a", -1)), int(bonus.get("cell_b", -1))]:
            if idx < 0 or idx >= 25:
                continue
            var child_i: int = (4 - idx / 5) * 5 + idx % 5
            var cell = _atk_grid.get_child(child_i)
            if cell and cell.has_method("set_formation_bonus"):
                cell.set_formation_bonus(true)
```

Update `_on_round_resolved()` to call it — replace the lp handling while fixing the type:

```gdscript
func _on_round_resolved(eng_id: String, rn: int, lp,
                        atk_delta: Array, def_delta: Array, fb) -> void:
    if eng_id != _engagement_id:
        return
    _apply_grid_deltas(_atk_grid, atk_delta)
    _apply_grid_deltas(_def_grid, def_delta)
    var bonuses: Array = fb if fb is Array else []
    _apply_formation_bonuses(bonuses)
    _update_escalation(str(lp), rn)   # _update_escalation() added in Task 3
```

### Step 9 — Run GUT → expect GREEN (3 passing in new file)

### Step 10 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "feat: wire formation_bonuses_active to teal GridCell outlines"
```

---

## Task 3: 5-phase escalation strip with countdown (RED → GREEN)

### Step 11 — Add GUT tests

Append to `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
func test_panel_has_update_escalation_method() -> void:
    assert_true(_panel.has_method("_update_escalation"),
        "panel must have _update_escalation(phase: String, round_number: int)")

func test_escalation_shows_correct_active_phase() -> void:
    _panel._update_escalation("firefight", 2)
    assert_eq(_panel.get_active_phase(), "firefight")

func test_escalation_defaults_to_contact() -> void:
    assert_eq(_panel.get_active_phase(), "contact")

func test_escalation_annihilation_phase() -> void:
    _panel._update_escalation("annihilation", 7)
    assert_eq(_panel.get_active_phase(), "annihilation")
```

### Step 12 — Run GUT → expect RED

### Step 13 — Fix lethality_phase type in event_bus.gd and session_manager.gd

First check if the type is still bool:
```bash
grep "lethality_phase" client/src/core/event_bus.gd
```

If it shows `lethality_phase: bool`, change it to `String`:
```gdscript
# In event_bus.gd — change:
signal round_resolved(engagement_id: String, round_number: int, lethality_phase: bool, ...)
# To:
signal round_resolved(engagement_id: String, round_number: int, lethality_phase: String, ...)
```

In `session_manager.gd`, change:
```gdscript
# Before:
var lp: bool = data.get("lethality_phase", false)
# After:
var lp: String = str(data.get("lethality_phase", "contact"))
```

### Step 14 — Add escalation strip code to `tactical_combat_panel.gd`

**Add constants and variables:**

```gdscript
const PHASE_ORDER: Array = ["contact", "firefight", "intense", "decisive", "annihilation"]
const PHASE_COLORS: Dictionary = {
    "contact":      Color(0.47, 0.53, 0.43, 1.0),
    "firefight":    Color(0.72, 0.57, 0.17, 1.0),
    "intense":      Color(0.80, 0.40, 0.10, 1.0),
    "decisive":     Color(0.60, 0.25, 0.10, 1.0),
    "annihilation": Color(0.55, 0.10, 0.10, 1.0),
}
const ROUND_DURATION_S: float = 20.0   # design-doc target; exact from playtesting

var _active_phase:     String = "contact"
var _phase_pills:      Array  = []      # Array[Label] — 5 elements
var _round_countdown:  float  = 0.0
var _countdown_active: bool   = false
```

**Add `_build_escalation_pills()` and call it from `_ready()`:**

```gdscript
func _build_escalation_pills() -> void:
    # Find EscalationStrip → remove EscLabel → replace with 5 pill Labels
    var strip: HBoxContainer = $PanelContent/EscalationStrip
    var old_label = strip.get_node_or_null("EscLabel")
    if old_label:
        old_label.queue_free()

    var pills_box := HBoxContainer.new()
    pills_box.name = "PillsBox"
    pills_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    pills_box.add_theme_constant_override("separation", 4)
    strip.add_child(pills_box)
    # Move before CommitButton (last child)
    strip.move_child(pills_box, strip.get_child_count() - 2)

    _phase_pills.clear()
    for phase_name in PHASE_ORDER:
        var pill := Label.new()
        pill.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
        pill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        pill.add_theme_font_size_override("font_size", 10)
        pills_box.add_child(pill)
        _phase_pills.append(pill)

    _update_escalation("contact", 0)
```

**Add methods:**

```gdscript
func get_active_phase() -> String:
    return _active_phase

func _update_escalation(phase: String, _round_num: int) -> void:
    if phase not in PHASE_ORDER:
        phase = "contact"   # coerce unknown values (e.g. old bool "true"/"false")
    _active_phase     = phase
    _round_countdown  = ROUND_DURATION_S
    _countdown_active = true
    _refresh_escalation_display()

func _refresh_escalation_display() -> void:
    var active_idx := PHASE_ORDER.find(_active_phase)
    for i in range(_phase_pills.size()):
        var pill: Label  = _phase_pills[i]
        var p_name: String = PHASE_ORDER[i]
        var p_color: Color = PHASE_COLORS.get(p_name, Color.WHITE).lerp(Color.WHITE, 0.0)
        if i == active_idx:
            pill.text = "· %s · %s" % [p_name.to_upper(), _format_countdown(_round_countdown)]
            p_color.a = 1.0
        else:
            pill.text = p_name
            p_color.a = 0.45
        pill.add_theme_color_override("font_color", p_color)

func _format_countdown(seconds: float) -> String:
    var s := int(seconds)
    return "%d:%02d" % [s / 60, s % 60]

func _process(delta: float) -> void:
    if not _countdown_active or _phase_pills.is_empty():
        return
    _round_countdown = max(0.0, _round_countdown - delta)
    _refresh_escalation_display()
    if _round_countdown <= 0.0:
        _countdown_active = false
```

### Step 15 — Run GUT → expect GREEN (4 new passing)

### Step 16 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/src/core/event_bus.gd \
        client/src/systems/session/session_manager.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "feat: 5-phase escalation pills with countdown; fix lethality_phase type to String"
```

---

## Task 4: Row perk labels beside attacker grid (RED → GREEN)

Labels on the LEFT of the attacker grid only. Added purely in code — no .tscn change.

### Step 17 — Add GUT tests

Append to `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
func test_row_labels_exist_after_ready() -> void:
    var row_labels = _panel.get_node_or_null("PanelContent/GridRow/RowLabels")
    assert_not_null(row_labels, "RowLabels VBoxContainer must exist")

func test_row_labels_has_five_children() -> void:
    var row_labels = _panel.get_node_or_null("PanelContent/GridRow/RowLabels")
    if row_labels != null:
        assert_eq(row_labels.get_child_count(), 5, "must have 5 row label entries")
```

### Step 18 — Run GUT → expect RED

### Step 19 — Add `_add_row_labels()` to `tactical_combat_panel.gd`

```gdscript
const ROW_LABEL_DATA: Array = [
    ["VANGUARD", "+supp dealt"],
    ["ASSAULT",  "+HP dmg"],
    ["SUPPORT",  "+supp res"],
    ["RESERVE",  "+recovery"],
    ["REAR",     "+range/cmd"],
]

func _add_row_labels() -> void:
    var grid_row: HBoxContainer = $PanelContent/GridRow

    var col := VBoxContainer.new()
    col.name = "RowLabels"
    col.size_flags_vertical = Control.SIZE_EXPAND_FILL
    col.add_theme_constant_override("separation", 0)
    grid_row.add_child(col)
    grid_row.move_child(col, 0)   # leftmost — before AttackerGrid

    for entry in ROW_LABEL_DATA:
        var row_box := VBoxContainer.new()
        row_box.size_flags_vertical   = Control.SIZE_EXPAND_FILL
        row_box.custom_minimum_size   = Vector2(60, 72)  # match cell height
        col.add_child(row_box)

        var name_lbl := Label.new()
        name_lbl.text = entry[0]
        name_lbl.add_theme_font_size_override("font_size", 8)
        name_lbl.add_theme_color_override("font_color", Color(0.20, 0.14, 0.06))
        row_box.add_child(name_lbl)

        var perk_lbl := Label.new()
        perk_lbl.text = entry[1]
        perk_lbl.add_theme_font_size_override("font_size", 7)
        perk_lbl.add_theme_color_override("font_color", Color(0.45, 0.35, 0.22))
        row_box.add_child(perk_lbl)
```

Call `_add_row_labels()` in `_ready()`.

### Step 20 — Run GUT → expect GREEN (2 new passing)

### Step 21 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "feat: add row perk labels beside attacker grid (VANGUARD→REAR)"
```

---

## Task 5: Nation color squares + close-anytime subtitle (RED → GREEN)

### Step 22 — Add GUT tests

Append to `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
func test_panel_has_set_side_info_method() -> void:
    assert_true(_panel.has_method("set_side_info"),
        "must have set_side_info(atk_nation, atk_name, def_nation, def_name)")

func test_set_side_info_stores_nation_ids() -> void:
    _panel.set_side_info("france", "France IV Div", "germany", "Germany 2nd Arm")
    assert_eq(_panel.get_attacker_nation(), "france")
    assert_eq(_panel.get_defender_nation(), "germany")
```

### Step 23 — Run GUT → expect RED

### Step 24 — Add nation squares and close-anytime hint to `tactical_combat_panel.gd`

```gdscript
const NATION_COLORS: Dictionary = {
    "germany":        Color(0.29, 0.29, 0.29),
    "france":         Color(0.0,  0.14, 0.58),
    "united_kingdom": Color(0.0,  0.07, 0.41),
    "italy":          Color(0.0,  0.57, 0.27),
    "spain":          Color(0.78, 0.04, 0.12),
    "algeria":        Color(0.0,  0.38, 0.20),
}
const NATION_NEUTRAL := Color(0.40, 0.40, 0.40)

var _atk_nation:     String    = ""
var _def_nation:     String    = ""
var _atk_color_rect: ColorRect = null
var _def_color_rect: ColorRect = null

func get_attacker_nation() -> String: return _atk_nation
func get_defender_nation() -> String: return _def_nation

func set_side_info(atk_nation: String, atk_name: String,
                   def_nation: String, def_name: String) -> void:
    _atk_nation = atk_nation
    _def_nation = def_nation
    _atk_name.text = atk_name
    _def_name.text = def_name
    if _atk_color_rect:
        _atk_color_rect.color = NATION_COLORS.get(atk_nation, NATION_NEUTRAL)
    if _def_color_rect:
        _def_color_rect.color = NATION_COLORS.get(def_nation, NATION_NEUTRAL)

func _add_nation_squares() -> void:
    var subtitle: HBoxContainer = $PanelContent/SubtitleRow

    _atk_color_rect = ColorRect.new()
    _atk_color_rect.custom_minimum_size = Vector2(10, 10)
    _atk_color_rect.color = NATION_NEUTRAL
    subtitle.add_child(_atk_color_rect)
    subtitle.move_child(_atk_color_rect, 0)    # before AttackerNameLabel

    _def_color_rect = ColorRect.new()
    _def_color_rect.custom_minimum_size = Vector2(10, 10)
    _def_color_rect.color = NATION_NEUTRAL
    subtitle.add_child(_def_color_rect)        # after DefenderNameLabel

func _add_close_anytime_hint() -> void:
    var header: HBoxContainer = $PanelContent/HeaderRow
    var hint := Label.new()
    hint.text = "close anytime – combat resolves below"
    hint.add_theme_font_size_override("font_size", 9)
    hint.add_theme_color_override("font_color", Color(0.45, 0.35, 0.22, 0.70))
    hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    hint.horizontal_alignment  = HORIZONTAL_ALIGNMENT_RIGHT
    header.add_child(hint)
    # Place before RoundLabel (last child of header)
    header.move_child(hint, header.get_child_count() - 2)
```

Call both in `_ready()`. Update `_refresh_from_game_state()` to call `set_side_info()`:
```gdscript
# After resolving div_a and div_b from GameState:
set_side_info(
    div_a.get("nation_id", "") if div_a else "",
    div_a.get("name", div_a_id) if div_a else div_a_id,
    div_b.get("nation_id", "") if div_b else "",
    div_b.get("name", div_b_id) if div_b else div_b_id
)
```

### Step 25 — Run GUT → expect GREEN (2 new passing)

### Step 26 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "feat: nation color squares and close-anytime subtitle in TacticalCombatPanel header"
```

---

## Task 6: Engagement context banner (RED → GREEN)

Shows attacker/defender role or meeting battle status. River crossing and terrain are NOT
included (server doesn't broadcast that data yet). Inserted between SubtitleRow and GridRow.

### Step 27 — Add GUT tests

Append to `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
func test_panel_has_set_engagement_context_method() -> void:
    assert_true(_panel.has_method("set_engagement_context"),
        "must have set_engagement_context(is_meeting: bool, atk_role: String)")

func test_context_banner_shows_meeting_battle_text() -> void:
    _panel.set_engagement_context(true, "meeting")
    var banner = _panel.get_node_or_null("PanelContent/ContextBanner")
    assert_not_null(banner, "ContextBanner must exist")
    var lbl = banner.get_node_or_null("Inner/ContextLabel")
    if lbl:
        assert_true(lbl.text.contains("Meeting"),
            "banner text must mention Meeting battle")

func test_context_banner_does_not_say_meeting_when_not_meeting() -> void:
    _panel.set_engagement_context(false, "attacker")
    var banner = _panel.get_node_or_null("PanelContent/ContextBanner")
    var lbl = banner.get_node_or_null("Inner/ContextLabel") if banner else null
    if lbl:
        assert_false(lbl.text.contains("Meeting"),
            "non-meeting battle should not say Meeting")
```

### Step 28 — Run GUT → expect RED

### Step 29 — Add context banner to `tactical_combat_panel.gd`

```gdscript
var _context_label: Label = null

func set_engagement_context(is_meeting: bool, atk_role: String) -> void:
    if _context_label == null:
        return
    if is_meeting:
        _context_label.text = "Meeting battle — no terrain bonuses for either side"
    elif atk_role == "attacker":
        _context_label.text = "Attacking — defender terrain bonuses active"
    elif atk_role == "defender":
        _context_label.text = "Defending — your terrain bonuses active"
    else:
        _context_label.text = ""

func _add_context_banner() -> void:
    var content: VBoxContainer = $PanelContent

    var banner := PanelContainer.new()
    banner.name = "ContextBanner"
    var s := StyleBoxFlat.new()
    s.bg_color     = Color(0.85, 0.80, 0.70, 1.0)
    s.border_color = Color(0.45, 0.35, 0.22, 1.0)
    s.set_border_width_all(1)
    banner.add_theme_stylebox_override("panel", s)

    var inner := HBoxContainer.new()
    inner.name = "Inner"
    inner.add_theme_constant_override("separation", 8)

    var chip := Label.new()
    chip.text = "ENGAGEMENT"
    chip.add_theme_font_size_override("font_size", 8)
    chip.add_theme_color_override("font_color", Color(0.20, 0.50, 0.55))
    inner.add_child(chip)

    _context_label = Label.new()
    _context_label.name = "ContextLabel"
    _context_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    _context_label.add_theme_font_size_override("font_size", 10)
    _context_label.add_theme_color_override("font_color", Color(0.20, 0.14, 0.06))
    inner.add_child(_context_label)

    banner.add_child(inner)
    content.add_child(banner)
    # Move between SubtitleRow and GridRow
    var subtitle_idx: int = content.get_node("SubtitleRow").get_index()
    content.move_child(banner, subtitle_idx + 1)
```

Call `_add_context_banner()` in `_ready()`.

Update `_on_opened()` to populate context after `_refresh_from_game_state()`:
```gdscript
var div_a = GameState.get_division(div_a_id)
var is_meeting := div_a.get("attacker_role", "") == "meeting"
var atk_role   := div_a.get("attacker_role", "")
set_engagement_context(is_meeting, atk_role)
```

### Step 30 — Run GUT → expect GREEN (3 new passing)

### Step 31 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "feat: add engagement context banner (meeting battle / attacker role)"
```

---

## Task 7: Fix FLANK_ATTACK field mismatch + flank status chip (RED → GREEN)

### Step 32 — Add GUT tests

Append to `client/test/gut/test_tactical_panel_polish.gd`:

```gdscript
func test_panel_has_show_flank_status_method() -> void:
    assert_true(_panel.has_method("show_flank_status"),
        "must have show_flank_status(status: String)")

func test_flank_chip_visible_after_flank_status_set() -> void:
    _panel.show_flank_status("flank")
    var chip = _panel.get_node_or_null("PanelContent/SubtitleRow/FlankChip")
    assert_not_null(chip, "FlankChip must exist")
    assert_true(chip.visible, "FlankChip must be visible after show_flank_status('flank')")

func test_flank_chip_hidden_when_none() -> void:
    _panel.show_flank_status("none")
    var chip = _panel.get_node_or_null("PanelContent/SubtitleRow/FlankChip")
    if chip:
        assert_false(chip.visible, "FlankChip must be hidden for status 'none'")
```

### Step 33 — Run GUT → expect RED

### Step 34a — Fix `session_manager.gd` FLANK_ATTACK field name

```gdscript
# BEFORE (broken — 'flanker_id' key never exists in the broadcast):
"FLANK_ATTACK":
    EventBus.flank_attack.emit(data.get("flanker_id", ""), data.get("defender_id", ""))
"REAR_ATTACK":
    EventBus.rear_attack.emit(data.get("flanker_id", ""), data.get("defender_id", ""))

# AFTER (server sends attacker_a + attacker_b, not flanker_id):
"FLANK_ATTACK":
    EventBus.flank_attack.emit(data.get("attacker_a", ""), data.get("defender_id", ""))
"REAR_ATTACK":
    EventBus.rear_attack.emit(data.get("attacker_a", ""), data.get("defender_id", ""))
```

### Step 34b — Add flank chip to `tactical_combat_panel.gd`

```gdscript
var _flank_chip: Label = null

func show_flank_status(status: String) -> void:
    if _flank_chip == null:
        return
    match status:
        "flank":
            _flank_chip.text    = "FLANK"
            _flank_chip.visible = true
        "rear":
            _flank_chip.text    = "REAR ATTACK"
            _flank_chip.visible = true
        _:
            _flank_chip.visible = false

func _add_flank_chip() -> void:
    var subtitle: HBoxContainer = $PanelContent/SubtitleRow
    _flank_chip = Label.new()
    _flank_chip.name    = "FlankChip"
    _flank_chip.text    = "FLANK"
    _flank_chip.visible = false
    _flank_chip.add_theme_font_size_override("font_size", 9)
    _flank_chip.add_theme_color_override("font_color", Color(0.80, 0.35, 0.10))
    subtitle.add_child(_flank_chip)
```

Call `_add_flank_chip()` in `_ready()`.

**Wire flank signals in `_ready()`:**

```gdscript
EventBus.flank_attack.connect(func(flanker_id: String, defender_id: String) -> void:
    if _engagement_id.is_empty(): return
    var parts := _engagement_id.split("_vs_")
    var ids: Array = [parts[0], parts[1].split("_")[0]] if parts.size() >= 2 else []
    if defender_id in ids:
        show_flank_status("flank")
)
EventBus.rear_attack.connect(func(flanker_id: String, defender_id: String) -> void:
    if _engagement_id.is_empty(): return
    var parts := _engagement_id.split("_vs_")
    var ids: Array = [parts[0], parts[1].split("_")[0]] if parts.size() >= 2 else []
    if defender_id in ids:
        show_flank_status("rear")
)
```

### Step 35 — Run GUT → expect GREEN (3 new passing)

### Step 36 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd \
        client/src/systems/session/session_manager.gd \
        client/test/gut/test_tactical_panel_polish.gd
git commit -m "fix: FLANK_ATTACK field name (flanker_id → attacker_a); add flank status chip"
```

---

## Task 8: End-to-end smoke test

### Step 37 — Manual test in running Godot project (`F5`)

**GridCell visuals:**
- [ ] Infantry cells show diagonal X glyph in brown-tan color
- [ ] Tank cells show oval/ellipse glyph in blue
- [ ] Artillery cells show filled circle in red
- [ ] Cavalry/AA cells show single diagonal line
- [ ] Empty cells show faint plus-sign crosshair, no glyph
- [ ] Stealthed cells show dashed border + "?" — no unit glyph visible
- [ ] Veteran cells show blue "V" badge top-right corner
- [ ] Elite cells show purple "E" badge top-right corner
- [ ] Seasoned cells show yellow-green "S" badge
- [ ] Green cells have no badge
- [ ] Formation bonus cells show teal `Color(0.20, 0.70, 0.70)` border (2px)

**Panel layout:**
- [ ] Row labels visible to the left of the attacker grid: VANGUARD / ASSAULT / SUPPORT / RESERVE / REAR with perk hints
- [ ] Nation color squares [■] visible before each division name
- [ ] "close anytime – combat resolves below" text in header (right-aligned)
- [ ] Context banner shows "Meeting battle" or "Attacking / Defending"

**Escalation strip:**
- [ ] 5 phase pills visible; active pill shows "· {PHASE} · M:SS" in uppercase
- [ ] Countdown decrements each second (visible in "· NOW · 0:20" → "· NOW · 0:14" etc.)
- [ ] Inactive pills are muted (45% alpha, lower-case)
- [ ] After ROUND_RESOLVED, active pill advances phase if changed and countdown resets

**Flanking:**
- [ ] FLANK chip visible in subtitle row when a third division flanks the engaged pair
- [ ] REAR ATTACK chip visible for rear attack

### Step 38 — Run all GUT tests

Expected:
```
test_grid_cell_polish.gd        → 13 passing
test_tactical_panel_polish.gd   → 21 passing
```

Total: **34 passing**, 0 failures.

---

## Verification Checklist

- [ ] `grid_cell.gd` uses only `_draw()` — no child Label/ColorRect nodes
- [ ] `get_glyph_category()` returns correct category for all 17+ unit types
- [ ] XP badge visible for seasoned/veteran/elite; absent for green
- [ ] Stealthed cells render dashed border + "?" via `_draw_dashed_border()`
- [ ] `set_formation_bonus(true)` applies teal `Color(0.20, 0.70, 0.70)` 2px border
- [ ] `_apply_formation_bonuses([])` clears all teal outlines on both grids
- [ ] `lethality_phase` in `event_bus.gd` signal is `String` not `bool`
- [ ] `session_manager.gd` lethality extraction uses `str(data.get("lethality_phase", "contact"))`
- [ ] 5 phase pills created in EscalationStrip (EscLabel removed)
- [ ] Active pill countdown decrements in `_process(delta)`, resets on ROUND_RESOLVED
- [ ] RowLabels VBoxContainer at child index 0 of GridRow (left of attacker grid)
- [ ] Nation ColorRects use NATION_COLORS[nation_id] or NATION_NEUTRAL fallback
- [ ] "close anytime" hint label in HeaderRow (right-aligned, muted)
- [ ] ContextBanner node in PanelContent between SubtitleRow and GridRow
- [ ] session_manager FLANK_ATTACK reads `attacker_a` not `flanker_id`
- [ ] FlankChip visible on `show_flank_status("flank")`, hidden on `"none"`
- [ ] GUT: **34 passing**, 0 failures
