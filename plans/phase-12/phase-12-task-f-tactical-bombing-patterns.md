# Branch F — `feat/tactical-bombing-patterns`

## Context

Branch F adds air-to-ground bombing resolution. When a tactical/CAS/dive bomber wing arrives at
its target province and a land engagement is active there, the wing applies a bombing pattern to
the defender's 5×5 tactical grid — reducing HP on specific cells — then RTBs. Results are shown
via a timed fire icon on the map; clicking it opens a compact bombing detail panel.

This branch is the first Phase 12 branch to touch Phase 6 land combat infrastructure
(`CombatSystem`, `GridCellState`). **Read Phase 6 files carefully before touching anything.**

**Test-Driven Development is mandatory.** Pure function tests come first (no server needed),
then integration tests.

Can run **parallel with Branch E** — no shared files except `GameRoom.ts`.

---

## Critical Pre-Read: Existing Code Facts

### Grid coordinate system — MEMORISE THIS

```
Cell index = row * 5 + col    (row 0 = rear/back, row 4 = front)

row 4 (front):   [20][21][22][23][24]
row 3:           [15][16][17][18][19]
row 2:           [10][11][12][13][14]
row 1:           [ 5][ 6][ 7][ 8][ 9]
row 0 (rear):    [ 0][ 1][ 2][ 3][ 4]
```

- "Frontmost occupied enemy row" for tactical bomber = **highest row index** with any non-empty cell
- "Column" for CAS = all cells sharing the same `col` value (col = index % 5)
- "Single cell" for dive bomber = one cell_index with the highest scoring cell

### GridCellState fields (read from `game-server/src/types/tactical_types.ts`)

```typescript
{
  unit_type: string;         // "" = empty cell
  hp: number;                // 0–100
  suppression: number;       // 0–100
  incapacitated: boolean;
  xp_tier: string;           // "green" | "seasoned" | "veteran" | "elite"
  stealthed: boolean;
}
```

A cell is **occupied** when `unit_type !== ""` AND `!incapacitated`.
A cell is a **soft target** when unit_type is NOT in the hard-target set:
`["light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun", "at_gun_sp",
  "artillery", "howitzer", "self_propelled_gun"]`
All other unit types are soft targets.

### CombatSystem — where to find active engagements

File: `game-server/src/systems/combat_system.ts`

The execution agent MUST read `combat_system.ts` to find:
1. The name of the private engagements map (likely `_engagements` or `_pairs`)
2. Each engagement's structure — specifically: `province_id` or the position fields of the
   two divisions involved
3. The method (or lack thereof) to look up an engagement by province position

**Add a new public method** `getEngagementAtPosition(lng: number, lat: number, radiusDeg: number)`
that returns the matching engagement (or undefined). The execution agent must implement this
based on how `combat_system.ts` actually stores engagement data — do NOT guess field names.

### TacticalCombatPanel — grid construction code to copy

File: `client/src/ui/hud/tactical_combat_panel.gd`

The panel builds its 5×5 grids in `_build_grid()` and updates cells via `_update_cell(index, data)`.
The BombingDetailPanel must copy these functions **verbatim** and adapt:
- Use ONE grid (defender only) instead of two
- Show hit cells with a red highlight overlay instead of unit glyphs
- Omit HP/suppression status bars

Copy `GLYPH_SCENE` preload path exactly:
```gdscript
const GLYPH_SCENE = preload("res://src/ui/components/unit_glyph_cell/unit_glyph_cell.tscn")
```
Verify this path exists before using it.

### EngagementBanner — map marker code to copy

File: `client/src/systems/military/engagement_banner.gd`

The BombingRunIndicator copies EngagementBanner's:
- `extends Node2D` base
- `position = map_loader.project_lng_lat(lng, lat)` positioning
- `_draw()` circle + icon drawing
- `_input(event)` click detection for opening the detail panel
- `queue_redraw()` call pattern

Copy the `_input(event)` click handler verbatim and adapt the callback to open
`BombingDetailPanel` instead of TacticalCombatPanel.

### HUDManager — panel registration pattern

File: `client/src/ui/hud/game_hud.gd`

```gdscript
# HOW TO REGISTER A NEW PANEL (copy this pattern):
_bombing_detail_panel = BombingDetailPanelScene.instantiate()
add_child(_bombing_detail_panel)
hud_manager.register_panel("bombing_detail", _bombing_detail_panel, HUDManager.PlacementMode.FULL_CENTER)

# HOW TO SHOW/HIDE:
hud_manager.show_panel("bombing_detail")
hud_manager.hide_panel("bombing_detail")
```

### session_manager.gd — how to add a new message handler

File: `client/src/systems/session/session_manager.gd`

Find the match block handling room messages (near `"AIR_WING_UPDATES"`, `"WING_DETECTED"` etc.)
and add:
```gdscript
"AIR_BOMBING_RESULT":
    EventBus.air_bombing_result.emit(data)
```

### event_bus.gd — signal declaration pattern

File: `client/src/core/event_bus.gd`

After the existing air signals, add:
```gdscript
signal air_bombing_result(data: Dictionary)
```

### SVG icon loading pattern

```gdscript
const FIRE_ICON: Texture2D = preload("res://assets/icons/fire-solid-full.svg")

# In _draw(), draw the icon inside a TextureRect or via draw_texture():
draw_texture_rect(FIRE_ICON, Rect2(Vector2(-12, -12), Vector2(24, 24)), false)
```

### AirWingState perk fields

File: `game-server/src/rooms/schema/AirWingState.ts`

The execution agent MUST read this file and find the exact names of perk boolean fields.
Expected names (verify — do NOT assume):
- `perk_strafing: boolean` — enables fighter strafing column (CAS-style column for fighters)
- `perk_precision: boolean` — dive bomber hits 2 cells instead of 1

If the field names differ from above, use the actual names throughout.

### gameTick order (post-Branch E)

```
airWingLifecycleSystem.tick()
→ RTB path loop
→ airDubinsPathfinder.tick()
→ RELOCATE path loop
→ pending-transit loop
→ AirCombatSystem.tick()         (Branch E)
→ AirBombingSystem.tick()        ← NEW (Branch F) — insert here
→ AirDetectionSystem.tick()
→ DIVISION_UPDATES
```

If Branch E is NOT yet merged, insert AirBombingSystem.tick() before AirDetectionSystem.tick()
and after the pending-transit loop. Do NOT create a compile dependency on AirCombatSystem.

### Existing test-only handlers (already registered — do NOT re-register)

`SPAWN_WING`, `SET_WING_LIFECYCLE`, `SET_WING_READINESS`, `SET_WING_FUEL`, `SET_WING_TARGET`,
`SET_PATH_ELAPSED`, `SET_PROVINCE_RADAR`, `SET_WING_POSITION`, `SIMULATE_ENGAGEMENT_START`,
`SET_WING_COUNT`, `SET_WING_STATUS_FUEL`.

**`SPAWN_LAND_ENGAGEMENT`** does NOT exist yet — add in Step 5.

### Test file naming

