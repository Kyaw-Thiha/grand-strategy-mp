# Plan: Phase 6 H — Row Positional Perks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add row-positional combat perks (passive bonuses based on which row a unit occupies) to the server-side round resolution, and expose them as persistent UI labels in both the Division Builder and the Tactical Combat Panel.

**Architecture:** A new pure-function module `row_perk_system.ts` owns the perk constants and derivation logic (easily unit-tested in isolation). Integration into `combat_system.ts` is two surgical edits to `_applyPerCellDamage` (attacker/defender row lookups) plus one edit to the existing `_decayCellSuppression` method (per-cell forEach to apply RESERVE decay multiplier). GDScript UI changes are additive-only — no existing node is removed, only sub-labels are inserted.

**Tech Stack:** TypeScript + Mocha (server), GDScript 4 + Godot 4 (client UI).

---

## Row Perk Reference Table

```
logical_row = Math.floor(cell_index / 5)
  cell_index 0–4   → row 0 = REAR      → no bonus
  cell_index 5–9   → row 1 = RESERVE   → faster suppression decay (+50% decay rate)
  cell_index 10–14 → row 2 = SUPPORT   → suppression resistance (receive 20% less supp)
  cell_index 15–19 → row 3 = ASSAULT   → +HP damage dealt (+20%)
  cell_index 20–24 → row 4 = VANGUARD  → +suppression dealt (+25%)

┌──────────────────┬──────────────────────────┬──────────────────────────────────┐
│       Row        │          Bonus           │  Multiplier constant             │
├──────────────────┼──────────────────────────┼──────────────────────────────────┤
│ VANGUARD (row 4) │ +suppression dealt       │ ROW_PERK_SUPP_DEALT_MULT = 1.25  │
│ ASSAULT  (row 3) │ +HP damage               │ ROW_PERK_HP_DEALT_MULT   = 1.20  │
│ SUPPORT  (row 2) │ +suppression resistance  │ ROW_PERK_SUPP_RESIST     = 0.80  │
│ RESERVE  (row 1) │ faster suppression decay │ ROW_PERK_DECAY_MULT      = 1.50  │
│ REAR     (row 0) │ no bonus                 │ —                                │
└──────────────────┴──────────────────────────┴──────────────────────────────────┘
```

> SUPPORT perk is a **defender** benefit: units in SUPPORT row receive 20% less suppression (multiply incoming suppression by 0.80). The other perks are **attacker** benefits applied at the attacker's row.

---

## Files Overview

**Create:**
- `game-server/src/systems/row_perk_system.ts` — pure functions, no dependencies
- `game-server/test/6h-row-perks.test.ts` — Mocha integration tests

**Modify:**
- `game-server/src/systems/combat_system.ts` — 2 edits to `_applyPerCellDamage`, 1 edit to `_decayCellSuppression` (line 648)
- `client/src/ui/hud/division_builder_panel.gd` — add perk sub-label under each row name
- `client/src/ui/hud/tactical_combat_panel.gd` — add persistent perk label on each row edge

---

## Task 1: `row_perk_system.ts` — pure module + unit tests

**Files:**
- Create: `game-server/src/systems/row_perk_system.ts`
- Create: `game-server/test/6h-row-perks.test.ts` (unit-test portion — no server needed)

- [ ] **Step 1: Write the test file first (RED)**

Create `game-server/test/6h-row-perks.test.ts`:

