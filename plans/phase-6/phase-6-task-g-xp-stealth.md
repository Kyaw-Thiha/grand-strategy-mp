# Plan G — `feat/tactical-xp-stealth`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the XP accumulation system and stealth system for tactical combat. XP accumulates per round, has 4 tiers with stat bonuses, and applies HP-based retention at engagement end. Stealth hides units per terrain (perk-driven), re-checked every round; stealthed cells cannot be targeted.

**Architecture:** Pure TypeScript helpers added to `attack_patterns.ts` (fully testable); perk system extended with `xp_gain_mult`, `terrain_stealth_bonus`, `xp_config`; schema gets `xp_pending` and `xp_points` fields; `combat_system.ts` wires stealth resolution at round start and XP accumulation/finalization at engagement end. TDD: write all tests first (RED), implement until GREEN.

**Tech Stack:** TypeScript + Colyseus/schema, Mocha + tsx, GDScript 4

## Global Constraints

- `moduleResolution: "NodeNext"` — ALL relative TypeScript imports must end in `.js`
- `GridCellState` is a Colyseus schema object — never spread `{...c}`; copy fields explicitly
- TDD: test file created first, all tests RED, then implement until GREEN
- Prior tests (`6d`, `6e`, `6f`, `6c`, `6a`) must still pass after Branch G

---

## Pre-task 0: Update plan and doc files

- [ ] **Step 0a: Save this plan** to `plans/phase-6-task-g-xp-stealth.md` (copy this file verbatim)

- [ ] **Step 0b: Update `plans/phase-6-tactical-combat.md`**

  In Branch G section, replace the entire block:
  ```markdown
  ## Branch G — `feat/tactical-xp-stealth`
  **Starts after D + E + F all merge.**

  - Unit experience system: accumulates per round survived; 4 tiers (Green/Seasoned/Veteran/Elite);
    60% XP credit when unit HP ≤ 50% at engagement end; 40% credit when incapacitated and division
    won; 0% if division destroyed; perk-extensible thresholds and retention rates; post-Elite XP
    gives diminishing-returns bonus
  - Stealth system: stealthed units deal damage normally, cannot be targeted, excluded from
    division suppression threshold; stealth level vs anti-stealth level checked per round;
    terrain stealth bonuses via perk research; survive division destruction into reserve

  **Tests (server):** XP accumulation per round, tier promotion at correct thresholds, retention
  rates applied correctly at engagement end, stealth excludes cells from targeting and threshold,
  reveal rule (anti_stealth >= stealth) applied per round.

  ---

  ## Branch G-Builder — `feat/tactical-division-builder`
  **Can start after A merges. Independent of B–G and H–J.**

  - DivisionBuilder MVP (Godot): template builder UI in main menu; 5×5 grid with row role labels
    (Vanguard/Assault/Support/Reserve/Rear); movement profile summary computed and displayed;
    formation bonus glow on cells when placing adjacent synergy units; derived division type +
    engagement radius shown live

  **Tests (Godot):** DivisionBuilder places units and computes movement profile; formation bonus
  glow activates on valid adjacency.
  ```

  Update merge diagram (append G-Builder as independent parallel branch):
  ```
  A
  └── B
      └── C
          ├── D ──┐
          ├── E ──┼── G ─── H ──┐
          └── F ──┘     └── I ──┴── J ──┐
                                         │
  K (after A, independent)               │
  G-Builder (after A, independent)       │
  L (any time, independent)              │
                          M ◄────────────┘
  ```

- [ ] **Step 0c: Update `docs/TACTICAL_COMBAT.md`**

  In the **Unit Experience System** section (around line 483), after the tier table and before "Experience accumulation sources", insert:

  ```markdown
  ### XP retention rules at engagement end

  At the end of each engagement, accumulated XP (stored as `xp_pending` per cell during the
  engagement) is committed with a retention multiplier based on the unit's state:

  | Condition | XP retained |
  |---|---|
  | Unit HP > 50% at engagement end | 100% of engagement XP |
  | Unit HP ≤ 50%, not incapacitated | 60% |
  | Unit incapacitated, **division won** | 40% |
  | Unit incapacitated, division lost/retreated | 0% |
  | **Division destroyed** (encirclement, HP=0) | 0% for all units |

  Perks can modify per unit type: lower the full-XP threshold, raise incapacitated retention,
  or raise destroyed retention. See `xp_config` in `PerkDefinition`.

  ### Post-Elite XP

  After reaching Elite (1000+ XP points), additional XP still provides stat benefits with
  diminishing returns:
  ```
  post_elite_bonus = POST_ELITE_SCALE × log1p((xp − 1000) / POST_ELITE_DECAY)
  ```
  Applied additively to Elite-tier multipliers. Values `POST_ELITE_SCALE=0.05`,
  `POST_ELITE_DECAY=500` — set by playtesting.

  ### XP UI display
  XP tier badges and pending XP bar per cell displayed in the tactical grid panel (Branch K)
  and the DivisionBuilder UI (Branch G-Builder). The `xp_pending` field syncs live so the
  panel can show XP earned so far in the current engagement.
  ```

  In the **Stealth System** section (around line 709), replace the entire section with:

  ```markdown
  ## Stealth System

  Certain units have a **stealth level** (integer ≥ 0). Anti-stealth is also an integer ≥ 0
  per unit type. Stealth is evaluated **every round**, not just at engagement start.

  **Reveal rule:** A unit is stealthed unless any active enemy unit has
  `anti_stealth ≥ effective_stealth_level`. Re-checked at the start of each round.

  **While stealthed:**
  - The unit deals damage normally
  - The unit cannot be targeted (takes zero incoming damage)
  - The unit's HP and suppression values are **excluded** from the division's retreat/destroy
    threshold calculation
  - If the division is destroyed while units remain stealthed, those units are placed into
    reserve and **retain their experience tier and XP**

  **Base stealth levels (in `UNIT_COMBAT_STATS`):**

  | Unit type | stealth_level | anti_stealth |
  |---|---|---|
  | sniper | 2 | 0 |
  | force_recon_sniper | 2 | 2 |
  | commando | 2 | 0 |
  | recon_infantry | 0 | 1 |
  | armoured_car | 0 | 2 |
  | all others | 0 | 0 |

  **Terrain stealth bonuses (perk-driven, extensible via research):**
  Researched perks add terrain-specific stealth bonuses per unit type via `terrain_stealth_bonus`
  in `PerkDefinition`. For example, a sniper with `sniper_forest_stealth` research gains
  +1 stealth in light_forest and +2 in dense_forest.

  `effective_stealth = base_stealth_level + terrain_bonus_from_perks(unit_type, cover)`

  A sniper (base=2) in dense_forest with `sniper_forest_stealth` research has effective
  stealth=4. Only a unit with anti_stealth ≥ 4 can reveal it.

  **Anti-stealth units:** recon_infantry (anti=1), armoured_car (anti=2),
  force_recon_sniper (anti=2). Stacking multiple anti-stealth units does NOT raise the
  effective anti — only the highest anti_stealth value on the field counts.
  ```

