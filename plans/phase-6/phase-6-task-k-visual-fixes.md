# Plan: Branch K Visual Fixes — TacticalCombatPanel + EngagementBanner

> **Branch:** `feat/tactical-grid-ui` (already in progress)
> **Approach:** TDD — write failing assertion → implement fix → verify GREEN → commit

## Context

Task K execution produced a working but visually broken result:

- **TacticalCombatPanel** (screenshot 1): ~250 px gap between grids, HP bars at top of cells, default Godot PanelContainer glow on the panel background
- **EngagementBanner** (screenshot 2): `⚔` emoji fails to render with fallback font; border should be dashed dark-ink to match the tactical-overlay aesthetic of the map

### Root cause analysis

**HP bar position**: `UnitLabel` in `grid_cell.tscn` is missing `size_flags_vertical = 3` (EXPAND_FILL), so it does not push `BarsBox` to the bottom of the VBoxContainer.

**Grid gap**: `GridRow` (HBoxContainer in `tactical_combat_panel.tscn`) has no `separation` constant override. Both child `GridContainer` nodes have `size_flags_horizontal = 3` (EXPAND_FILL). Without an explicit pinned separation, Godot's default HBoxContainer theme constant applies, producing an unexpectedly large gap.

**Panel glow / dark style**: Godot's default `PanelContainer` StyleBox applies a shadow/glow effect. `_apply_cream_style()` replaces it, but it was being called before `await get_tree().process_frame` in `_ready()`. Godot re-propagates theme after `_ready()` returns synchronously, so the style call fires too early. The fix: `await` one frame first, then call `_apply_cream_style()`.

Note: `hud_dark.tres` is on `HUDRoot`, which is a **sibling** of `TacticalCombatPanel` (both are direct children of `GameHUD CanvasLayer`). Godot 4 theme inheritance only propagates down the parent chain, not across siblings — so `hud_dark.tres` cannot bleed into `TacticalCombatPanel` at all.

### Test file conventions

Tests live at `client/test/` (no `gut/` subdirectory). All test files:
- `extend Node`
- Run assertions inline in `_ready()`
- Use `_assert_true(value, msg)`, `_assert_false(value, msg)`, `_assert_almost_eq(actual, expected, tol, msg)`
- Track failures via `var _failed: bool = false`
- Exit with `get_tree().quit(0)` (pass) or `get_tree().quit(1)` (fail)
- No `add_child_autofree` — use `add_child(node)` directly

### Target banner design

```
 ╔ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╗
 │  [██████████░░░░░░]   ✕   [░░░░░░█████████████████]  │
 ╚ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╝
       ATK HP (fills left→right)    DEF HP (fills left→right)

NORMAL STATE  — dashed near-black border  Color(0.08, 0.05, 0.02)
WARNING STATE — dashed amber border       Color(0.85, 0.55, 0.10)  (pulsing alpha 0.6–1.0)
dash = 4 px, gap = 4 px  (matches fog-of-war cell pattern in K-Polish)
Centre glyph = two drawn lines (X shape), not an emoji character
```

---

## Task 1 — GridCell HP bar position  (RED → GREEN)

### Step 1 — Add failing assertion to `client/test/test_tactical_combat_panel.gd`

Append the following block **before** the `if _failed:` guard at the bottom of `_ready()`:

```gdscript
# Task 1: HP bars must appear in lower half of cell
var cell = preload("res://scenes/game/panels/grid_cell.tscn").instantiate()
add_child(cell)
cell.custom_minimum_size = Vector2(72, 72)
cell.size = Vector2(72, 72)
cell.display({"unit_type": "infantry", "hp": 80.0})
await get_tree().process_frame
var bars_box = cell.get_node("VBoxContainer/BarsBox")
_assert_true(bars_box.position.y > cell.size.y * 0.5,
    "BarsBox must be in lower half of cell (HP bars at bottom)")
```

### Step 2 — Run test scene → expect RED (assertion fails)

### Step 3 — Fix `client/scenes/game/panels/grid_cell.tscn`

Add `size_flags_vertical = 3` and `vertical_alignment = 1` to the `UnitLabel` node.
This makes the label expand to fill available vertical space, pushing BarsBox to the bottom.

```
[node name="UnitLabel" type="Label" parent="VBoxContainer"]
layout_mode = 2
size_flags_horizontal = 3
size_flags_vertical = 3
horizontal_alignment = 1
vertical_alignment = 1
theme_override_font_sizes/font_size = 11
```

No change to `grid_cell.gd`.

### Step 4 — Run test scene → expect GREEN

### Step 5 — Commit

```bash
git add client/scenes/game/panels/grid_cell.tscn
git commit -m "fix: GridCell HP bars pushed to bottom via UnitLabel EXPAND_FILL"
```

---

## Task 2 — TacticalCombatPanel style isolation + grid gap  (RED → GREEN)

### Step 6 — Confirm existing test RED (or check runtime)

If `test_panel_bg_is_cream_not_dark` exists in `client/test/test_tactical_combat_panel.gd`,
run it. It should fail because `_apply_cream_style()` fires before the process frame, meaning
Godot's default PanelContainer style re-propagates over it.

If the test already passes in isolation (no parent providing a dark theme), proceed to Step 7
anyway — the real runtime fix is still needed.

### Step 7 — Fix `client/src/ui/hud/tactical_combat_panel.gd`

Replace the full `_ready()` body so that:
1. Grid build and signal wiring happen synchronously first
2. One frame is awaited so Godot finishes its own theme propagation pass
3. Style application and the separation override happen after the await