```typescript
import { describe, it } from "mocha";
import assert from "assert";
import {
  getRowPerkModifiers,
  ROW_PERK_SUPP_DEALT_MULT,
  ROW_PERK_HP_DEALT_MULT,
  ROW_PERK_SUPP_RESIST,
  ROW_PERK_DECAY_MULT,
} from "../src/systems/row_perk_system";

describe("row-perk-system — unit tests", () => {

  it("VANGUARD (row 4): supp_dealt_mult > 1, hp/resist/decay all identity", () => {
    const m = getRowPerkModifiers(4);
    assert.strictEqual(m.supp_dealt_mult, ROW_PERK_SUPP_DEALT_MULT);
    assert.strictEqual(m.hp_dealt_mult,   1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("ASSAULT (row 3): hp_dealt_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(3);
    assert.strictEqual(m.hp_dealt_mult,    ROW_PERK_HP_DEALT_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("SUPPORT (row 2): supp_resist_mult < 1 (defender receives less supp), others identity", () => {
    const m = getRowPerkModifiers(2);
    assert.strictEqual(m.supp_resist_mult, ROW_PERK_SUPP_RESIST);
    assert.ok(m.supp_resist_mult < 1.0, "SUPPORT resist mult must be < 1");
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("RESERVE (row 1): supp_decay_mult > 1, others identity", () => {
    const m = getRowPerkModifiers(1);
    assert.strictEqual(m.supp_decay_mult,  ROW_PERK_DECAY_MULT);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
  });

  it("REAR (row 0): all identity (no bonus)", () => {
    const m = getRowPerkModifiers(0);
    assert.strictEqual(m.supp_dealt_mult,  1.0);
    assert.strictEqual(m.hp_dealt_mult,    1.0);
    assert.strictEqual(m.supp_resist_mult, 1.0);
    assert.strictEqual(m.supp_decay_mult,  1.0);
  });

  it("out-of-range row (e.g. -1, 5) returns identity", () => {
    for (const row of [-1, 5, 99]) {
      const m = getRowPerkModifiers(row);
      assert.strictEqual(m.supp_dealt_mult,  1.0, `row ${row} supp_dealt should be 1`);
      assert.strictEqual(m.hp_dealt_mult,    1.0, `row ${row} hp_dealt should be 1`);
      assert.strictEqual(m.supp_resist_mult, 1.0, `row ${row} supp_resist should be 1`);
      assert.strictEqual(m.supp_decay_mult,  1.0, `row ${row} decay should be 1`);
    }
  });

  it("cell_index helper: correct logical_row for boundary cells", () => {
    // Test that Math.floor(cell_index / 5) gives the right row
    assert.strictEqual(Math.floor(0  / 5), 0);  // REAR first cell
    assert.strictEqual(Math.floor(4  / 5), 0);  // REAR last cell
    assert.strictEqual(Math.floor(5  / 5), 1);  // RESERVE first cell
    assert.strictEqual(Math.floor(19 / 5), 3);  // ASSAULT last cell
    assert.strictEqual(Math.floor(20 / 5), 4);  // VANGUARD first cell
    assert.strictEqual(Math.floor(24 / 5), 4);  // VANGUARD last cell
  });
});
```

- [ ] **Step 2: Run — expect RED (module not found)**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6h-row-perks.test.ts --exit --timeout 180000 2>&1 | tail -20
```

Expected: `Cannot find module '../src/systems/row_perk_system'`

- [ ] **Step 3: Create `game-server/src/systems/row_perk_system.ts`**

```typescript
/**
 * Row-positional combat perks.
 * Applied each round based on the logical row (Math.floor(cell_index / 5))
 * of attacker and defender cells.
 *
 * Row layout (logical_row):
 *   0 = REAR (cells 0–4)    — no bonus
 *   1 = RESERVE (5–9)       — faster suppression decay
 *   2 = SUPPORT (10–14)     — suppression resistance (defender)
 *   3 = ASSAULT (15–19)     — +HP damage dealt (attacker)
 *   4 = VANGUARD (20–24)    — +suppression dealt (attacker)
 */

export interface RowPerkModifiers {
  /** Multiplier on suppression output (attacker benefit). */
  supp_dealt_mult: number;
  /** Multiplier on HP damage output (attacker benefit). */
  hp_dealt_mult: number;
  /** Multiplier on incoming suppression (< 1 = defender receives less). */
  supp_resist_mult: number;
  /** Multiplier on per-round suppression decay rate (> 1 = decays faster). */
  supp_decay_mult: number;
}