`game-server/test/12f-air-bombing-patterns.test.ts` — timeout `180_000`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/data/air_bombing_stats.ts` | Per-aircraft damage constants |
| `game-server/src/systems/air_attack_pattern_registry.ts` | Pure pattern functions |
| `game-server/src/systems/air_bombing_system.ts` | Orchestration system |
| `game-server/test/12f-air-bombing-patterns.test.ts` | All bombing tests |
| `client/src/systems/air/bombing_run_indicator.gd` | Timed map marker (based on engagement_banner.gd) |
| `client/src/ui/hud/bombing_detail_panel.gd` | Click-to-open detail popup (based on tactical_combat_panel.gd) |
| `client/src/ui/hud/bombing_detail_panel.tscn` | Scene for the detail panel |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/systems/combat_system.ts` | Add `getEngagementAtPosition()` public method |
| `game-server/src/rooms/GameRoom.ts` | Add `airBombingSystem` field; wire into tick; add `SPAWN_LAND_ENGAGEMENT` test handler |
| `game-server/package.json` | Append 12f to test chain |
| `client/src/core/event_bus.gd` | Add `air_bombing_result` signal |
| `client/src/systems/session/session_manager.gd` | Add `AIR_BOMBING_RESULT` handler |
| `client/src/systems/air/air_wing_system.gd` | Manage BombingRunIndicator nodes; handle bombing result signal |
| `client/src/ui/hud/game_hud.gd` | Register BombingDetailPanel with HUDManager |

---

## ASCII UI Reference

### Bombing Run Indicator (map marker)

Appears at the province position on the map. Uses the fire icon. Pulses briefly on creation
then fades. Auto-dismisses after 5 seconds if not clicked. Shows a small badge with the
number of bombing runs if multiple runs were batched.

```
         ┌───┐
         │ 🔥│ ← fire-solid-full.svg (24×24px), red tint
         │ 2 │ ← run count badge (hidden if only 1 run)
         └───┘
           ↑
      province center
      + offset (-32px Y)
```

Drawn in `_draw()` on a Node2D placed at the province position:

```gdscript
func _draw() -> void:
    # Background circle (semi-transparent red)
    draw_circle(Vector2.ZERO, 18.0, Color(0.8, 0.1, 0.1, 0.75))
    # Fire icon
    draw_texture_rect(FIRE_ICON, Rect2(Vector2(-10, -13), Vector2(20, 20)), false)
    # Run count badge (only if > 1 run)
    if _runs.size() > 1:
        draw_circle(Vector2(12, -12), 9.0, Color(0.9, 0.9, 0.0, 0.9))
        # Render count number via Label child node (add in _ready())
```

Auto-dismiss timer progress bar — drawn as a thin arc below the circle:

```gdscript
    # Timer arc (white → fades as timer runs out)
    var progress := 1.0 - (_timer / AUTO_DISMISS_SEC)
    draw_arc(Vector2.ZERO, 22.0, -PI * 0.5, -PI * 0.5 + TAU * progress,
             32, Color(1, 1, 1, 0.6 * progress), 2.0)
```

### BombingDetailPanel — Tactical Bomber (row hit)

```
┌─────────────────────────────────────────────┐
│  🔥  TACTICAL BOMBING              [✕ close] │
│  Germany  ·  12 × Tactical Bomber            │
├─────────────────────────────────────────────┤
│  Île-de-France                               │
│                                              │
│   ○  ○  ○  ○  ○    (rear)                  │
│   ○  ○  ○  ○  ○                             │
│   ○  ○  ○  ○  ○                             │
│   ○  ○  ○  ○  ○                             │
│  [●][●][●][●][●]   (front)  −18 casualties  │
│                                              │
│  Front row struck  ·  18 casualties          │
├─────────────────────────────────────────────┤
│  [█████████████████░░░░░░]   4.2s            │
└─────────────────────────────────────────────┘
```

### BombingDetailPanel — CAS Plane (column strafe)

```
┌─────────────────────────────────────────────┐
│  🔥  CLOSE AIR SUPPORT             [✕ close] │
│  Germany  ·  10 × CAS Plane                  │
├─────────────────────────────────────────────┤
│  Île-de-France                               │
│                                              │
│   ○  ○  ○  ○  ○    (rear)                  │
│   ○  ○ [●] ○  ○               −6 artillery  │
│   ○  ○ [●] ○  ○              −11 infantry   │
│   ○  ○ [●] ○  ○               −8 infantry   │
│   ○  ○ [●] ○  ○    (front)    −9 infantry   │
│                                              │
│  Column 3 strafed  ·  34 casualties          │
├─────────────────────────────────────────────┤
│  [█████████████████░░░░░░]   4.2s            │
└─────────────────────────────────────────────┘
```

### BombingDetailPanel — Dive Bomber (single cell)

```
┌─────────────────────────────────────────────┐
│  🔥  DIVE BOMB                     [✕ close] │
│  France  ·  8 × Dive Bomber                  │
├─────────────────────────────────────────────┤
│  Rhine Province                              │
│                                              │
│   ○  ○  ○  ○  ○    (rear)                  │
│   ○  ○  ○  ○  ○                             │
│   ○  ○  ○  ○  ○                             │
│   ○  ○ [●] ○  ○               −9 artillery  │
│   ○  ○  ○  ○  ○    (front)                  │
│                                              │
│  Artillery cell struck  ·  9 casualties      │
├─────────────────────────────────────────────┤
│  [█████████████████░░░░░░]   4.2s            │
└─────────────────────────────────────────────┘
```

### BombingDetailPanel — batched (multiple runs, same province)

```
┌─────────────────────────────────────────────┐
│  🔥  BOMBING RUN × 2               [✕ close] │
│  Germany  ·  Île-de-France                   │
├─────────────────────────────────────────────┤
│  12 × Tactical Bomber                        │
│   ○  ○  ○  ○  ○                             │
│  [●][●][●][●][●]   (front)  −18 casualties  │
├─────────────────────────────────────────────┤
│  10 × CAS Plane                              │
│   ○  ○ [●] ○  ○               −6 art        │
│   ○  ○ [●] ○  ○              −11 inf        │
│   ○  ○ [●] ○  ○               −8 inf        │
│   ○  ○ [●] ○  ○               −9 inf        │
├─────────────────────────────────────────────┤
│  Total  ·  52 casualties                     │
├─────────────────────────────────────────────┤
│  [█████████████████░░░░░░]   4.2s            │
└─────────────────────────────────────────────┘
```

**Grid cell symbols:**
- `○` — untouched cell (or empty)
- `[●]` — struck cell (red fill)
- Damage label appears inline on the same row as struck cells

**Progress bar:** drains left-to-right over AUTO_DISMISS_SEC. Implemented as a TextureProgressBar or drawn via `draw_rect` in `_draw()` using the `_timer / AUTO_DISMISS_SEC` ratio.

---

## Step 1: Create `air_bombing_stats.ts`

Create `game-server/src/data/air_bombing_stats.ts`:

```typescript
// Base damage per aircraft (tunable starting points — adjust during playtesting)
export const BOMBING_STATS = {
  tactical_bomber: { hp_per_plane: 8.0,  supp_per_plane: 4.0  },
  cas_plane:       { hp_per_plane: 6.0,  supp_per_plane: 8.0  },  // more suppression
  dive_bomber:     { hp_per_plane: 12.0, supp_per_plane: 2.0  },  // concentrated
  // Fighters with perk_strafing use cas_plane values
} as const;

export const BOMBING_RANGE_DEG = 0.5;  // how close wing must be to province center to bomb

// Noise floor: score added to every cell to prevent 100% determinism even with high recon
export const TARGET_NOISE_FLOOR = 0.1;
```

---

## Step 2: Create `air_attack_pattern_registry.ts` (pure functions, no state)

Create `game-server/src/systems/air_attack_pattern_registry.ts`.

### Types

```typescript
export interface CellSnapshot {
  unit_type: string;
  hp: number;
  suppression: number;
  incapacitated: boolean;
  soft_target?: boolean;  // pre-computed by caller
}

export interface BombingContext {
  aircraft_type: string;
  count: number;
  combat_readiness: number;
  perk_strafing: boolean;
  perk_precision: boolean;
  recon_quality: number;      // 0.0 (pure random) – 1.0 (fully prioritised)
}

export interface CellHit {
  cell_index: number;
  hp_damage: number;
  supp_damage: number;
}

export interface PatternResult {
  hit_cells: CellHit[];
  pattern_type: string;
  total_hp_damage: number;
}
```