---

## Design Reference

### Grid indexing
```
cell_index = row * 5 + col
row 0 = R1 (rear)    row 4 = R5 (vanguard/front)
R5 cells: 20–24   R4 cells: 15–19   R3 cells: 10–14
R2 cells:  5–9    R1 cells:  0–4
```

### XP tier thresholds and stat bonuses
```
Green:    xp_points <  100  → hp_mult=1.00, supp_resist=1.00, recon=1.00
Seasoned: xp_points <  400  → hp_mult=1.10, supp_resist=1.05, recon=1.10
Veteran:  xp_points < 1000  → hp_mult=1.20, supp_resist=1.15, recon=1.25
Elite:    xp_points ≥ 1000  → hp_mult=1.35, supp_resist=1.25, recon=1.40
Post-Elite bonus: bonus_add = 0.05 × log1p((xp − 1000) / 500)  added to Elite hp_mult
```

HP mult is **DAMAGE REDUCTION**: divide `perTargetHp` by `xp_hp_mult` before applying.
Supp resist: divide `perTargetSupp` by `xp_supp_resist_mult`.

### XP flow
- `GridCellState.xp_pending` — XP earned this engagement (reset at engagement start + end)
- `GridCellState.xp_points` — career total XP (persists across engagements)
- Per round: non-incapacitated cells gain `XP_PER_ROUND × xp_gain_mult` → `xp_pending`
- At engagement end: `xp_points += floor(xp_pending × retention_mult)`; `xp_pending = 0`
- `xp_tier` updated from `getXpTier(xp_points)` only after finalization

### Stealth flow per round (runs BEFORE damage)
For each side (divA then divB):
1. `stealthBonuses = resolveTerrainStealthBonuses(battle_cover, perkIds)`
2. `effStealths[i] = UNIT_COMBAT_STATS[cells[i].unit_type].stealth_level + stealthBonuses[cells[i].unit_type]`
3. `maxAnti = max(UNIT_COMBAT_STATS[enemy.unit_type].anti_stealth for non-incap enemy cells)`
4. `_resolveStealthForRound(cells, maxAnti, effStealths)` mutates `cells[i].stealthed`