export const ROW_PERK_SUPP_DEALT_MULT = 1.25;  // VANGUARD
export const ROW_PERK_HP_DEALT_MULT   = 1.20;  // ASSAULT
export const ROW_PERK_SUPP_RESIST     = 0.80;  // SUPPORT (defender: receive 20% less)
export const ROW_PERK_DECAY_MULT      = 1.50;  // RESERVE (decay 50% faster)

const IDENTITY: RowPerkModifiers = {
  supp_dealt_mult:  1.0,
  hp_dealt_mult:    1.0,
  supp_resist_mult: 1.0,
  supp_decay_mult:  1.0,
};

/**
 * Returns the row perk modifiers for a unit at the given logical_row.
 * logical_row = Math.floor(cell_index / 5)
 * Out-of-range rows return identity (no effect).
 */
export function getRowPerkModifiers(logical_row: number): RowPerkModifiers {
  switch (logical_row) {
    case 4: return { ...IDENTITY, supp_dealt_mult:  ROW_PERK_SUPP_DEALT_MULT };
    case 3: return { ...IDENTITY, hp_dealt_mult:    ROW_PERK_HP_DEALT_MULT   };
    case 2: return { ...IDENTITY, supp_resist_mult: ROW_PERK_SUPP_RESIST     };
    case 1: return { ...IDENTITY, supp_decay_mult:  ROW_PERK_DECAY_MULT      };
    default: return { ...IDENTITY };
  }
}
```

- [ ] **Step 4: Run — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6h-row-perks.test.ts --exit --timeout 180000 2>&1 | tail -20
```

Expected: `7 passing`

- [ ] **Step 5: Commit**

```bash
git add game-server/src/systems/row_perk_system.ts game-server/test/6h-row-perks.test.ts
git commit -m "feat: add row_perk_system pure module with unit tests"
```

---

## Task 2: Wire attacker row perks into `_applyPerCellDamage`

**File:** `game-server/src/systems/combat_system.ts`

The function `_applyPerCellDamage` is at approximately line 663. The attacker row is already computed at line ~682: `const attRow = Math.floor(idx / 5)`. The defender row must also be computed at the target cell.

- [ ] **Step 6: Write integration test for attacker perks (RED)**

Append a new `describe` block to `game-server/test/6h-row-perks.test.ts` **after** the closing `});` of the unit-test describe block. The integration section uses the same `spawnCombat` + `waitForEngagementRound` pattern as `6c-combat-stats.test.ts` — copy those helpers inline (no shared helpers directory exists).

Add at the **top** of `6h-row-perks.test.ts`, after the existing `row_perk_system` imports:

```typescript
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret  = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function waitForEngagementRound(client: any, engagementId: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unbind(); reject(new Error(`Timeout waiting for ROUND_RESOLVED for ${engagementId}`)); }, timeoutMs);
    const unbind = client.onMessage("ROUND_RESOLVED", (msg: any) => {
      if (typeof msg.engagement_id === "string" && msg.engagement_id.startsWith(engagementId)) {
        clearTimeout(timer); unbind(); resolve(msg);
      }
    });
  });
}
```

Then append this describe block **after** the unit-test describe block:

```typescript
describe("row-perk-system — integration", function () {
  this.timeout(180_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig);
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  // spawnCombat is defined inline here — no shared helpers directory exists.
  // divA = "div-a" attacks divB = "div-b". Single client controls both.
  async function spawnCombat(
    divAUnits: Record<number, string>,
    divBUnits: Record<number, string>
  ) {
    const token  = await makeToken();
    const room   = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const divA = "div-a";
    const divB = "div-b";

    client.send("SPAWN_DIVISION", { division_id: divA, nation_id: "germany", position_lng: 0, position_lat: 0 });
    client.send("SPAWN_DIVISION", { division_id: divB, nation_id: "france",  position_lng: 0.001, position_lat: 0.001 });
    await room.waitForNextPatch();

    for (const [idx, utype] of Object.entries(divAUnits)) {
      client.send("SET_CELL", { division_id: divA, cell_index: +idx, unit_type: utype });
    }
    for (const [idx, utype] of Object.entries(divBUnits)) {
      client.send("SET_CELL", { division_id: divB, cell_index: +idx, unit_type: utype });
    }
    await room.waitForNextPatch();

    await (room as any).startGame();
    await room.waitForNextPatch();
    await client.waitForMessage("COMBAT_STARTED", 60_000);

    const engagementId = `${divA}_vs_${divB}_`;
    return { room, client, engagementId };
  }

  it("VANGUARD attacker (cell 20) deals more suppression than REAR attacker (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 20: "infantry" },  // attacker VANGUARD row 4
      { 20: "infantry" }
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const suppA = msgA.defender_grid_delta?.[0]?.suppression ?? 0;

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },   // attacker REAR row 0
      { 0: "infantry" }
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const suppB = msgB.defender_grid_delta?.[0]?.suppression ?? 0;

    assert.ok(
      suppA >= suppB * ROW_PERK_SUPP_DEALT_MULT * 0.95,
      `VANGUARD supp ${suppA} should be ~${ROW_PERK_SUPP_DEALT_MULT}x REAR supp ${suppB}`
    );
  });

  it("ASSAULT attacker (cell 15) deals more HP damage than REAR attacker (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 15: "infantry" },  // attacker ASSAULT row 3
      { 15: "infantry" }
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const hpDmgA = 100 - (msgA.defender_grid_delta?.[0]?.hp ?? 100);

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },   // attacker REAR row 0
      { 0: "infantry" }
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const hpDmgB = 100 - (msgB.defender_grid_delta?.[0]?.hp ?? 100);

    assert.ok(
      hpDmgA >= hpDmgB * ROW_PERK_HP_DEALT_MULT * 0.95,
      `ASSAULT hp dmg ${hpDmgA} should be ~${ROW_PERK_HP_DEALT_MULT}x REAR hp dmg ${hpDmgB}`
    );
  });

  it("SUPPORT defender (cell 10) receives less suppression than REAR defender (cell 0)", async () => {
    const { client: cA, engagementId: engA } = await spawnCombat(
      { 0: "infantry" },
      { 10: "infantry" }   // defender SUPPORT row 2
    );
    const msgA = await waitForEngagementRound(cA, engA, 60_000);
    const suppReceivedA = msgA.defender_grid_delta?.[0]?.suppression ?? 0;

    const { client: cB, engagementId: engB } = await spawnCombat(
      { 0: "infantry" },
      { 0: "infantry" }    // defender REAR row 0
    );
    const msgB = await waitForEngagementRound(cB, engB, 60_000);
    const suppReceivedB = msgB.defender_grid_delta?.[0]?.suppression ?? 0;

    assert.ok(
      suppReceivedA <= suppReceivedB * ROW_PERK_SUPP_RESIST * 1.05,
      `SUPPORT supp received ${suppReceivedA} should be ~${ROW_PERK_SUPP_RESIST}x REAR received ${suppReceivedB}`
    );
  });
});
```

- [ ] **Step 8: Run integration tests — expect RED**

```bash
NODE_ENV=test npx mocha -r tsx test/6h-row-perks.test.ts --exit --timeout 180000 2>&1 | tail -30
```

Expected: unit tests pass (7), integration tests fail (ASSAULT/VANGUARD/SUPPORT perks not applied yet).

- [ ] **Step 9: Import `row_perk_system` in `combat_system.ts`**

At the top of `game-server/src/systems/combat_system.ts`, add the import after the existing imports:

```typescript
import { getRowPerkModifiers } from "./row_perk_system";
```

- [ ] **Step 10: Wire attacker + defender row perks into `_applyPerCellDamage`**

In `_applyPerCellDamage` (around line 663), find the block where `attRow` is computed and where `tCell.hp` and `tCell.suppression` are mutated. 