### Helpers

```typescript
const HARD_TARGET_TYPES = new Set([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car",
  "at_gun", "at_gun_sp", "artillery", "howitzer", "self_propelled_gun",
]);

function isOccupied(cell: CellSnapshot): boolean {
  return cell.unit_type !== "" && !cell.incapacitated;
}

function isSoft(cell: CellSnapshot): boolean {
  return !HARD_TARGET_TYPES.has(cell.unit_type);
}

// Replaceable for testing — allows deterministic tests
let _rng: () => number = Math.random;
export function setRngForTesting(fn: () => number): void { _rng = fn; }
export function resetRng(): void { _rng = Math.random; }

function scoreCell(cell: CellSnapshot, recon_quality: number): number {
  if (!isOccupied(cell)) return 0;
  const base = cell.hp / 100.0;   // prefer full-HP (high-value) cells
  const soft_bonus = isSoft(cell) ? 0.3 : 0.0;
  const noise = _rng() * TARGET_NOISE_FLOOR;
  return base * recon_quality + soft_bonus * recon_quality + noise;
}
```

### Pattern functions

#### Dive bomber — single cell (or 2 with perk_precision)
```typescript
export function resolveDivePattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.dive_bomber;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  // Score all occupied cells
  const scored = cells
    .map((c, i) => ({ i, score: scoreCell(c, ctx.recon_quality) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const num_targets = ctx.perk_precision ? 2 : 1;
  const targets = scored.slice(0, num_targets);

  const hit_cells: CellHit[] = targets.map(t => ({
    cell_index: t.i,
    hp_damage: Math.floor(total_hp / targets.length),
    supp_damage: Math.floor(total_supp / targets.length),
  }));

  return { hit_cells, pattern_type: "dive", total_hp_damage: hit_cells.reduce((s, h) => s + h.hp_damage, 0) };
}
```

#### Tactical bomber — frontmost occupied enemy row
```typescript
export function resolveTacticalPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.tactical_bomber;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  // Find frontmost (highest row index) occupied row
  let target_row = -1;
  for (let row = 4; row >= 0; row--) {
    const row_cells = [0, 1, 2, 3, 4].map(col => cells[row * 5 + col]);
    if (row_cells.some(isOccupied)) { target_row = row; break; }
  }

  if (target_row === -1) return { hit_cells: [], pattern_type: "tactical", total_hp_damage: 0 };

  const row_occupied = [0, 1, 2, 3, 4]
    .map(col => ({ idx: target_row * 5 + col, cell: cells[target_row * 5 + col] }))
    .filter(x => isOccupied(x.cell));

  const hit_cells: CellHit[] = row_occupied.map(x => ({
    cell_index: x.idx,
    hp_damage: Math.floor(total_hp / row_occupied.length),
    supp_damage: Math.floor(total_supp / row_occupied.length),
  }));

  return { hit_cells, pattern_type: "tactical", total_hp_damage: hit_cells.reduce((s, h) => s + h.hp_damage, 0) };
}
```

#### CAS bomber — column strafe
```typescript
export function resolveCasPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  const { hp_per_plane, supp_per_plane } = BOMBING_STATS.cas_plane;
  const total_hp = hp_per_plane * ctx.count * ctx.combat_readiness;
  const total_supp = supp_per_plane * ctx.count * ctx.combat_readiness;

  // Find best column: score = sum of cell scores across all rows
  let best_col = 0;
  let best_col_score = -1;
  for (let col = 0; col < 5; col++) {
    const col_score = [0, 1, 2, 3, 4]
      .map(row => scoreCell(cells[row * 5 + col], ctx.recon_quality))
      .reduce((a, b) => a + b, 0);
    if (col_score > best_col_score) { best_col_score = col_score; best_col = col; }
  }

  const col_occupied = [0, 1, 2, 3, 4]
    .map(row => ({ idx: row * 5 + best_col, cell: cells[row * 5 + best_col] }))
    .filter(x => isOccupied(x.cell));

  if (col_occupied.length === 0) return { hit_cells: [], pattern_type: "cas", total_hp_damage: 0 };

  const hit_cells: CellHit[] = col_occupied.map(x => ({
    cell_index: x.idx,
    hp_damage: Math.floor(total_hp / col_occupied.length),
    supp_damage: Math.floor(total_supp / col_occupied.length),
  }));

  return { hit_cells, pattern_type: "cas", total_hp_damage: hit_cells.reduce((s, h) => s + h.hp_damage, 0) };
}
```

#### Fighter strafing — column (only when perk_strafing = true, identical logic to CAS)
```typescript
export function resolveFighterStrafingPattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  if (!ctx.perk_strafing) return { hit_cells: [], pattern_type: "fighter_strafe", total_hp_damage: 0 };
  // Same column logic as CAS — uses CAS stats
  return { ...resolveCasPattern(cells, ctx), pattern_type: "fighter_strafe" };
}
```

#### Dispatch function (called by AirBombingSystem)
```typescript
export function resolvePattern(cells: CellSnapshot[], ctx: BombingContext): PatternResult {
  switch (ctx.aircraft_type) {
    case "dive_bomber":      return resolveDivePattern(cells, ctx);
    case "tactical_bomber":
    case "cas_plane":        return ctx.aircraft_type === "cas_plane"
                               ? resolveCasPattern(cells, ctx)
                               : resolveTacticalPattern(cells, ctx);
    case "fighter":
    case "heavy_fighter":    return resolveFighterStrafingPattern(cells, ctx);
    default:                 return { hit_cells: [], pattern_type: "none", total_hp_damage: 0 };
  }
}
```

---

## Step 3: Write All Tests First (TDD)

Create `game-server/test/12f-air-bombing-patterns.test.ts`.

### Pure function test setup

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { WING_LIFECYCLE, MISSION_TYPES, AIR_UNIT_TYPES } from "../src/rooms/schema/AirWingState.js";
import {
  resolveDivePattern, resolveTacticalPattern, resolveCasPattern,
  resolveFighterStrafingPattern, setRngForTesting, resetRng,
  type CellSnapshot, type BombingContext,
} from "../src/systems/air_attack_pattern_registry.js";
import {
  setRtbDurationTicksForTesting,
  setRefuelDurationTicksForTesting,
} from "../src/systems/air_wing_lifecycle_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}
```

### Grid fixture helpers

```typescript
// Make a 25-cell grid. occupied = list of {index, unit_type?, hp?}
function makeGrid(occupied: Array<{ index: number; unit_type?: string; hp?: number }>): CellSnapshot[] {
  const cells: CellSnapshot[] = Array(25).fill(null).map(() => ({
    unit_type: "", hp: 0, suppression: 0, incapacitated: false,
  }));
  for (const o of occupied) {
    cells[o.index] = {
      unit_type: o.unit_type ?? "infantry",
      hp:        o.hp       ?? 80,
      suppression: 0,
      incapacitated: false,
    };
  }
  return cells;
}