```gdscript
func _ready() -> void:
	hide()
	mouse_filter = MOUSE_FILTER_STOP

	_build_grid(_atk_grid)
	_build_grid(_def_grid)

	_close_btn.pressed.connect(func(): EventBus.tactical_combat_closed.emit())
	EventBus.tactical_combat_opened.connect(_on_opened)
	EventBus.tactical_combat_closed.connect(_on_closed)
	EventBus.round_resolved.connect(_on_round_resolved)

	# Await one frame: Godot re-propagates its own default theme after _ready() returns
	# synchronously. Applying cream style without awaiting has no lasting effect.
	await get_tree().process_frame
	theme = null
	_apply_cream_style()
	_tint_all_labels()
	_style_all_buttons()
	# Pin grid separation explicitly so layout is not affected by any default theme constant
	$PanelContent/GridRow.add_theme_constant_override("separation", 24)
```

### Step 8 — Run test scene → expect GREEN

`test_panel_bg_is_cream_not_dark`, `test_attacker_grid_has_25_cells`, and
`test_tactical_combat_opened_shows_panel` should all pass.

### Step 9 — Commit

```bash
git add client/src/ui/hud/tactical_combat_panel.gd
git commit -m "fix: TacticalCombatPanel style applied after await, grid separation pinned to 24px"
```

---

## Task 3 — EngagementBanner dashed dark border + X glyph  (RED → GREEN)

### Step 10 — Add failing assertions to `client/test/test_engagement_banner.gd`

Append the following block **before** the `if _failed:` guard at the bottom of `_ready()`:

```gdscript
# Task 3: Banner must expose dashed-border API
_assert_true(_banner.has_method("get_uses_dashed_border"),
    "banner must have get_uses_dashed_border()")
_assert_true(_banner.has_method("get_border_color"),
    "banner must have get_border_color()")
_assert_true(_banner.get_uses_dashed_border(),
    "banner must use dashed border style (not solid)")
var border_col: Color = _banner.get_border_color()
_assert_true(border_col.r < 0.15, "border red channel must be near-black")
_assert_true(border_col.g < 0.10, "border green channel must be near-black")
```

### Step 11 — Run test scene → expect RED (new assertions fail)

### Step 12 — Update `client/src/systems/military/engagement_banner.gd`

**a) Replace C_BORDER color constant (near-black ink, was brown):**

```gdscript
const C_BORDER: Color = Color(0.08, 0.05, 0.02, 1.0)
# C_AMBER, C_BG, C_BAR_FILL, C_BAR_EMPTY, C_SWORD stay unchanged
```

**b) Add public API methods and `_draw_dashed_border` helper:**

```gdscript
func get_uses_dashed_border() -> bool: return true

func get_border_color() -> Color:
	return C_AMBER if _suppression_warn else C_BORDER

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

**c) Rewrite `_draw()` — dashed border + drawn X glyph (no emoji):**

```gdscript
func _draw() -> void:
	var hw := BANNER_W * 0.5
	var hh := BANNER_H * 0.5

	# Background
	draw_rect(Rect2(Vector2(-hw, -hh), Vector2(BANNER_W, BANNER_H)), C_BG)

	# Dashed border (amber when warning, dark ink otherwise)
	var border_col := C_AMBER if _suppression_warn else C_BORDER
	if _suppression_warn:
		border_col.a = _pulse_alpha
	_draw_dashed_border(Rect2(Vector2(-hw, -hh), Vector2(BANNER_W, BANNER_H)),
		border_col, 4.0, 4.0)

	# HP bars
	var bar_y := -BAR_H * 0.5
	var atk_x := -hw + 8.0
	draw_rect(Rect2(Vector2(atk_x, bar_y), Vector2(BAR_W, BAR_H)), C_BAR_EMPTY)
	draw_rect(Rect2(Vector2(atk_x, bar_y), Vector2(BAR_W * _atk_hp_pct, BAR_H)), C_BAR_FILL)

	var def_x := SWORD_ZONE * 0.5 + 4.0
	draw_rect(Rect2(Vector2(def_x, bar_y), Vector2(BAR_W, BAR_H)), C_BAR_EMPTY)
	draw_rect(Rect2(Vector2(def_x, bar_y), Vector2(BAR_W * _def_hp_pct, BAR_H)), C_BAR_FILL)

	# Centre X glyph — two drawn lines, no emoji dependency
	draw_line(Vector2(-5.0, -5.0), Vector2( 5.0,  5.0), C_SWORD, 1.5)
	draw_line(Vector2( 5.0, -5.0), Vector2(-5.0,  5.0), C_SWORD, 1.5)
```

### Step 13 — Run test scene → expect GREEN (5 new assertions pass, all original assertions still pass)

### Step 14 — Commit

```bash
git add client/src/systems/military/engagement_banner.gd
git commit -m "fix: EngagementBanner dashed dark-ink border and drawn X glyph (no emoji)"
```

---

## Verification checklist

- [ ] Test scene: all assertions in `test_tactical_combat_panel.gd` pass
- [ ] Test scene: all assertions in `test_engagement_banner.gd` pass (original + 5 new)
- [ ] Runtime: cream panel background, no Godot default glow on the PanelContainer
- [ ] Runtime: ~24 px gap between attacker and defender grids (not ~250 px)
- [ ] Runtime: HP bars appear at **bottom** of each GridCell
- [ ] Runtime: EngagementBanner has dashed dark-ink border, switches to dashed amber on warning
- [ ] Runtime: Banner centre shows a clean X mark (not a broken emoji or blank)