First, grep to confirm the exact lines:
```bash
grep -n "attRow\|tCell\.hp\|tCell\.suppression\|perTargetHp\|perTargetSupp" \
  game-server/src/systems/combat_system.ts | head -30
```

The expected structure is:
```typescript
const attRow = Math.floor(idx / 5);   // attacker's logical row
// ... target selection loop ...
tCell.hp = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult) / xpHpMult);
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult) / xpSuppResist);
```

Make two additions:

**Addition 1:** After `const attRow = Math.floor(idx / 5);`, add:
```typescript
const attackerRowPerk = getRowPerkModifiers(attRow);
```

**Addition 2:** Inside the target cell loop, before the `tCell.hp` and `tCell.suppression` lines, add defender row lookup:
```typescript
const defRow = Math.floor(targetCellIndex / 5);  // targetCellIndex = the index of tCell
const defenderRowPerk = getRowPerkModifiers(defRow);
```

**Addition 3:** Update the two mutation lines to apply the multipliers:

FIND:
```typescript
tCell.hp = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult) / xpHpMult);
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult) / xpSuppResist);
```

REPLACE:
```typescript
tCell.hp = Math.max(0, tCell.hp - (perTargetHp * penMult * tacticalHpBonus * artyMult * attackerRowPerk.hp_dealt_mult) / xpHpMult);
tCell.suppression = Math.min(100, tCell.suppression + (perTargetSupp * cavMult * attackerRowPerk.supp_dealt_mult * defenderRowPerk.supp_resist_mult) / xpSuppResist);
```

> **Note on `targetCellIndex`:** Find the variable name used to index `tCell` in the actual code (it may be `tIdx`, `targetIdx`, `t`, etc.). Grep for `defender.cells\[` or `tCell` to find the exact name.

- [ ] **Step 11: Wire RESERVE suppression decay perk into `_decayCellSuppression`**

Suppression decay already exists at `combat_system.ts:648` in the method `_decayCellSuppression`. It currently iterates `div.grid.cells` with a `for...of` loop (no index), so it can't compute the logical row. Change the loop to `forEach` to get the cell index.

FIND (exact text at line 648–655):
```typescript
  private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
    if (!div.grid) return;
    const decay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
    for (const cell of div.grid.cells) {
      if (cell.unit_type === "") continue;
      cell.suppression = Math.max(0, cell.suppression - decay);
    }
  }
```

REPLACE:
```typescript
  private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
    if (!div.grid) return;
    const baseDecay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
    div.grid.cells.forEach((cell, cellIdx) => {
      if (cell.unit_type === "") return;
      const cellRow = Math.floor(cellIdx / 5);
      const decayPerk = getRowPerkModifiers(cellRow);
      cell.suppression = Math.max(0, cell.suppression - baseDecay * decayPerk.supp_decay_mult);
    });
  }
```

Note: `CELL_SUPP_DECAY_BASE = 8` and `CELL_SUPP_DECAY_RETREAT = 20` are already defined as module-level constants — do not redefine them.

- [ ] **Step 12: Run integration tests — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6h-row-perks.test.ts --exit --timeout 180000 2>&1 | tail -30
```

Expected: `10 passing`

- [ ] **Step 13: Run full test suite — no regressions**

```bash
NODE_ENV=test npx mocha -r tsx "test/**/*.test.ts" --exit --timeout 180000 2>&1 | tail -30
```

Expected: all previously-passing tests still pass.

- [ ] **Step 14: Commit**

```bash
git add game-server/src/systems/combat_system.ts \
        game-server/test/6h-row-perks.test.ts
git commit -m "feat: wire row positional perks into combat round resolution"
```

---

## Task 3: UI — Division Builder row perk sub-labels

**File:** `client/src/ui/hud/division_builder_panel.gd`

Row labels are built in `_build_grid_panel()`. Currently each row gets a single `Label` for the row name. Add a second small label beneath it showing the perk bonus. Both labels fit in the same `VBoxContainer` per row.

The row label column is a `VBoxContainer` (`row_label_col`) where each row label has `custom_minimum_size = Vector2(68, 76)`. Change the per-row entry from a single Label to a VBoxContainer holding two Labels (name + perk). The minimum height stays 76 px.

- [ ] **Step 15: Find the exact row label creation block**

Grep to confirm line numbers:
```bash
grep -n "ROW_NAMES\[r\]\|row_lbl\|custom_minimum_size = Vector2(68" \
  client/src/ui/hud/division_builder_panel.gd