const DEFAULT_CTX: BombingContext = {
  aircraft_type:    "dive_bomber",
  count:            10,
  combat_readiness: 1.0,
  perk_strafing:    false,
  perk_precision:   false,
  recon_quality:    0.0,
};
```

### Pure function tests (no server needed)

```typescript
describe("AirAttackPatternRegistry — pure unit tests", () => {

  describe("Dive bomber", () => {
    it("hits exactly 1 occupied cell by default", () => {
      const cells = makeGrid([{ index: 5 }, { index: 10 }, { index: 20 }]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, aircraft_type: "dive_bomber" });
      assert.strictEqual(result.hit_cells.length, 1);
    });

    it("hits 2 cells with perk_precision", () => {
      const cells = makeGrid([{ index: 5 }, { index: 10 }, { index: 20 }]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, perk_precision: true });
      assert.strictEqual(result.hit_cells.length, 2);
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveDivePattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("with high recon_quality, consistently prefers high-HP cell over low-HP cell", () => {
      // Make RNG always return 0 so noise = 0 → purely recon-driven
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 5, hp: 20 },   // low value
        { index: 10, hp: 95 },  // high value — should be preferred
      ]);
      const result = resolveDivePattern(cells, { ...DEFAULT_CTX, recon_quality: 1.0 });
      assert.strictEqual(result.hit_cells[0].cell_index, 10, "high-HP cell must be preferred");
      resetRng();
    });

    it("with recon_quality=0, noise floor can select either cell (both valid)", () => {
      // With pure noise (recon=0), all occupied cells are candidates
      const hits = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const cells = makeGrid([{ index: 5, hp: 20 }, { index: 10, hp: 95 }]);
        const result = resolveDivePattern(cells, { ...DEFAULT_CTX, recon_quality: 0.0 });
        if (result.hit_cells.length > 0) hits.add(result.hit_cells[0].cell_index);
      }
      assert.ok(hits.size > 1, "with recon_quality=0 and 20 rolls, both cells must appear at least once (noise floor)");
    });

    it("hit cell takes damage proportional to count", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([{ index: 20 }]);
      const r5  = resolveDivePattern(cells, { ...DEFAULT_CTX, count: 5,  recon_quality: 1.0 });
      const r10 = resolveDivePattern(cells, { ...DEFAULT_CTX, count: 10, recon_quality: 1.0 });
      assert.ok(r10.hit_cells[0].hp_damage > r5.hit_cells[0].hp_damage, "more planes = more damage");
      resetRng();
    });
  });

  describe("Tactical bomber", () => {
    it("hits all occupied cells in the frontmost (highest index) row", () => {
      // Row 4 (front) = indices 20–24, row 2 = indices 10–14
      const cells = makeGrid([{ index: 10 }, { index: 12 }, { index: 20 }, { index: 22 }]);
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber" });
      const hitIndices = result.hit_cells.map(h => h.cell_index).sort();
      assert.deepStrictEqual(hitIndices, [20, 22], "must hit row 4 (frontmost), not row 2");
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveTacticalPattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("falls back to next row when frontmost row is fully incapacitated", () => {
      const cells = makeGrid([{ index: 10 }, { index: 12 }]);
      // All row-4 cells empty — must fall back to row 2
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber" });
      const hitIndices = result.hit_cells.map(h => h.cell_index).sort();
      assert.deepStrictEqual(hitIndices, [10, 12]);
    });

    it("damage spreads equally across all occupied cells in the target row", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([{ index: 20 }, { index: 22 }, { index: 24 }]);
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber", recon_quality: 1.0 });
      const damages = result.hit_cells.map(h => h.hp_damage);
      // All three should receive equal damage (within 1 due to flooring)
      assert.ok(Math.max(...damages) - Math.min(...damages) <= 1, "damage must be equal across row cells");
      resetRng();
    });
  });

  describe("CAS plane (column strafe)", () => {
    it("hits cells from a single column only", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 },  // row0, col2
        { index: 7 },  // row1, col2
        { index: 12 }, // row2, col2
        { index: 0 },  // row0, col0 — different column
      ]);
      const result = resolveCasPattern(cells, { ...DEFAULT_CTX, aircraft_type: "cas_plane", recon_quality: 1.0 });
      const cols = result.hit_cells.map(h => h.cell_index % 5);
      assert.ok(cols.every(c => c === cols[0]), "all hits must be in the same column");
      resetRng();
    });

    it("returns 0 hit_cells on empty grid", () => {
      const result = resolveCasPattern(makeGrid([]), DEFAULT_CTX);
      assert.strictEqual(result.hit_cells.length, 0);
    });

    it("hits cells across multiple rows (full column, not just one cell)", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 }, { index: 7 }, { index: 12 }, { index: 17 }, { index: 22 }, // all col2
      ]);
      const result = resolveCasPattern(cells, { ...DEFAULT_CTX, aircraft_type: "cas_plane", recon_quality: 1.0 });
      assert.strictEqual(result.hit_cells.length, 5, "all 5 occupied cells in column must be hit");
      resetRng();
    });

    it("pattern_type is 'cas'", () => {
      const cells = makeGrid([{ index: 2 }]);
      const result = resolveCasPattern(cells, DEFAULT_CTX);
      assert.strictEqual(result.pattern_type, "cas");
    });
  });

  describe("Fighter strafing perk", () => {
    it("with perk_strafing=false returns 0 hits (no strafe without perk)", () => {
      const cells = makeGrid([{ index: 2 }, { index: 7 }]);
      const result = resolveFighterStrafingPattern(cells, { ...DEFAULT_CTX, aircraft_type: "fighter", perk_strafing: false });
      assert.strictEqual(result.hit_cells.length, 0, "fighter without strafing perk must not attack ground");
    });

    it("with perk_strafing=true hits a column (NOT a row)", () => {
      setRngForTesting(() => 0);
      const cells = makeGrid([
        { index: 2 }, { index: 7 }, { index: 12 }, // col 2 — all rows
        { index: 20 }, { index: 21 }, { index: 22 }, { index: 23 }, { index: 24 }, // row 4 — all cols
      ]);
      const result = resolveFighterStrafingPattern(cells, {
        ...DEFAULT_CTX, aircraft_type: "fighter", perk_strafing: true, recon_quality: 1.0,
      });
      const cols = result.hit_cells.map(h => h.cell_index % 5);
      assert.ok(cols.every(c => c === cols[0]), "fighter strafe must be a COLUMN, not a row");
      resetRng();
    });

    it("pattern_type is 'fighter_strafe'", () => {
      const cells = makeGrid([{ index: 2 }]);
      const result = resolveFighterStrafingPattern(cells, { ...DEFAULT_CTX, perk_strafing: true });
      assert.strictEqual(result.pattern_type, "fighter_strafe");
    });
  });

  describe("Live grid — cells that die mid-pattern are excluded", () => {
    it("incapacitated cells are not targeted", () => {
      setRngForTesting(() => 0);
      // All row-4 cells are incapacitated
      const cells = makeGrid([
        { index: 20 }, { index: 21 }, { index: 22 }, { index: 23 }, { index: 24 },
        { index: 10 }, // row2 — should be targeted
      ]);
      cells[20].incapacitated = true;
      cells[21].incapacitated = true;
      cells[22].incapacitated = true;
      cells[23].incapacitated = true;
      cells[24].incapacitated = true;
      const result = resolveTacticalPattern(cells, { ...DEFAULT_CTX, aircraft_type: "tactical_bomber", recon_quality: 1.0 });
      // Must fall back to row2
      assert.ok(result.hit_cells.every(h => h.cell_index < 20), "incapacitated front row must be skipped");
      resetRng();
    });
  });
});
```

### Integration tests (server + AirBombingSystem)

```typescript
describe("12f — AirBombingSystem integration", function () {
  this.timeout(180_000);

  let colyseus: ColyseusTestServer<typeof appConfig>;
  let previousDevMode: string | undefined;

  before(async () => {
    previousDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = "true";
    setRtbDurationTicksForTesting(2);
    setRefuelDurationTicksForTesting(1);
    colyseus = await boot(appConfig);
  });

  after(async () => {
    if (previousDevMode === undefined) delete process.env.DEV_MODE;
    else process.env.DEV_MODE = previousDevMode;
    resetRng();
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinRoom() {
    process.env.DEV_MODE = "true";
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    client.send("SELECT_NATION", { nation_id: "germany" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client, room };
  }

  async function tick(room: any): Promise<void> {
    (room as any).gameTick();
    await new Promise(r => setTimeout(r, 500));
  }

  async function spawnWing(client: any, room: any, overrides: Record<string, unknown> = {}) {
    const defaults: Record<string, unknown> = {
      wing_id: "wing-1", nation_id: "germany", aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      mission: MISSION_TYPES.TACTICAL_BOMBING,
      home_airbase_province_id: "province-berlin",
      position_lng: 10.0, position_lat: 50.0, heading_deg: 0,
    };
    client.send("SPAWN_WING", { ...defaults, ...overrides });
    await room.waitForNextPatch();
  }

  it("AIR_BOMBING_RESULT broadcast fires when tactical bomber is in LOITER over an active engagement", async () => {
    const { client, room } = await joinRoom();

    // Spawn a fake land engagement at (10.0, 50.0) — Germany attacking France
    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany",
      defender_nation_id: "france",
      position_lng: 10.0,
      position_lat: 50.0,
      // defender grid: row-4 has infantry at indices 20, 21, 22
      defender_grid: [
        { cell_index: 20, unit_type: "infantry", hp: 80 },
        { cell_index: 21, unit_type: "infantry", hp: 80 },
        { cell_index: 22, unit_type: "infantry", hp: 80 },
      ],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    const bombingPromise = new Promise<any>(resolve =>
      client.onMessage("AIR_BOMBING_RESULT", resolve));

    await tick(room);

    const result = await Promise.race([
      bombingPromise,
      new Promise(r => setTimeout(() => r(null), 2000)),
    ]);
    assert.ok(result !== null, "AIR_BOMBING_RESULT must fire when tactical bomber is over active engagement");
  });

  it("tactical bomber hits the frontmost row of the engagement's defender grid", async () => {
    const { client, room } = await joinRoom();
    setRngForTesting(() => 0);

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany",
      defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [
        { cell_index: 10, unit_type: "infantry", hp: 80 },  // row 2
        { cell_index: 20, unit_type: "infantry", hp: 80 },  // row 4 (front)
        { cell_index: 22, unit_type: "infantry", hp: 80 },  // row 4 (front)
      ],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    const result = await new Promise<any>(resolve => {
      client.onMessage("AIR_BOMBING_RESULT", resolve);
      tick(room);
    });

    const hitIndices = result.runs[0].hit_cells.map((h: any) => h.cell_index);
    assert.ok(hitIndices.every((i: number) => i >= 20), "must hit row-4 cells (indices 20–24), not row-2");
    resetRng();
  });

  it("bomber wing transitions to RTB after bombing resolves", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [{ cell_index: 20, unit_type: "infantry", hp: 80 }],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    await tick(room);

    const wing = room.state.air_wings.get("tac-bomber");
    assert.ok(wing, "wing must still exist after bombing");
    assert.strictEqual(wing.lifecycle_state, WING_LIFECYCLE.RTB,
      "wing must transition to RTB immediately after bombing");
  });

  it("CAS plane hits a column, not a row", async () => {
    const { client, room } = await joinRoom();
    setRngForTesting(() => 0);

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [
        { cell_index: 2,  unit_type: "infantry", hp: 80 }, // col2
        { cell_index: 7,  unit_type: "infantry", hp: 80 }, // col2
        { cell_index: 12, unit_type: "infantry", hp: 80 }, // col2
        { cell_index: 20, unit_type: "infantry", hp: 80 }, // row4, col0 — different col
      ],
    });
    await room.waitForNextPatch();

    await spawnWing(client, room, {
      wing_id: "cas", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.CAS_PLANE,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 10.0, position_lat: 50.0,
    });

    const result = await new Promise<any>(resolve => {
      client.onMessage("AIR_BOMBING_RESULT", resolve);
      tick(room);
    });

    const hitCols = result.runs[0].hit_cells.map((h: any) => h.cell_index % 5);
    assert.ok(hitCols.every((c: number) => c === hitCols[0]), "CAS must hit a single column");
    resetRng();
  });

  it("bomber out of range of engagement does NOT bomb", async () => {
    const { client, room } = await joinRoom();

    client.send("SPAWN_LAND_ENGAGEMENT", {
      province_id: "province-paris",
      attacker_nation_id: "germany", defender_nation_id: "france",
      position_lng: 10.0, position_lat: 50.0,
      defender_grid: [{ cell_index: 20, unit_type: "infantry", hp: 80 }],
    });
    await room.waitForNextPatch();

    // Wing is 2.0° away — beyond BOMBING_RANGE_DEG (0.5°)
    await spawnWing(client, room, {
      wing_id: "tac-bomber", nation_id: "germany",
      aircraft_type: AIR_UNIT_TYPES.TACTICAL_BOMBER,
      count: 10, lifecycle_state: WING_LIFECYCLE.LOITER,
      position_lng: 12.0, position_lat: 50.0,
    });

    let bombingFired = false;
    client.onMessage("AIR_BOMBING_RESULT", () => { bombingFired = true; });

    await tick(room);
    assert.strictEqual(bombingFired, false, "wing too far from engagement must not trigger bombing");
  });
});
```

**Run tests after writing Step 3 — ALL must fail (no implementation yet):**
```bash
cd game-server && NODE_ENV=test mocha -r tsx test/12f-air-bombing-patterns.test.ts --exit --timeout 180000
```

---

## Step 4: Add `getEngagementAtPosition` to CombatSystem

Open `game-server/src/systems/combat_system.ts`. Read the file and:

1. Find the private field that stores active engagements (likely `_engagements` or `_pairs`).
   Find what information each engagement has about province position (province_id + province position,
   or division positions).

2. Add a public method:

```typescript
getEngagementAtPosition(
  lng: number, lat: number, radiusDeg: number,
  attackerNationId: string, defenderNationId: string,
): EngagementRef | undefined {
  // Implementation depends on how engagements are stored.
  // Return the engagement where:
  //   - the battle is near (lng, lat) within radiusDeg
  //   - one side is attackerNationId, other is defenderNationId
  // Return undefined if no match.
}