### Where engagement ends (combat_system.ts)
- `_initiateRetreat(div, enemies, ...)` — `div` is the loser
- `_checkDisengagement` — natural separation (draw)
- Division HP → 0 (encircled, can't retreat) — destruction path

---

## Files to Create

### Task 1: Test file `game-server/test/6g-xp-stealth.test.ts`

- [ ] **Step 1: Create test file (all tests RED)**

```typescript
import assert from "assert";
import { describe, it } from "mocha";
import {
  getXpTier,
  getXpHpMult,
  getXpSuppResistMult,
  getXpReconMult,
  _computeXpRetention,
  _resolveStealthForRound,
} from "../src/systems/attack_patterns.js";
import { GridCellState } from "../src/rooms/schema/GameRoomState.js";

function makeCell(overrides: Partial<{
  unit_type: string; hp: number; xp_points: number; xp_pending: number;
  xp_tier: string; incapacitated: boolean; stealthed: boolean;
}> = {}): GridCellState {
  const c = new GridCellState();
  c.unit_type     = overrides.unit_type     ?? "";
  c.hp            = overrides.hp            ?? 100;
  c.xp_points     = overrides.xp_points     ?? 0;
  c.xp_pending    = overrides.xp_pending    ?? 0;
  c.xp_tier       = overrides.xp_tier       ?? "green";
  c.incapacitated = overrides.incapacitated ?? false;
  c.stealthed     = overrides.stealthed     ?? false;
  return c;
}

// ── getXpTier ─────────────────────────────────────────────────────────────

describe("6g — XP tier", function () {
  it("0 pts → green",    () => assert.strictEqual(getXpTier(0),    "green"));
  it("99 pts → green",   () => assert.strictEqual(getXpTier(99),   "green"));
  it("100 pts → seasoned",() => assert.strictEqual(getXpTier(100), "seasoned"));
  it("399 pts → seasoned",() => assert.strictEqual(getXpTier(399), "seasoned"));
  it("400 pts → veteran", () => assert.strictEqual(getXpTier(400), "veteran"));
  it("999 pts → veteran", () => assert.strictEqual(getXpTier(999), "veteran"));
  it("1000 pts → elite",  () => assert.strictEqual(getXpTier(1000),"elite"));
  it("9999 pts → elite",  () => assert.strictEqual(getXpTier(9999),"elite"));
});

// ── XP stat multipliers ───────────────────────────────────────────────────

describe("6g — XP stat multipliers", function () {
  it("getXpHpMult: green → 1.0",    () => assert.strictEqual(getXpHpMult(0),    1.0));
  it("getXpHpMult: seasoned → 1.10",() => assert.strictEqual(getXpHpMult(100),  1.10));
  it("getXpHpMult: veteran → 1.20", () => assert.strictEqual(getXpHpMult(400),  1.20));
  it("getXpHpMult: elite → 1.35",   () => assert.strictEqual(getXpHpMult(1000), 1.35));
  it("getXpHpMult: post-elite > 1.35 and < 1.45", () => {
    assert.ok(getXpHpMult(2000) > 1.35);
    assert.ok(getXpHpMult(2000) < 1.45);
  });

  it("getXpSuppResistMult: green → 1.0",    () => assert.strictEqual(getXpSuppResistMult(0),   1.0));
  it("getXpSuppResistMult: seasoned → 1.05",() => assert.strictEqual(getXpSuppResistMult(100), 1.05));
  it("getXpSuppResistMult: veteran → 1.15", () => assert.strictEqual(getXpSuppResistMult(400), 1.15));
  it("getXpSuppResistMult: elite → 1.25",   () => assert.strictEqual(getXpSuppResistMult(1000),1.25));

  it("getXpReconMult: green → 1.0",    () => assert.strictEqual(getXpReconMult(0),   1.0));
  it("getXpReconMult: seasoned → 1.10",() => assert.strictEqual(getXpReconMult(100), 1.10));
  it("getXpReconMult: veteran → 1.25", () => assert.strictEqual(getXpReconMult(400), 1.25));
  it("getXpReconMult: elite → 1.40",   () => assert.strictEqual(getXpReconMult(1000),1.40));
});

// ── _computeXpRetention ───────────────────────────────────────────────────
// _computeXpRetention(hp_ratio, is_incap, div_won, incap_ret, damaged_ret) → mult

describe("6g — XP retention", function () {
  it("HP > 0.5, healthy → 1.0",
    () => assert.strictEqual(_computeXpRetention(0.8,  false, true,  0.4, 0.6), 1.0));
  it("HP = 0.51 → 1.0",
    () => assert.strictEqual(_computeXpRetention(0.51, false, true,  0.4, 0.6), 1.0));
  it("HP = 0.5 (damaged) → 0.6",
    () => assert.strictEqual(_computeXpRetention(0.5,  false, true,  0.4, 0.6), 0.6));
  it("HP = 0.3 (damaged) → 0.6",
    () => assert.strictEqual(_computeXpRetention(0.3,  false, true,  0.4, 0.6), 0.6));
  it("incapacitated + division won → 0.4",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  true,  0.4, 0.6), 0.4));
  it("incapacitated + division lost → 0.0",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  false, 0.4, 0.6), 0.0));
  it("perk raises incap_ret to 0.55",
    () => assert.strictEqual(_computeXpRetention(0.15, true,  true,  0.55, 0.6), 0.55));
  it("perk raises damaged_ret to 0.75",
    () => assert.strictEqual(_computeXpRetention(0.3,  false, true,  0.4, 0.75), 0.75));
});

// ── _resolveStealthForRound ───────────────────────────────────────────────
// _resolveStealthForRound(cells, max_enemy_anti, effective_stealths) — mutates stealthed

describe("6g — stealth resolution", function () {
  it("stealth=0 → not stealthed (even with max_enemy_anti=0)", () => {
    const cells = [makeCell({ unit_type: "infantry" })];
    _resolveStealthForRound(cells, 0, [0]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("stealth=2, max_anti=0 → stealthed", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, true);
  });

  it("stealth=2, max_anti=1 → stealthed (anti < stealth)", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 1, [2]);
    assert.strictEqual(cells[0].stealthed, true);
  });

  it("stealth=2, max_anti=2 → REVEALED (anti >= stealth)", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 2, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("stealth=2, max_anti=3 → REVEALED", () => {
    const cells = [makeCell({ unit_type: "sniper" })];
    _resolveStealthForRound(cells, 3, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("incapacitated cell → never stealthed", () => {
    const cells = [makeCell({ unit_type: "sniper", incapacitated: true })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("empty cell → never stealthed", () => {
    const cells = [makeCell({ unit_type: "" })];
    _resolveStealthForRound(cells, 0, [2]);
    assert.strictEqual(cells[0].stealthed, false);
  });

  it("25-cell grid — only sniper at index 22 stealthed, infantry not", () => {
    const cells = Array.from({ length: 25 }, (_, i) => {
      if (i === 22) return makeCell({ unit_type: "sniper" });
      if (i === 20) return makeCell({ unit_type: "infantry" });
      return makeCell();
    });
    const stealths = cells.map((_, i) => (i === 22 ? 2 : 0));
    _resolveStealthForRound(cells, 0, stealths);
    assert.strictEqual(cells[22].stealthed, true);
    assert.strictEqual(cells[20].stealthed, false);
  });
});
```

- [ ] **Step 2: Run to verify RED**
```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6g-xp-stealth.test.ts --exit --timeout 15000
```
Expected: all fail (`getXpTier is not a function`, etc.)

---

## Files to Modify

### Task 2: `game-server/src/rooms/schema/GameRoomState.ts`

- [ ] **Step 3: Add `xp_points` and `xp_pending` to GridCellState**

Find:
```typescript
  @type("string")  xp_tier: string        = "green";
```
Replace with:
```typescript
  @type("string")  xp_tier: string        = "green";
  @type("number")  xp_points: number      = 0;
  @type("number")  xp_pending: number     = 0;
```

---

### Task 3a: `game-server/src/types/tactical_types.ts` — add missing unit types to enum

`force_recon_sniper`, `howitzer`, and `self_propelled_gun` are used as string literals
throughout the codebase (attack_patterns.ts, perks.ts, combat_constants.ts, GDScript) but
are absent from the UnitType const object. Add them now so UNIT_COMBAT_STATS can use the
enum keys consistently.

- [ ] **Step 4a: Add three entries to the UnitType const object**

Find the closing line of the UnitType object:
```typescript
  EMPTY:           "",
} as const;
```
Replace with:
```typescript
  EMPTY:              "",
  FORCE_RECON_SNIPER: "force_recon_sniper",
  HOWITZER:           "howitzer",
  SELF_PROPELLED_GUN: "self_propelled_gun",
} as const;
```

---

### Task 3b: `game-server/src/data/unit_combat_stats.ts`

- [ ] **Step 4: Add `stealth_level` and `anti_stealth` to interface and all entries**

Replace interface:
```typescript
export interface UnitCombatStats {
  pen:           number;
  armour:        number;
  hp_floor_pct:  number;
  stealth_level: number;   // 0 = no stealth; combined with terrain perk bonus at runtime
  anti_stealth:  number;   // reveals enemy with effective_stealth <= this value
}
```

Replace entire `UNIT_COMBAT_STATS` object. Use `[UnitType.XXX]` computed-key syntax
throughout — do NOT switch to bare string keys. The **exact** existing `pen`/`armour`/
`hp_floor_pct` values are listed below; preserve them exactly and only ADD the two new
fields per entry. Also add the three new entries at the bottom.

```typescript
export const UNIT_COMBAT_STATS: Record<string, UnitCombatStats> = {
  [UnitType.INFANTRY]:           { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ASSAULT_INF]:        { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.RECON_INF]:          { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 1 },
  [UnitType.MG]:                 { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.CAVALRY]:            { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_INFANTRY]:        { pen: 40, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.SNIPER]:             { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0 },
  [UnitType.COMMANDO]:           { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 0 },
  [UnitType.FLAMETHROWER]:       { pen: 10, armour:  0, hp_floor_pct: 20, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ARMOURED_CAR]:       { pen: 25, armour: 15, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 2 },
  [UnitType.LIGHT_TANK]:         { pen: 45, armour: 30, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.MEDIUM_TANK]:        { pen: 65, armour: 50, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.HEAVY_TANK]:         { pen: 85, armour: 75, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_GUN_SP]:          { pen: 75, armour: 25, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AT_GUN]:             { pen: 70, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.AA_GUN]:             { pen: 20, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.ARTILLERY]:          { pen: 50, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  // New entries (unit types used in attack_patterns.ts/perks.ts but previously missing from enum)
  [UnitType.FORCE_RECON_SNIPER]: { pen: 15, armour:  0, hp_floor_pct: 20, stealth_level: 2, anti_stealth: 2 },
  [UnitType.HOWITZER]:           { pen: 55, armour:  0, hp_floor_pct:  0, stealth_level: 0, anti_stealth: 0 },
  [UnitType.SELF_PROPELLED_GUN]: { pen: 50, armour: 10, hp_floor_pct: 30, stealth_level: 0, anti_stealth: 0 },
};
```

---

### Task 4: `game-server/src/data/combat_constants.ts`

- [ ] **Step 5: Append XP constants (do NOT touch existing lines)**

```typescript
// ── XP system ──────────────────────────────────────────────────────────────

export const XP_PER_ROUND              = 10;
export const XP_THRESHOLD_SEASONED     = 100;
export const XP_THRESHOLD_VETERAN      = 400;
export const XP_THRESHOLD_ELITE        = 1000;

export const XP_HP_FULL_THRESHOLD      = 0.50; // HP ratio strictly > this → full XP retention
export const XP_RETENTION_DAMAGED      = 0.60; // HP ≤ threshold, not incapacitated
export const XP_RETENTION_INCAP_WIN    = 0.40; // incapacitated, division won

export const XP_POST_ELITE_SCALE       = 0.05;
export const XP_POST_ELITE_DECAY       = 500;

export const XP_TIER_HP_MULT: Record<string, number> = {
  green: 1.00, seasoned: 1.10, veteran: 1.20, elite: 1.35,
};
export const XP_TIER_SUPP_RESIST_MULT: Record<string, number> = {
  green: 1.00, seasoned: 1.05, veteran: 1.15, elite: 1.25,
};
export const XP_TIER_RECON_MULT: Record<string, number> = {
  green: 1.00, seasoned: 1.10, veteran: 1.25, elite: 1.40,
};
```

---

### Task 5: `game-server/src/types/perk_types.ts`

- [ ] **Step 6: Add `xp_gain_mult` to PerkModifiers**

In the `PerkModifiers` interface, add:
```typescript
  xp_gain_mult: number;
```

In `IDENTITY_MODIFIERS`, add:
```typescript
  xp_gain_mult: 1.0,
```

- [ ] **Step 7: Add `terrain_stealth_bonus` and `xp_config` to PerkDefinition**

After `attack_config?` in `PerkDefinition`, add:
```typescript
  terrain_stealth_bonus?: Record<string, number>;   // terrain_cover → bonus stealth for applies_to_unit
  xp_config?: {
    full_hp_threshold?:  number;   // replaces XP_HP_FULL_THRESHOLD (0.50)
    incap_retention?:    number;   // replaces XP_RETENTION_INCAP_WIN (0.40)
    damaged_retention?:  number;   // replaces XP_RETENTION_DAMAGED (0.60)
  };
```

---

### Task 6: `game-server/src/data/perks.ts`

- [ ] **Step 8: Add new import for XP constants**

Add to the existing import from `combat_constants.js` (create this import if it doesn't exist):
```typescript
import {
  XP_HP_FULL_THRESHOLD,
  XP_RETENTION_INCAP_WIN,
  XP_RETENTION_DAMAGED,
} from "../data/combat_constants.js";
```

- [ ] **Step 9: Add new perks to PERK_REGISTRY**

Append inside the `PERK_REGISTRY` object:
```typescript
  "sniper_forest_stealth": {
    perk_id: "sniper_forest_stealth",
    scope: "unit_type",
    applies_to_unit: "sniper",
    modifiers: {},
    terrain_stealth_bonus: { "light_forest": 1, "dense_forest": 2 },
  },
  "sniper_urban_stealth": {
    perk_id: "sniper_urban_stealth",
    scope: "unit_type",
    applies_to_unit: "sniper",
    modifiers: {},
    terrain_stealth_bonus: { "urban": 2 },
  },
  "commando_stealth_doctrine": {
    perk_id: "commando_stealth_doctrine",
    scope: "unit_type",
    applies_to_unit: "commando",
    modifiers: {},
    terrain_stealth_bonus: { "light_forest": 1, "dense_forest": 2, "urban": 2, "hills": 1 },
  },
  "elite_unit_doctrine": {
    perk_id: "elite_unit_doctrine",
    scope: "unit_type",
    applies_to_unit: "commando",
    modifiers: { xp_gain_mult: 1.25 },
    xp_config: { incap_retention: 0.55 },
  },
```

- [ ] **Step 10: Add `resolveTerrainStealthBonuses` function**

Append after `resolveAttackConfig`:
```typescript
/**
 * Returns unit_type → terrain stealth bonus for the given terrain cover string.
 * Stacks additively across all applicable perks for the same unit type.
 */
export function resolveTerrainStealthBonuses(
  terrain:       string,
  activePerkIds: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def || def.scope !== "unit_type" || !def.terrain_stealth_bonus || !def.applies_to_unit) continue;
    const bonus = def.terrain_stealth_bonus[terrain];
    if (!bonus) continue;
    result[def.applies_to_unit] = (result[def.applies_to_unit] ?? 0) + bonus;
  }
  return result;
}
```

- [ ] **Step 11: Add `resolveXpConfig` function**

Append after `resolveTerrainStealthBonuses`:
```typescript
/**
 * Returns effective XP config for a unit type. Last applicable perk wins per field.
 */
export function resolveXpConfig(
  unitType:      string,
  activePerkIds: string[],
): { full_hp_threshold: number; incap_retention: number; damaged_retention: number } {
  const result = {
    full_hp_threshold: XP_HP_FULL_THRESHOLD,
    incap_retention:   XP_RETENTION_INCAP_WIN,
    damaged_retention: XP_RETENTION_DAMAGED,
  };
  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def || def.scope !== "unit_type" || def.applies_to_unit !== unitType || !def.xp_config) continue;
    if (def.xp_config.full_hp_threshold !== undefined) result.full_hp_threshold = def.xp_config.full_hp_threshold;
    if (def.xp_config.incap_retention   !== undefined) result.incap_retention   = def.xp_config.incap_retention;
    if (def.xp_config.damaged_retention !== undefined) result.damaged_retention = def.xp_config.damaged_retention;
  }
  return result;
}
```

---

### Task 7: `game-server/src/systems/attack_patterns.ts`

#### Step 12: Expand import from `combat_constants.js`

Add to existing import:
```typescript
import {
  BASE_ATTRITION,
  SIDE_ARMOUR_MULT,
  RECON_CONTRIB_RATES,
  XP_THRESHOLD_SEASONED,
  XP_THRESHOLD_VETERAN,
  XP_THRESHOLD_ELITE,
  XP_TIER_HP_MULT,
  XP_TIER_SUPP_RESIST_MULT,
  XP_TIER_RECON_MULT,
  XP_POST_ELITE_SCALE,
  XP_POST_ELITE_DECAY,
} from "../data/combat_constants.js";
```

#### Step 13: Add XP helpers (after `_reconContribution`, before `getTargetCells`)

```typescript
export function getXpTier(xp_points: number): "green" | "seasoned" | "veteran" | "elite" {
  if (xp_points >= XP_THRESHOLD_ELITE)    return "elite";
  if (xp_points >= XP_THRESHOLD_VETERAN)  return "veteran";
  if (xp_points >= XP_THRESHOLD_SEASONED) return "seasoned";
  return "green";
}

function _postEliteBonus(xp_points: number): number {
  if (xp_points < XP_THRESHOLD_ELITE) return 0;
  return XP_POST_ELITE_SCALE * Math.log1p((xp_points - XP_THRESHOLD_ELITE) / XP_POST_ELITE_DECAY);
}

/** HP damage reduction multiplier. Divide incoming HP damage by this value. */
export function getXpHpMult(xp_points: number): number {
  return (XP_TIER_HP_MULT[getXpTier(xp_points)] ?? 1.0) + _postEliteBonus(xp_points);
}

/** Suppression resistance multiplier. Divide incoming suppression by this value. */
export function getXpSuppResistMult(xp_points: number): number {
  return XP_TIER_SUPP_RESIST_MULT[getXpTier(xp_points)] ?? 1.0;
}

/** Recon contribution multiplier. Multiply recon gain by this value. */
export function getXpReconMult(xp_points: number): number {
  return XP_TIER_RECON_MULT[getXpTier(xp_points)] ?? 1.0;
}

/**
 * Returns XP retention multiplier for a unit at engagement end.
 * @param hp_ratio          cell.hp / 100
 * @param is_incapacitated  cell.incapacitated
 * @param division_won      whether this cell's division won
 * @param incap_retention   perk-resolved (default 0.40)
 * @param damaged_retention perk-resolved (default 0.60)
 */
export function _computeXpRetention(
  hp_ratio:          number,
  is_incapacitated:  boolean,
  division_won:      boolean,
  incap_retention:   number,
  damaged_retention: number,
): number {
  if (is_incapacitated) return division_won ? incap_retention : 0.0;
  if (hp_ratio > 0.50)  return 1.0;
  return damaged_retention;
}
```

#### Step 14: Add `_resolveStealthForRound` (after `_computeXpRetention`)

```typescript
/**
 * Resolves stealthed flag for each cell in `cells`.
 * Mutates cells[i].stealthed in place.
 *
 * @param cells              Cells to evaluate (one division's grid)
 * @param max_enemy_anti     Highest anti_stealth value among ALL active enemy cells
 * @param effective_stealths Array[25]: effective stealth per cell (base + terrain perk bonus)
 */
export function _resolveStealthForRound(
  cells:              GridCellState[],
  max_enemy_anti:     number,
  effective_stealths: number[],
): void {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.unit_type === "" || cell.incapacitated) {
      cell.stealthed = false;
      continue;
    }
    const s = effective_stealths[i] ?? 0;
    cell.stealthed = s > 0 && max_enemy_anti < s;
  }
}
```

#### Step 15: Filter stealthed cells from all target selection helpers

The stealthed check `&& !cell.stealthed` must be added anywhere a cell is considered a **target** (not as an attacker — stealthed units still fire).

**In `_columnTargets`:**
```typescript
// FIND:
if (cell && cell.unit_type !== "" && !cell.incapacitated) result.push(idx);
// REPLACE:
if (cell && cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed) result.push(idx);
```

**In `_resolveATColumn` (`hasArmourInCol`):**
```typescript
// FIND:
ARMOURED_TARGET_TYPES.has(cell.unit_type) && !cell.incapacitated
// REPLACE:
ARMOURED_TARGET_TYPES.has(cell.unit_type) && !cell.incapacitated && !cell.stealthed
```

**In `_sniperTargets` (the cell validity check during grid walk):**

NOTE: This function uses the variable name `c`, NOT `cell`, and it also checks `c.unit_type === type`.
```typescript
// FIND (exact condition in _sniperTargets — note variable 'c' and '=== type'):
if (c.unit_type === type && !c.incapacitated && c.unit_type !== "") {
// REPLACE:
if (c.unit_type === type && !c.incapacitated && c.unit_type !== "" && !c.stealthed) {
```

**In `_artilleryTargets` (occupied_count and value_score checks):**
```typescript
// FIND:
cell.unit_type !== "" && !cell.incapacitated
// REPLACE:
cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed
```

**In the frontmost-row helper** (used by infantry/MG/cavalry/flamethrower — look for the loop that finds the row for horizontal targeting):
```typescript
// FIND the living-cell test in the front-row search:
cell.unit_type !== "" && !cell.incapacitated
// REPLACE:
cell.unit_type !== "" && !cell.incapacitated && !cell.stealthed
```

- [ ] **Step 16: Run 6g tests — expect GREEN**
```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6g-xp-stealth.test.ts --exit --timeout 15000
```

---

### Task 8: `game-server/src/systems/combat_system.ts`

#### Step 17: Expand imports

Add to import from `./attack_patterns.js`:
```typescript
  getXpHpMult,
  getXpSuppResistMult,
  getXpReconMult,
  getXpTier,
  _resolveStealthForRound,
  _computeXpRetention,
```

Add to import from `../data/combat_constants.js`:
```typescript
  XP_PER_ROUND,
```

Add to import from `../data/perks.js`:
```typescript
  resolveTerrainStealthBonuses,
  resolveXpConfig,
```

#### Step 18: Add stealth helper methods to the class

Add near existing private helpers:
```typescript
private _computeEffectiveStealths(
  cells:       GridCellState[],
  perkBonuses: Record<string, number>,
): number[] {
  return cells.map(cell => {
    const base  = UNIT_COMBAT_STATS[cell.unit_type]?.stealth_level ?? 0;
    const bonus = perkBonuses[cell.unit_type]                       ?? 0;
    return base + bonus;
  });
}

private _computeMaxAntiStealth(cells: GridCellState[]): number {
  let max = 0;
  for (const cell of cells) {
    if (cell.unit_type !== "" && !cell.incapacitated) {
      const anti = UNIT_COMBAT_STATS[cell.unit_type]?.anti_stealth ?? 0;
      if (anti > max) max = anti;
    }
  }
  return max;
}
```

#### Step 19: Add stealth resolution at round start

Find the section in `_resolveCombat` that increments `pair.round` and calls `_applyDamage`:
```typescript
pair.round++;
```

Insert BEFORE `pair.round++`:
```typescript
// ── Stealth resolution (before damage each round) ─────────────────────────
{
  const terrain    = pair.battle_cover ?? "";
  const perksA     = Array.from(state.nations.get(divA.nation_id)?.researched_perks ?? []);
  const perksB     = Array.from(state.nations.get(divB.nation_id)?.researched_perks ?? []);
  const bonusesA   = resolveTerrainStealthBonuses(terrain, perksA);
  const bonusesB   = resolveTerrainStealthBonuses(terrain, perksB);
  const cellsA     = Array.from(divA.grid.cells);
  const cellsB     = Array.from(divB.grid.cells);
  _resolveStealthForRound(cellsA, this._computeMaxAntiStealth(cellsB), this._computeEffectiveStealths(cellsA, bonusesA));
  _resolveStealthForRound(cellsB, this._computeMaxAntiStealth(cellsA), this._computeEffectiveStealths(cellsB, bonusesB));
}
```

#### Step 20: Per-round XP accumulation (after `_accumulateRecon` calls)

After:
```typescript
_accumulateRecon(divA);
_accumulateRecon(divB);
```

Add:
```typescript
// ── Per-round XP accumulation ─────────────────────────────────────────────
{
  const perksA = Array.from(state.nations.get(divA.nation_id)?.researched_perks ?? []);
  const perksB = Array.from(state.nations.get(divB.nation_id)?.researched_perks ?? []);
  const accXp = (division: DivisionState, perkIds: string[]): void => {
    for (const cell of Array.from(division.grid.cells)) {
      if (cell.unit_type === "" || cell.incapacitated) continue;
      const mods = resolvePerkModifiers(cell.unit_type, perkIds);
      cell.xp_pending += XP_PER_ROUND * (mods.xp_gain_mult ?? 1.0);
    }
  };
  accXp(divA, perksA);
  accXp(divB, perksB);
}
```

#### Step 21: Apply XP bonuses in `_applyPerCellDamage`

In the per-target inner loop, after computing `penMult`, add:
```typescript
const xpHpMult     = getXpHpMult(tCell.xp_points);
const xpSuppResist = getXpSuppResistMult(tCell.xp_points);
```

Change the HP damage line:
```typescript
// BEFORE:
tCell.hp = Math.max(0, tCell.hp - perTargetHp * penMult * tacticalHpBonus * artyMult);
// AFTER:
tCell.hp = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult) / xpHpMult);
```

Change the suppression line:
```typescript
// BEFORE:
tCell.suppression = Math.min(100, tCell.suppression + perTargetSupp * cavMult);
// AFTER:
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult) / xpSuppResist);
```

#### Step 22: Apply XP recon mult in `_accumulateRecon`

Find the existing `_accumulateRecon` closure and update the recon gain line:
```typescript
// BEFORE:
gain += _reconContribution(cell.unit_type);
// AFTER:
gain += _reconContribution(cell.unit_type) * getXpReconMult(cell.xp_points);
```

#### Step 23: Reset `xp_pending` at engagement start

In `_detectEngagements`, after the `const pair: ActivePair = { ... }` block is created:
```typescript
// Reset XP pending for both divisions at engagement start
for (const cell of Array.from(divA.grid.cells)) cell.xp_pending = 0;
for (const cell of Array.from(divB.grid.cells)) cell.xp_pending = 0;
```

#### Step 24: Add `_finalizeEngagementXp` private method

```typescript
private _finalizeEngagementXp(
  division:     DivisionState,
  division_won: boolean,
  state:        GameRoomState,
): void {
  const perkIds = Array.from(state.nations.get(division.nation_id)?.researched_perks ?? []);
  for (const cell of Array.from(division.grid.cells)) {
    if (cell.unit_type === "" || cell.xp_pending === 0) {
      cell.xp_pending = 0;
      continue;
    }
    const cfg  = resolveXpConfig(cell.unit_type, perkIds);
    const mult = _computeXpRetention(
      cell.hp / 100,
      cell.incapacitated,
      division_won,
      cfg.incap_retention,
      cfg.damaged_retention,
    );
    cell.xp_points += Math.floor(cell.xp_pending * mult);
    cell.xp_pending = 0;
    cell.xp_tier    = getXpTier(cell.xp_points);
  }
}
```

#### Step 25: Call `_finalizeEngagementXp` at engagement ends

**In `_initiateRetreat(div, enemies, state, changed, broadcast)`:**

After the retreat logic, add:
```typescript
// XP finalization: retreating division is the loser
this._finalizeEngagementXp(div, false, state);
for (const enemy of enemies) {
  this._finalizeEngagementXp(enemy, true, state);
}
```

**In `_checkDisengagement`**, inside the `if (distKm > hardThreshold)` block, before `toRemove.push(key)`:
```typescript
// XP finalization: natural disengagement — draw, both sides treated as "won"
this._finalizeEngagementXp(divA, true, state);
this._finalizeEngagementXp(divB, true, state);
```

Note: `_checkDisengagement` needs access to `state`. Check if it already has it as a parameter. If not, add `state: GameRoomState` to its signature.

**Division destroyed (HP = 0, encircled — cannot retreat):**

In `_applyDamage`, after computing `divA.hp` and `divB.hp` from `_computeDivisionHp`, add:
```typescript
if (divA.hp <= 0 && divA.supply_status === "encircled") {
  for (const cell of Array.from(divA.grid.cells)) cell.xp_pending = 0;
  divA.combat_state = "destroyed";
  changed.add(divA.division_id);
}
if (divB.hp <= 0 && divB.supply_status === "encircled") {
  for (const cell of Array.from(divB.grid.cells)) cell.xp_pending = 0;
  divB.combat_state = "destroyed";
  changed.add(divB.division_id);
}
```

- [ ] **Step 26: TypeScript compilation — zero errors**
```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server && npx tsc --noEmit
```

---

### Task 9: `client/src/ui/hud/attack_pattern_registry.gd`

- [ ] **Step 27: Filter stealthed cells from target selection**

Find every place in the GDScript where cells are filtered to determine valid targets (look for `cell.get("incapacitated", false)` checks). Add the stealthed filter alongside each one:

```gdscript
# FIND this pattern in all target-selection helpers:
not cell.get("incapacitated", false)
# REPLACE WITH:
not cell.get("incapacitated", false) and not cell.get("stealthed", false)
```

This applies to: the front-row helper, `_column_targets`, `_at_column_targets`, and `_sniper_targets` (any helper that returns target cell indices).

---

## Verification

- [ ] **Step 28: All 6g tests GREEN**
```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6g-xp-stealth.test.ts --exit --timeout 15000
```

- [ ] **Step 29: Regression — all prior tests GREEN**
```bash
NODE_ENV=test npx mocha -r tsx \
  test/6f-special-patterns.test.ts \
  test/6e-armour-patterns.test.ts \
  test/6d-infantry-patterns.test.ts \
  test/6c-combat-stats.test.ts \
  test/6a-grid-schema.test.ts \
  --exit --timeout 30000
```

- [ ] **Step 30: TypeScript clean**
```bash
npx tsc --noEmit
```

---

## Common Errors to Avoid

1. **`xp_pending` vs `xp_points`:** `xp_pending` is ONLY the current-engagement accumulator. `xp_points` is career total. NEVER add `XP_PER_ROUND` directly to `xp_points`.

2. **Tier updated only at finalization:** Call `getXpTier(cell.xp_points)` and write `cell.xp_tier` only inside `_finalizeEngagementXp`. The per-round loop only touches `xp_pending`.

3. **HP mult is damage REDUCTION, not HP boost:** Divide `perTargetHp` by `getXpHpMult`. Do NOT multiply the cell's HP.

4. **`_computeXpRetention` signature order:** `(hp_ratio, is_incapacitated, division_won, incap_retention, damaged_retention)`. `hp_ratio = cell.hp / 100`. Do NOT pass raw `cell.hp`.

5. **`hp_ratio > 0.50` is strictly greater.** `hp_ratio = 0.50` → damaged (0.6 retention). Only `> 0.50` → full retention.

6. **Stealthed cells still gain XP per round.** Skip `incapacitated` in XP accumulation but NOT `stealthed` — stealth doesn't prevent XP gain.

7. **Stealthed filter on TARGETS only.** Stealthed cells fire normally (appear in fireOrder). Filter only when building target lists inside `getTargetCells` helpers.

8. **Stealth resolution BEFORE damage.** `_resolveStealthForRound` calls in `_resolveCombat` must precede `pair.round++` and `_applyDamage`. Wrong order means stealthed flags from last round are used.

9. **`_resolveStealthForRound` takes a flat `number[]` array, NOT `GridCellState[]` for the stealth values.** The caller must pre-compute `effective_stealths[i]` from `UNIT_COMBAT_STATS + perkBonuses`. The function only reads `effective_stealths[i]` and `max_enemy_anti`.

10. **`_finalizeEngagementXp` on BOTH sides in `_initiateRetreat`.** Retreating div: `division_won=false`. Each enemy: `division_won=true`. Missing the enemy-side call leaves elite enemy units with `xp_pending` stuck uncommitted.

11. **`resolveXpConfig` and `resolveTerrainStealthBonuses` need the new constants import.** Add the three XP constants to the import in `perks.ts`.

12. **All TypeScript relative imports end in `.js`.** Test file: `"../src/systems/attack_patterns.js"` and `"../src/rooms/schema/GameRoomState.js"`.

13. **Read `unit_combat_stats.ts` before writing.** The existing `pen`, `armour`, `hp_floor_pct` values must be preserved exactly. Only ADD `stealth_level` and `anti_stealth`.

14. **`_checkDisengagement` needs `state` parameter.** If it doesn't already take `state: GameRoomState`, add it and update the call site in the update loop. Look for where `_checkDisengagement` is called and add `state` there too.