```

- [ ] **Step 16: Replace the per-row label block**

In `_build_grid_panel()`, find and replace the per-row label creation inside the `for r: int in range(5):` loop:

FIND:
```gdscript
	for r: int in range(5):
		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.custom_minimum_size = Vector2(68, 76)  # matches cell height
		row_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row_lbl.add_theme_font_size_override("font_size", 11)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		row_label_col.add_child(row_lbl)
```

REPLACE:
```gdscript
	const ROW_PERK_HINTS: Array[String] = [
		"+supp dealt",       # VANGUARD (row 0 in builder = front)
		"+HP damage",        # ASSAULT
		"+supp resist",      # SUPPORT
		"↑ supp decay",      # RESERVE
		"—",                 # REAR
	]
	for r: int in range(5):
		var row_cell := VBoxContainer.new()
		row_cell.custom_minimum_size = Vector2(68, 76)
		row_cell.alignment = BoxContainer.ALIGNMENT_CENTER
		row_label_col.add_child(row_cell)

		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row_lbl.add_theme_font_size_override("font_size", 11)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		row_cell.add_child(row_lbl)

		var perk_lbl := Label.new()
		perk_lbl.text = ROW_PERK_HINTS[r]
		perk_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		perk_lbl.add_theme_font_size_override("font_size", 9)
		perk_lbl.add_theme_color_override("font_color", Color(ROW_COLORS[r].r, ROW_COLORS[r].g, ROW_COLORS[r].b, 0.65))
		row_cell.add_child(perk_lbl)
```

> **IMPORTANT on row index alignment:** The Division Builder uses `visual_row 0 = VANGUARD (front/top)`, so `ROW_PERK_HINTS[0]` is VANGUARD's bonus. This matches `ROW_NAMES[0] = "VANGUARD"`. The server uses logical_row 4 = VANGUARD, but the hint array is indexed by the builder's visual_row (0–4), not the server's logical_row. They are opposite ends of the grid — the hint array must be ordered to match ROW_NAMES[], not the server's row numbering.

- [ ] **Step 17: Manual test — open Division Builder**

Launch game → Military panel → [+]. Verify:
- Each row label on the left now shows two lines: row name in row color, perk hint below it in the same color at 65% opacity
- Layout is not broken (cells still align with row labels)
- REAR row shows "—" hint

- [ ] **Step 18: Commit**

```bash
git add client/src/ui/hud/division_builder_panel.gd
git commit -m "feat: add row perk hints to Division Builder row labels"
```

---

## Task 4: UI — Tactical Combat Panel row perk labels

**File:** `client/src/ui/hud/tactical_combat_panel.gd`  
**Plan reference:** `plans/phase-6-task-k-tactical-grid-ui.md`

> **⚠️ PREREQUISITE: Branch K must be merged first.**  
> `tactical_combat_panel.gd` does not exist yet — it is created by Branch K (`feat/tactical-grid-ui`). This task **cannot run** until Branch K is complete. If you are executing this plan before Branch K merges, skip Task 4 entirely and open a follow-up task to add perk labels once Branch K is done.

Per `UI_UX_DESIGN.md §7.5`, row perk labels are persistent ambient labels on each row edge. In the combat panel, the grid is displayed with logical rows as visual columns (rotated 90°), so each visual column = one logical row. The perk label goes at the top or bottom of each visual column (i.e., above or below the column in the GridContainer).

**Implementation approach:** Add a row of small `Label` nodes above the OwnGrid as a second `HBoxContainer` of column headers, one per logical row displayed as a visual column. Same pattern for EnemyGrid.

- [ ] **Step 19: Add perk label row above each grid**

In `tactical_combat_panel.gd`, find `_build_grid()`. Before creating the `GridContainer`, insert a perk label row. The labels correspond to logical rows displayed left-to-right in the visual grid.

For OWN grid, OWN_DISPLAY_ORDER maps visual columns 0–4 to logical rows 0–4 (rear→vanguard left-to-right). So the perk labels go in order: REAR, RESERVE, SUPPORT, ASSAULT, VANGUARD.

Add inside `_build_grid()`, after the direction label and before the GridContainer:

```gdscript
const PERK_LABEL_TEXT: Array[String] = [
    "—",            # REAR (logical row 0, leftmost visual col for own grid)
    "↑decay",       # RESERVE
    "supp↓",        # SUPPORT
    "+HP",          # ASSAULT
    "+supp",        # VANGUARD (rightmost, nearest front line)
]
const PERK_LABEL_COLORS: Array = [
    Color(0.5, 0.5, 0.5, 0.5),                    # REAR — muted
    Color(0.20, 0.40, 0.75, 0.75),                # RESERVE — blue
    Color(0.75, 0.65, 0.10, 0.75),                # SUPPORT — yellow
    Color(0.85, 0.45, 0.10, 0.75),                # ASSAULT — orange
    Color(0.80, 0.15, 0.15, 0.75),                # VANGUARD — red
]