export interface EngagementRef {
  engagement_id: string;
  defender_cells: CellSnapshot[];  // live cell array (not a snapshot)
  applyAirStrikeDelta(deltas: CellHit[]): void;  // applies damage in-place
}
```

The `applyAirStrikeDelta` method applies `hit.hp_damage` to `cell.hp` (clamped to 0) and
`hit.supp_damage` to `cell.suppression` (clamped to 100) for each hit in the array.

**CRITICAL:** The execution agent must read `combat_system.ts` to find actual field names.
Do NOT invent field names that may not exist.

---

## Step 5: Create `AirBombingSystem`

Create `game-server/src/systems/air_bombing_system.ts`:

```typescript
import { GameRoomState } from "../rooms/schema/GameRoomState.js";
import { MISSION_TYPES, WING_LIFECYCLE } from "../rooms/schema/AirWingState.js";
import { resolvePattern } from "./air_attack_pattern_registry.js";
import { BOMBING_RANGE_DEG } from "../data/air_bombing_stats.js";
import type { AirWingLifecycleSystem } from "./air_wing_lifecycle_system.js";
import type { CombatSystem } from "./combat_system.js";

type BroadcastFn = (type: string, msg: unknown) => void;

const BOMBING_MISSIONS = new Set([
  MISSION_TYPES.TACTICAL_BOMBING,
  MISSION_TYPES.CAS,
  MISSION_TYPES.AREA,       // handled here only for range check — damage is Branch G's job
]);

function euclidDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  return Math.sqrt((lng1 - lng2) ** 2 + (lat1 - lat2) ** 2);
}

export class AirBombingSystem {
  tick(
    state: GameRoomState,
    lifecycleSystem: AirWingLifecycleSystem,
    combatSystem: CombatSystem,
    broadcast: BroadcastFn,
  ): void {
    // Only process LOITER bomber wings
    const bombers = [...state.air_wings.values()].filter(w =>
      w.lifecycle_state === WING_LIFECYCLE.LOITER &&
      BOMBING_MISSIONS.has(w.mission as any)
    );

    // Batch results by province so multiple wings on same province are grouped
    const batchByProvince = new Map<string, { province_id: string; runs: unknown[] }>();

    for (const wing of bombers) {
      // Find an active land engagement near this wing
      const engagement = combatSystem.getEngagementAtPosition(
        wing.position_lng, wing.position_lat, BOMBING_RANGE_DEG,
        wing.nation_id,   // attacker side
        undefined,        // any defender that is hostile
      );

      if (!engagement) continue;  // no active engagement in range

      // Determine recon quality from any recon wing near the province
      const recon_quality = this._computeReconQuality(wing, state);

      // Build context
      const ctx = {
        aircraft_type:    wing.aircraft_type,
        count:            wing.count,
        combat_readiness: wing.combat_readiness,
        perk_strafing:    (wing as any).perk_strafing ?? false,
        perk_precision:   (wing as any).perk_precision ?? false,
        recon_quality,
      };

      // Resolve pattern against live defender grid
      const result = resolvePattern(engagement.defender_cells, ctx);

      // Apply damage in-place to live grid
      engagement.applyAirStrikeDelta(result.hit_cells);

      // Accumulate for broadcast
      const key = engagement.engagement_id;
      if (!batchByProvince.has(key)) {
        batchByProvince.set(key, { province_id: engagement.engagement_id, runs: [] });
      }
      batchByProvince.get(key)!.runs.push({
        wing_id:       wing.wing_id,
        nation_id:     wing.nation_id,
        aircraft_type: wing.aircraft_type,
        count:         wing.count,
        hit_cells:     result.hit_cells,
        pattern_type:  result.pattern_type,
        total_hp_damage: result.total_hp_damage,
      });

      // Wing goes RTB after bombing
      lifecycleSystem.resolveEngagement(wing.wing_id, state, broadcast);
    }

    // Broadcast one AIR_BOMBING_RESULT per engagement (batched)
    for (const batch of batchByProvince.values()) {
      broadcast("AIR_BOMBING_RESULT", batch);
    }
  }

  private _computeReconQuality(wing: any, state: GameRoomState): number {
    // Check if any friendly recon wing is near this wing's position
    for (const other of state.air_wings.values()) {
      if (other.nation_id !== wing.nation_id) continue;
      if (other.mission !== MISSION_TYPES.RECON) continue;
      if (other.lifecycle_state !== WING_LIFECYCLE.TRANSIT &&
          other.lifecycle_state !== WING_LIFECYCLE.LOITER) continue;
      const dist = Math.sqrt(
        (other.position_lng - wing.position_lng) ** 2 +
        (other.position_lat - wing.position_lat) ** 2
      );
      if (dist < 1.0) return 0.8;   // nearby recon wing → high quality
    }
    return 0.0;   // no recon → pure noise targeting
  }
}
```

---

## Step 6: Wire `AirBombingSystem` into `GameRoom.ts`

### 6a. Import and declare

```typescript
import { AirBombingSystem } from "../systems/air_bombing_system.js";

// In class body:
private airBombingSystem = new AirBombingSystem();
```

### 6b. Wire into gameTick

After `AirCombatSystem.tick()` (or after the pending-transit loop if Branch E not yet merged),
BEFORE `AirDetectionSystem.tick()`:

```typescript
this.airBombingSystem.tick(
  this.state,
  this.airWingLifecycleSystem,
  this.combatSystem,
  (type, msg) => this.broadcast(type, msg),
);
```

### 6c. Add `SPAWN_LAND_ENGAGEMENT` test-only handler

Inside the `NODE_ENV === "test"` block:

```typescript
this.onMessage("SPAWN_LAND_ENGAGEMENT", (_client, msg: {
  province_id: string;
  attacker_nation_id: string;
  defender_nation_id: string;
  position_lng: number;
  position_lat: number;
  defender_grid: Array<{ cell_index: number; unit_type: string; hp: number }>;
}) => {
  // Read combat_system.ts to find the method to inject a synthetic engagement.
  // If no such method exists, add one: combatSystem.injectTestEngagement(params).
  this.combatSystem.injectTestEngagement({
    province_id:        msg.province_id,
    attacker_nation_id: msg.attacker_nation_id,
    defender_nation_id: msg.defender_nation_id,
    position_lng:       msg.position_lng,
    position_lat:       msg.position_lat,
    defender_grid:      msg.defender_grid,
  });
});
```

The execution agent MUST look at `combat_system.ts` to implement `injectTestEngagement` safely —
do NOT overwrite any existing engagement state. Create a synthetic entry in the same map structure
that real engagements use, with the minimal fields needed for `getEngagementAtPosition` to find it.

---

## Step 7: Update `package.json`

Append to the `test` script:
```
&& NODE_ENV=test mocha -r tsx test/12f-air-bombing-patterns.test.ts --exit --timeout 180000
```

**Run full test suite:**
```bash
cd game-server && npm test
```

Suites 12a through 12f must all pass.

---

## Step 8: Client — `BombingRunIndicator` (map marker)

Create `client/src/systems/air/bombing_run_indicator.gd`.

**Copy from `engagement_banner.gd` verbatim, then change:**
1. `position = _map_loader.project_lng_lat(lng, lat) + Vector2(0, -32)` (province position, not midpoint between two units)
2. `_draw()` draws a fire circle (see ASCII UI section above) instead of crossed swords
3. `_input()` opens BombingDetailPanel instead of TacticalCombatPanel
4. Add `_timer: float` and `_runs: Array[Dictionary]` fields
5. Add `add_run(data: Dictionary)` method that appends to `_runs` and calls `queue_redraw()`
6. Auto-dismiss: in `_process(delta)`, increment `_timer`; when `_timer >= AUTO_DISMISS_SEC`, call `queue_free()`

```gdscript
extends Node2D

const FIRE_ICON: Texture2D = preload("res://assets/icons/fire-solid-full.svg")
const AUTO_DISMISS_SEC := 5.0
const CIRCLE_RADIUS    := 18.0

var _runs: Array[Dictionary] = []
var _province_id: String = ""
var _timer: float = 0.0

func setup(map_loader: Node, province_id: String, lng: float, lat: float) -> void:
    _province_id = province_id
    position = map_loader.project_lng_lat(lng, lat) + Vector2(0.0, -32.0)
    queue_redraw()

func add_run(run_data: Dictionary) -> void:
    _runs.append(run_data)
    queue_redraw()

func _process(delta: float) -> void:
    _timer += delta
    if _timer >= AUTO_DISMISS_SEC:
        queue_free()
        return
    queue_redraw()  # update timer arc