var perk_row := HBoxContainer.new()
perk_row.add_theme_constant_override("separation", 0)
parent_vbox.add_child(perk_row)   # parent_vbox = the VBoxContainer holding the grid

for col: int in range(5):
    var pl := Label.new()
    pl.text = PERK_LABEL_TEXT[col] if not is_enemy else PERK_LABEL_TEXT[4 - col]
    pl.custom_minimum_size = Vector2(88, 16)   # matches GridCell width
    pl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    pl.add_theme_font_size_override("font_size", 9)
    pl.add_theme_color_override("font_color",
        PERK_LABEL_COLORS[col] if not is_enemy else PERK_LABEL_COLORS[4 - col])
    perk_row.add_child(pl)
```

> For the ENEMY grid, the display order is mirrored (ENEMY_DISPLAY_ORDER puts VANGUARD leftmost), so the label array is reversed: `PERK_LABEL_TEXT[4 - col]`.

- [ ] **Step 20: Manual test — open Tactical Combat Panel**

Trigger `EventBus.tactical_combat_opened.emit("div-a", "div-b")` from a debug button or the Godot remote inspector. Verify:
- A row of small perk labels appears above both grids
- OWN grid (left): leftmost label = "—" (REAR), rightmost = "+supp" (VANGUARD)
- ENEMY grid (right): leftmost = "+supp" (VANGUARD, nearest front), rightmost = "—" (REAR)
- Labels are small and don't disrupt the grid cell alignment

- [ ] **Step 21: Commit**

```bash
git add client/src/ui/hud/tactical_combat_panel.gd
git commit -m "feat: add persistent row perk labels to Tactical Combat Panel"
```

---

## Verification Checklist

- [ ] Unit tests (`6h-row-perks.test.ts` describe block 1): 7 passing, covers all 5 rows + out-of-range
- [ ] Integration test VANGUARD: suppression dealt is ~1.25× a REAR unit's output
- [ ] Integration test ASSAULT: HP damage dealt is ~1.20× a REAR unit's output  
- [ ] Integration test SUPPORT: suppression received is ~0.80× a REAR unit's suppression
- [ ] Integration test RESERVE: after 2+ rounds, RESERVE units have lower suppression than REAR units that received identical hits (decay ran faster)
- [ ] Full test suite passes — no regressions in 6a–6g tests
- [ ] Division Builder: row labels show name + perk hint, correctly ordered (VANGUARD hint on visual row 0 = front/top)
- [ ] Tactical Combat Panel: perk labels above both grids, mirrored correctly for enemy side
- [ ] No GDScript errors in Godot output log