func _draw() -> void:
    # Red background circle
    draw_circle(Vector2.ZERO, CIRCLE_RADIUS, Color(0.8, 0.1, 0.1, 0.75))
    # Fire icon
    draw_texture_rect(FIRE_ICON, Rect2(Vector2(-10.0, -13.0), Vector2(20.0, 20.0)), false)
    # Run count badge (only if batched)
    if _runs.size() > 1:
        draw_circle(Vector2(12.0, -12.0), 9.0, Color(0.9, 0.9, 0.0, 0.9))
        # NOTE: draw_string requires a font — use a child Label instead
    # Timer arc (white, drains clockwise)
    var progress := 1.0 - (_timer / AUTO_DISMISS_SEC)
    if progress > 0.0:
        draw_arc(Vector2.ZERO, 24.0, -PI * 0.5,
                 -PI * 0.5 + TAU * progress, 32, Color(1, 1, 1, 0.6 * progress), 2.0)

func _input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.pressed:
        if event.button_index == MOUSE_BUTTON_LEFT:
            var local := to_local(event.global_position)
            if local.length() <= CIRCLE_RADIUS + 6.0:
                EventBus.bombing_detail_open_requested.emit({ "runs": _runs, "province_id": _province_id })
                queue_free()   # dismiss on click
                accept_event()
```

**Do NOT use `draw_string()` for the run count** — it requires a FontFile argument not easily
preloaded here. Instead, add a small Label child node in `_ready()` and set its text to
`str(_runs.size())` when `_runs.size() > 1`.

---

## Step 9: Client — `BombingDetailPanel`

Create `client/src/ui/hud/bombing_detail_panel.gd` and `bombing_detail_panel.tscn`.

### Scene structure (build in Godot editor OR in _ready() via code)

```
BombingDetailPanel (PanelContainer)
└─ InnerMargin (MarginContainer)
   └─ VBoxContent (VBoxContainer)
      ├─ HeaderRow (HBoxContainer)
      │  ├─ TitleIcon (TextureRect)        ← fire-solid-full.svg, 20×20
      │  ├─ TitleLabel (Label)             ← "BOMBING RUN × N" or mission type
      │  └─ CloseButton (Button)           ← "✕"
      ├─ SubtitleLabel (Label)             ← province name
      ├─ RunsContainer (VBoxContainer)     ← one RunSection per run
      │  └─ [RunSection × N] (VBoxContainer)
      │     ├─ RunHeader (Label)           ← "12 × Tactical Bomber  (Germany)"
      │     ├─ GridArea (CenterContainer)
      │     │  └─ Grid (GridContainer, 5 cols, 25 cells)
      │     └─ CasualtyLabel (Label)       ← "Front row struck · 18 casualties"
      ├─ TotalLabel (Label)                ← "Total · N casualties" (hidden if 1 run)
      └─ DismissBar (TextureProgressBar or custom drawn)
```

### Grid construction — copy from TacticalCombatPanel

```gdscript
# COPY THIS BLOCK FROM tactical_combat_panel.gd's _build_grid():
const GLYPH_SCENE = preload("res://src/ui/components/unit_glyph_cell/unit_glyph_cell.tscn")

func _build_run_grid(container: GridContainer) -> Array:
    var cells := []
    for i in range(25):
        var cell = GLYPH_SCENE.instantiate()
        container.add_child(cell)
        cells.append(cell)
    return cells
```

### Populating a run's grid

For each run, only the `hit_cells` are known (not the full grid state). Show hit cells as
red, everything else empty:

```gdscript
func _populate_run_grid(cells: Array, hit_cells: Array) -> void:
    # First clear all cells to empty
    for cell in cells:
        cell.unit_type = ""
        cell.modulate = Color(1, 1, 1, 1)  # reset
    # Mark hit cells in red
    var hit_set := {}
    for h in hit_cells:
        hit_set[h.cell_index] = h.hp_damage
    for i in range(cells.size()):
        if hit_set.has(i):
            cells[i].unit_type = "infantry"    # show a glyph so cell isn't invisible
            cells[i].modulate = Color(1.0, 0.2, 0.2, 0.9)  # red tint for hit
```

### Auto-dismiss timer bar

Use a `TextureProgressBar` node or draw a progress rect manually in `_draw()`:

```gdscript
var _dismiss_timer: float = 0.0
const DISMISS_SEC := 8.0  # detail panel lingers longer than the map marker

func _process(delta: float) -> void:
    _dismiss_timer += delta
    _progress_bar.value = 1.0 - (_dismiss_timer / DISMISS_SEC)
    if _dismiss_timer >= DISMISS_SEC:
        _close()

func _close() -> void:
    EventBus.bombing_detail_closed.emit()
    hud_manager.hide_panel("bombing_detail")
```

### Opening the panel

Connect to `EventBus.bombing_detail_open_requested` in `game_hud.gd`:

```gdscript
EventBus.bombing_detail_open_requested.connect(func(data: Dictionary) -> void:
    _bombing_detail_panel.populate(data)
    hud_manager.show_panel("bombing_detail")
)
```

The `populate(data)` method receives the full `{ runs: [...], province_id: "..." }` dict from
the BombingRunIndicator click event and rebuilds the panel content.

---

## Step 10: Wire Client Events

### `event_bus.gd` — add signals

After existing air signals:
```gdscript
signal air_bombing_result(data: Dictionary)
signal bombing_detail_open_requested(data: Dictionary)
signal bombing_detail_closed()
```

### `session_manager.gd` — add handler

In the room message match block:
```gdscript
"AIR_BOMBING_RESULT":
    EventBus.air_bombing_result.emit(data)
```

### `air_wing_system.gd` — manage BombingRunIndicator nodes

Add:
```gdscript
var _bombing_indicators: Dictionary = {}  # province_id → BombingRunIndicator

# In setup():
EventBus.air_bombing_result.connect(_on_air_bombing_result)

func _on_air_bombing_result(data: Dictionary) -> void:
    var province_id: String = data.get("province_id", "")
    if province_id.is_empty():
        return
    # Get or create indicator for this province
    if not _bombing_indicators.has(province_id) or \
       not is_instance_valid(_bombing_indicators[province_id]):
        var indicator = BombingRunIndicatorScene.instantiate()
        _air_wing_layer.add_child(indicator)
        # Find province position from GameState
        var province = GameState.get_province(province_id)
        if province == null:
            indicator.queue_free()
            return
        indicator.setup(_map_loader, province_id, province.position_lng, province.position_lat)
        _bombing_indicators[province_id] = indicator
    # Add all runs to the indicator
    for run in data.get("runs", []):
        _bombing_indicators[province_id].add_run(run)

# In cleanup():
for indicator in _bombing_indicators.values():
    if is_instance_valid(indicator):
        indicator.queue_free()
_bombing_indicators.clear()
```

Preload the indicator scene:
```gdscript
const BombingRunIndicatorScene = preload("res://src/systems/air/bombing_run_indicator.tscn")
```

**You must also create `bombing_run_indicator.tscn`** — a minimal scene with just the Node2D
root (the script handles all drawing). Create it in Godot editor or via `PackedScene` code.

---

## Step 11: Visual Verification Checklist

**Server tests:**
```bash
cd game-server && npm test
```
All suites 12a–12f must pass.

**Client visual checks:**
1. Send a tactical bomber wing on TACTICAL_BOMBING mission to a province with an active
   land engagement → a fire icon appears on the map at the province position
2. Fire icon pulses briefly, timer arc drains over 5 seconds
3. Click fire icon → BombingDetailPanel opens, shows correct grid with red hit cells in
   the frontmost row
4. Panel auto-dismisses after 8 seconds if not closed manually
5. Send two bomber wings (one tactical, one CAS) to same province in same tick → single
   fire icon appears with "× 2" badge → clicking shows both runs stacked in detail panel
6. Dive bomber → only ONE cell shows red in the detail panel
7. CAS plane → a vertical column of red cells
8. Fighter without `perk_strafing` → NO fire icon, no bombing
9. Fighter with `perk_strafing` = true → fire icon appears, column hit
10. Bomber wing transitions to RTB after bombing (icon starts moving back to home airbase)

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| `cell_index = row + col` or some other formula | `cell_index = row * 5 + col` (row 0 = rear, row 4 = front) |
| "Frontmost" means lowest row index | **Frontmost = highest row index** (row 4 = front) |
| CombatSystem already has `getEngagementAtPosition()` | **It does NOT** — add in Step 4 |
| `SPAWN_LAND_ENGAGEMENT` test handler already exists | **Does NOT exist** — add in Step 6c |
| BombingDetailPanel should read live GridCellState from GameState | **No** — the payload includes hit_cells directly; only hit cells are displayed; the panel does NOT need to query GameState for the full grid |
| The fire icon can be rendered via `draw_string()` for the count badge | **`draw_string()` requires a FontFile** — use a child Label node for text |
| `_rng` / randomness should be seeded at module level unconditionally | Use `setRngForTesting()` / `resetRng()` pattern; production uses `Math.random` by default |
| `AIR_BOMBING_RESULT` should be broadcast to all clients | **Broadcast to attacker and defender nations only** — use the per-client loop from `GameRoom.ts` filtering to those two nation_ids (same pattern as `RADAR_UPDATED`) |
| BombingRunIndicator should extend Control (UI node) | **Extends Node2D** — it draws on the map layer, not the UI layer, same as EngagementBanner |
| `bombing_run_indicator.tscn` can be omitted if the gd file is standalone | A `.tscn` scene file is required so `preload()` in `air_wing_system.gd` works |
| Fighter with strafing perk hits a ROW | **Fighter strafing is a COLUMN** — deliberately different from tactical bomber's row |
| Strategic bomber (AREA/INDUSTRY/OIL missions) is handled in Branch F | **Those missions are Branch G's responsibility** — Branch F only handles TACTICAL_BOMBING and CAS_PLANE missions hitting the tactical grid |
| Bombing applies every tick while wing is in LOITER | **One bomb per sortie** — after bombing, AirBombingSystem immediately calls `lifecycleSystem.resolveEngagement()` to RTB the wing |
| `perk_strafing` and `perk_precision` field names are guaranteed | **Verify the actual field names in `AirWingState.ts`** before using them |
| `GameState.get_province(province_id)` exists and has position fields | **Verify this method exists** in the client's `game_state.gd` before calling it; if it doesn't, find the correct GameState API for province positions |

---

## Additional Features (reviewed and agreed post-Branch E)

### DogfightIndicator — map marker for air-to-air combat

When `AIR_COMBAT_STARTED` fires, show a timed map marker at the midpoint between the two wings,
similar to `BombingRunIndicator`. Stack nearby engagements (within 0.5° grid cell) into a single
marker with a count badge.

**Server side** — no changes needed. `AIR_COMBAT_STARTED` already broadcasts:
```typescript
{ wing_a_id: string, wing_b_id: string, is_surprise: boolean }
```

The client already has wing positions in `GameState.air_wings`.

**Client — new file:** `client/src/systems/air/dogfight_indicator.gd`

```gdscript
extends Node2D
## Timed map marker that appears at the midpoint of an air-to-air engagement.

const AUTO_DISMISS_SEC := 5.0
const CROSSHAIRS_ICON: Texture2D = preload("res://assets/icons/crosshairs-solid.svg")

var _runs: Array[Dictionary] = []   # each { wing_a_id, wing_b_id, is_surprise }
var _timer := AUTO_DISMISS_SEC

func add_engagement(data: Dictionary) -> void:
    _runs.append(data)
    _badge_label.text = str(_runs.size())
    _badge_label.visible = _runs.size() > 1
    queue_redraw()

func _process(delta: float) -> void:
    _timer -= delta
    if _timer <= 0.0:
        queue_free()
    queue_redraw()

func _draw() -> void:
    draw_circle(Vector2.ZERO, 16.0, Color(1.0, 0.4, 0.0, 0.75))
    draw_texture_rect(CROSSHAIRS_ICON, Rect2(Vector2(-10, -10), Vector2(20, 20)), false)
    var progress := maxf(0.0, _timer / AUTO_DISMISS_SEC)
    draw_arc(Vector2.ZERO, 20.0, -PI * 0.5, -PI * 0.5 + TAU * progress,
             32, Color(1, 1, 1, 0.6 * progress), 2.0)
```

**Spatial bucketing** — use a 0.5° grid cell key to group nearby engagements:
```gdscript
func _bucket_key(lng: float, lat: float) -> String:
    return "%d_%d" % [int(lng / 0.5), int(lat / 0.5)]
```

**Client — `air_wing_system.gd` additions:**

```gdscript
var _dogfight_indicators: Dictionary = {}   # bucket_key → DogfightIndicator

func _on_air_combat_started(data: Dictionary) -> void:
    var a_id: String = data.get("wing_a_id", "")
    var b_id: String = data.get("wing_b_id", "")
    var a := GameState.get_air_wing(a_id)
    var b := GameState.get_air_wing(b_id)
    if a.is_empty() or b.is_empty():
        return
    var mid_lng := (float(a.get("position_lng", 0)) + float(b.get("position_lng", 0))) / 2.0
    var mid_lat := (float(a.get("position_lat", 0)) + float(b.get("position_lat", 0))) / 2.0
    var key := _bucket_key(mid_lng, mid_lat)
    if not _dogfight_indicators.has(key) or not is_instance_valid(_dogfight_indicators[key]):
        var indicator = DogfightIndicatorScene.instantiate()
        add_child(indicator)
        indicator.position = _map_loader.project_lng_lat(mid_lng, mid_lat)
        indicator.tree_exited.connect(func(): _dogfight_indicators.erase(key))
        _dogfight_indicators[key] = indicator
    _dogfight_indicators[key].add_engagement(data)
```

Connect `EventBus.air_combat_started` to `_on_air_combat_started` in `setup()`. The
`AIR_COMBAT_STARTED` / `AIR_COMBAT_ENDED` signals on EventBus are added in Branch E (step 10a).

**Files to add/modify for DogfightIndicator:**

| File | Change |
|---|---|
| `client/src/systems/air/dogfight_indicator.gd` | New file (above) |
| `client/src/systems/air/dogfight_indicator.tscn` | Minimal Node2D scene (required for preload) |
| `client/src/systems/air/air_wing_system.gd` | Connect `air_combat_started`; manage `_dogfight_indicators` dict; add `_on_air_combat_started` |

---

### Bombing readiness spike

After each bombing run, the attacker wing takes an immediate readiness hit (separate from the
per-tick decay already in the lifecycle system). This reflects crew fatigue and aircraft stress
from a combat sortie.

**In `AirBombingSystem.tick()`**, after applying grid damage and before calling
`lifecycleSystem.resolveEngagement()`:

```typescript
const READINESS_BOMBING_SPIKE = 0.05;
const READINESS_FLOOR = 0.15;
wing.combat_readiness = Math.max(READINESS_FLOOR,
  wing.combat_readiness - READINESS_BOMBING_SPIKE);
```

Add a test:
```typescript
it("bombing run reduces attacker readiness by 0.05", async () => {
  // Setup wing on TACTICAL_BOMBING mission over active engagement
  const beforeReadiness = wing.combat_readiness;
  await tickRoom(room);
  assert.ok(wing.combat_readiness < beforeReadiness - 0.04,
    `Expected readiness spike, got ${wing.combat_readiness}`);
});
```

`READINESS_BOMBING_SPIKE` should be exported as a named constant and settable via
`setReadinessBombingSpikeForTesting(n: number)` for tests that need predictable values.
