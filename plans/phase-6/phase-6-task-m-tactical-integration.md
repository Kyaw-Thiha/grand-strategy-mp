# Plan: Branch M — Tactical Integration Gate

> **Branch:** `feat/tactical-integration`
> **Branches off:** `main` (after Branch K merges)
> **Approach:** TDD — write assertions first, run RED, fix integration gaps, GREEN

## Context

All Phase 6 subsystems (combat engine, attack patterns, formation rules, terrain modifiers,
XP, UI panels) are implemented in branches A–K. Branch M wires them together and proves the
Phase 6 verification gate passes end-to-end: two preset division templates fight, rounds
resolve, suppression builds, one division auto-retreats, and the Godot tactical panel shows
live updates.

**What already exists (do NOT reimplement):**
- `game-server/src/systems/combat_system.ts` — full combat engine
- `game-server/src/rooms/GameRoom.ts` — ASSIGN_TEMPLATE, SUBMIT_MOVE_ORDER, RETREAT handlers
- `game-server/src/rooms/GameRoom.ts:23` — `MIN_PLAYERS_TO_START = 1` (one player can start)
- Dev-mode messages (when `NODE_ENV=test`): `SPAWN_NATION`, `SPAWN_DIVISION`, `SET_CELL`, `APPLY_PERKS`
- `game-server/test/4c-combat.e2e.ts` — existing e2e pattern (auth, room join, message flow)
- Auto-retreat thresholds: defender ≥ 60 suppression, attacker ≥ 80 suppression
- `ROUND_RESOLVED` payload: `{ round_number, lethality_phase, attacker_grid_delta, defender_grid_delta, formation_bonuses_active, xp_changes }`
- `COMBAT_ENDED` payload: `{ winner_id, retreated_id }`

**Known system state (verified by codebase investigation):**
- `getActiveFormationRules()` returns `[]` — formation bonus engine is wired but has zero active rules. `formation_bonuses_active` in ROUND_RESOLVED is therefore always `[]`. No E2E assertion can use it.
- `xp_changes` in ROUND_RESOLVED is hardcoded `[]` (comment: "Populated in future branches"). XP IS accumulated per-round in `cell.xp_pending` and committed to `xp_tier` at engagement end — but not exposed per-round. XP tier advancement is verifiable via `DIVISION_UPDATES` after combat ends.
- `getActiveTerrainModifierRules()` returns `[]` — terrain modifier engine wired, zero rules active.
- Dense_forest column-shift restriction for armour may be hardcoded in attack pattern code rather than via the terrain modifier engine. Verify by reading `_resolveArmourColumn` in `combat_system.ts` before asserting.
- Force recon lethality bypass: `combat_system.ts:875-877` applies `pair.lethality_multiplier` to all damage. Line 99 comment says force recon units bypass the ramp. Check whether a `bypasses_lethality` flag or equivalent conditional exists before writing the assertion — if absent, flag as a gap and implement.

**Preset cells arrays** (from `client/src/core/division_template_store.gd`):
- `preset_combined_arms` ("3rd Mechanized"): Row 0 → recon_infantry (idx 0, 2); Row 1 → medium_tank (5,6), infantry (7); Row 2 → artillery (10), at_gun (11); Row 3 → infantry (15)
- `preset_infantry` ("1st Infantry Div"): Row 0 → recon_infantry (0), infantry (1); Row 1 → assault_infantry (5,6), infantry (7); Row 2 → mg (10), artillery (11), at_gun (12); Row 3 → infantry (15,16); Row 4 → infantry (20)

Cell index formula: `visual_row * 5 + col` where visual_row 0 = Vanguard (front/R5). Unoccupied cells = `""`.

---

## Pre-flight: Read before implementing

Before writing any code, read:
1. `game-server/test/6c-combat-stats.test.ts` — this is the primary template. It contains the `spawnCombat()` helper that shows the exact pattern: `colyseus.createRoom` → `client.connectTo(room)` → `SPAWN_DIVISION` at 0.001° apart → `(room as any).startGame()`. Copy this pattern verbatim. Do NOT use the lobby flow (SELECT_NATION / SET_READY / START_GAME message / SUBMIT_MOVE_ORDER).
2. `game-server/src/rooms/GameRoom.ts` lines 58–165 — exact ASSIGN_TEMPLATE message format (what fields it expects), and lines 662–669 for `serializeDivision()` (to know what to add for XP)
3. `game-server/src/systems/combat_system.ts` around line 875 — check whether force recon `bypasses_lethality` flag exists. If not, add it before writing the assertion in Task 2.
4. `game-server/src/systems/combat_system.ts` function `_resolveArmourColumn` — confirm dense_forest column-shift is hardcoded there (not via terrain_modifier_system) so the assertion approach is correct.

---

## Test architecture decision

**Use `ColyseusTestServer` (6*.test.ts style), NOT a real E2E test.**

Rationale:
- `setRoundTicksForTesting(1)` is only available in `ColyseusTestServer` tests — without it, each round takes 20 real seconds and the test runs for several minutes
- `SET_CELL` is gated behind `NODE_ENV=test` at `GameRoom.ts:110` — it only works in the `ColyseusTestServer` environment, not against a live server
- Existing `6*.test.ts` files already demonstrate this pattern; copy their setup

Before writing code, read one existing `6*.test.ts` file (e.g. `6a-formation-rules.test.ts` or similar) to understand the exact ColyseusTestServer setup, client creation, and tick-driving pattern.

---

## Task 1 — Gate Unit Test (RED → GREEN)

**File:** `game-server/test/6-phase-gate.test.ts`

### Step 1 — Write the test (expect RED)

Copy the **exact** boilerplate from `6c-combat-stats.test.ts` — including imports, lifecycle
hooks, token helper, and `waitForMessage` wrapper. The skeleton below captures the correct
structure; fill in missing details by reading that file first.

```typescript
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config.js";            // default import, .js required for ESM
import { setRoundTicksForTesting, setCombatGraceTicksForTesting } from "../src/systems/combat_system";
import { SignJWT } from "jose"; // same as in 6c-combat-stats.test.ts
import assert from "assert";

// --- Token helper (copy from 6c-combat-stats.test.ts) ---
async function makeToken(userId = "bot_" + Math.random().toString(36).slice(2)) {
  // Exact signing approach, key, and claims from 6c-combat-stats.test.ts
}

// --- waitForMessage helper (copy from 6c-combat-stats.test.ts) ---
function waitForMessage(client: any, type: string, timeoutMs: number): Promise<any> {
  // Exact implementation from 6c-combat-stats.test.ts
}

describe("Phase 6 gate", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);          // copy exact value from 6c
    setCombatGraceTicksForTesting(1);    // copy exact value from 6c
    colyseus = await boot(appConfig);
  });

  after(async () => {
    setRoundTicksForTesting(20);         // restore defaults (copy from 6c)
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("two preset divisions fight — rounds resolve — one retreats", async () => {
    const room   = await colyseus.createRoom("game_room", {});
    const tokenA = await makeToken();
    const tokenB = await makeToken();
    const client  = await colyseus.connectTo(room, { token: tokenA });
    await room.waitForNextPatch();                         // patch 1: client join processed

    const clientB = await colyseus.connectTo(room, { token: tokenB });

    // Spawn two divisions at 0.001° apart (within engagement radius)
    // Copy exact coordinates and field names from 6c-combat-stats.test.ts
    client.send("SPAWN_DIVISION", {
      division_id: "div_a", nation_id: "france",
      position_lng: 2.350, position_lat: 48.850,
    });
    clientB.send("SPAWN_DIVISION", {
      division_id: "div_b", nation_id: "germany",
      position_lng: 2.351, position_lat: 48.850,
    });
    await room.waitForNextPatch();                         // patch 2: both divisions in state

    // Populate cells via SET_CELL (NODE_ENV=test handler, conventional in existing tests)
    // preset_combined_arms for div_a
    const combinedArmsCells: [number, string][] = [
      [0, "recon_infantry"], [2, "recon_infantry"],
      [5, "medium_tank"], [6, "medium_tank"], [7, "infantry"],
      [10, "artillery"], [11, "at_gun"], [15, "infantry"],
    ];
    for (const [idx, unit] of combinedArmsCells) {
      client.send("SET_CELL", { division_id: "div_a", cell_index: idx, unit_type: unit });
    }

    // preset_infantry for div_b
    const infantryCells: [number, string][] = [
      [0, "recon_infantry"], [1, "infantry"],
      [5, "assault_infantry"], [6, "assault_infantry"], [7, "infantry"],
      [10, "mg"], [11, "artillery"], [12, "at_gun"],
      [15, "infantry"], [16, "infantry"], [20, "infantry"],
    ];
    for (const [idx, unit] of infantryCells) {
      clientB.send("SET_CELL", { division_id: "div_b", cell_index: idx, unit_type: unit });
    }
    await room.waitForNextPatch();                         // patch 3: all cells written

    // Collect events
    const combatStarted: any[] = [];
    const roundsResolved: any[] = [];
    const combatResults: any[] = [];
    const combatEnded: any[] = [];

    client.onMessage("COMBAT_STARTED", (msg: any) => combatStarted.push(msg));
    client.onMessage("ROUND_RESOLVED", (msg: any) => roundsResolved.push(msg));
    client.onMessage("COMBAT_RESULT",  (msg: any) => combatResults.push(msg));
    client.onMessage("COMBAT_ENDED",   (msg: any) => combatEnded.push(msg));

    // Start game directly — no lobby flow in ColyseusTestServer tests
    (room as any).startGame();
    await room.waitForNextPatch();                         // patch 4: game running state

    // Wait for COMBAT_ENDED (use client.waitForMessage, not room.waitForMessage)
    await waitForMessage(client, "COMBAT_ENDED", 60_000);

    // Assert core gate flow
    assert.equal(combatStarted.length, 1);
    assert.ok(combatStarted[0].division_a);
    assert.ok(combatStarted[0].division_b);

    assert.ok(roundsResolved.length >= 3, "at least 3 rounds must resolve");
    for (let i = 0; i < roundsResolved.length; i++) {
      assert.equal(roundsResolved[i].round_number, i + 1);
    }

    assert.ok(roundsResolved[0].attacker_grid_delta.length > 0,
      "Round 1 must produce attacker grid deltas");
    assert.ok(roundsResolved[0].defender_grid_delta.length > 0,
      "Round 1 must produce defender grid deltas");

    assert.equal(combatEnded.length, 1);
    assert.ok(combatEnded[0].retreated_id);
    assert.ok(combatEnded[0].winner_id);
    assert.notEqual(combatEnded[0].winner_id, combatEnded[0].retreated_id);
  });
});
```

### Step 2 — Run: `npm test -- --grep "Phase 6 gate"` → expect RED

### Step 3 — Fix integration gaps found by RED run

Common gaps to watch for:
- `makeToken()` / `waitForMessage()` signatures differ from the actual helpers in `6c-combat-stats.test.ts` — copy them verbatim
- `SPAWN_DIVISION` positions not within engagement radius — adjust coordinates to match the spacing used in `6c-combat-stats.test.ts`
- Tick count too low before COMBAT_ENDED fires — increase timeout in `waitForMessage`

Fix each gap, re-run until GREEN.

### Step 4 — Commit

```bash
git add game-server/test/6-phase-gate.test.ts
git commit -m "test: Phase 6 gate — two preset divisions fight, rounds resolve, retreat fires"
```

---

## Task 2 — Specific Gate Assertions (RED → GREEN)

Add targeted assertions to `6-phase-gate.test.ts` for gate items that have testable
server-side signals. Each step is one assertion block.

### Step 5 — Force recon full damage in Round 1

**Pre-condition:** First verify `bypasses_lethality` (or equivalent) exists in
`combat_system.ts` around line 875. If absent, add the flag to the force-recon unit check
before writing this assertion — otherwise it will never pass.

`preset_combined_arms` Row 0 (Vanguard/R5) has `recon_infantry` at indices 0 and 2.
In Round 1 `lethality_phase` = "contact" (low multiplier). Force recon bypasses this.

Compare Round 1 total damage vs Round 2 (after lethality ramps up):
```typescript
// GridCellDelta is { cell_index, hp?, suppression?, ... } — NOT a number.
// Sum the hp field from each delta object.
const r1DefDelta: any[] = roundsResolved[0].defender_grid_delta;
const r2DefDelta: any[] = roundsResolved[1].defender_grid_delta;
const r1Total = r1DefDelta.reduce((s, d) => s + Math.abs(d.hp ?? 0), 0);
const r2Total = r2DefDelta.reduce((s, d) => s + Math.abs(d.hp ?? 0), 0);
assert.ok(r1Total > 0, "Force recon must deal non-zero HP damage in Round 1");
// Force recon bypass means Round 1 damage must not be dramatically lower than Round 2
assert.ok(r1Total >= r2Total * 0.5,
  "Round 1 damage (with force recon bypass) must not be dramatically lower than Round 2");
```

### Step 6 — Suppression threshold triggers auto-retreat

Assert that `COMBAT_RESULT` suppression immediately before `COMBAT_ENDED` reached ≥ 60:

```typescript
const lastResult = combatResults[combatResults.length - 1];
const maxSuppression = Math.max(lastResult.suppression_a, lastResult.suppression_b);
assert.ok(maxSuppression >= 60, "Auto-retreat must fire at ≥60 suppression");
```

### Step 7 — XP accumulates after combat (via server state)

`xp_changes` in `ROUND_RESOLVED` is always `[]` (not yet populated). `DIVISION_UPDATES`
serializes only `unit_type, hp, suppression, xp_tier, incapacitated, stealthed` — NOT
`xp_points` (`serializeDivision()` at `GameRoom.ts:662-669`).

Two options — pick whichever the existing `6*.test.ts` files use for accessing post-combat state:

**Option A (preferred): Add `xp_points` to `serializeDivision()`**
In `game-server/src/rooms/GameRoom.ts` inside `serializeDivision()`, add `xp_points: cell.xp_points` alongside the existing fields. Then assert:
```typescript
const lastUpdate = divisionUpdates[divisionUpdates.length - 1];
const winnerDiv = lastUpdate?.divisions?.find((d: any) => d.division_id === winnerId);
assert.ok(winnerDiv?.grid?.cells?.some((c: any) => (c.xp_points ?? 0) > 0),
  "Winner's cells must have non-zero xp_points after combat");
```

**Option B: Read server state directly (ColyseusTestServer)**
In `ColyseusTestServer` tests, the room state is directly accessible. After COMBAT_ENDED,
read `room.state.divisions.get(winnerId).grid.cells` and assert `xp_points > 0`.

**Note:** XP tier advancement to "seasoned" needs 2–3 fights. To verify `xp_tier !== "green"`,
run a second combat cycle in the same test (trigger SUBMIT_MOVE_ORDER again after COMBAT_ENDED).

### Step 8 — Flamethrower in R3 reaches enemy R3/R4 depth

`SET_CELL` works in `ColyseusTestServer` tests (`NODE_ENV=test`). Use it to place a
flamethrower at index 10 (R3/Support, C1) in clientB's division **before** `START_GAME`:

```typescript
// After ASSIGN_TEMPLATE but before START_GAME:
clientB.send("SET_CELL", { division_id: "div_b", cell_index: 10, unit_type: "flamethrower" });

// GridCellDelta is { cell_index, hp?, suppression?, ... } — NOT a number.
// Filter to deep rows (cell_index 10–19 = R3/R4) and sum HP damage.
const delta: any[] = roundsResolved[0].defender_grid_delta;
const deepRowDamage = delta
  .filter(d => d.cell_index >= 10 && d.cell_index < 20)
  .reduce((s, d) => s + Math.abs(d.hp ?? 0), 0);
assert.ok(deepRowDamage > 0,
  "Flamethrower in R3 must deal HP damage to enemy R3/R4 depth");
```

### Step 9 — Run all assertions → GREEN, commit

```bash
git add game-server/test/6-phase-gate.test.ts game-server/src/rooms/GameRoom.ts
git commit -m "test: specific gate assertions — recon bypass, suppression threshold, XP accumulation, flamethrower depth"
```

---

## Task 3 — Bot Fight Script (live observation tool)

**File:** `game-server/scripts/bot_fight.ts`

A standalone runner that sets up the same gate scenario and prints events so a human can watch
via the Godot client.

```typescript
// game-server/scripts/bot_fight.ts
// Usage: NODE_ENV=development npx ts-node scripts/bot_fight.ts
import { Client } from "@colyseus/sdk";
// Reuse auth helper from test utilities

async function main() {
  // Auth two bot accounts (same helper as e2e tests)
  // botA joins, selects nation A, assigns preset_combined_arms cells
  // botB joins, selects nation B, assigns preset_infantry cells
  // botA starts game
  // Both send SUBMIT_MOVE_ORDER toward each other
  // Print all combat events with [timestamp] prefix to stdout
  // Keep running until COMBAT_ENDED, then process.exit(0)
}
main();
```

### Step 10 — Add npm script to `game-server/package.json`:
```json
"bot-fight": "NODE_ENV=development ts-node scripts/bot_fight.ts"
```

### Step 11 — Run: `npm run bot-fight`

Confirm it prints `COMBAT_STARTED → ROUND_RESOLVED ×N → COMBAT_ENDED` without errors.

### Step 12 — Commit

```bash
git add game-server/scripts/bot_fight.ts game-server/package.json
git commit -m "feat: bot_fight script — two preset divisions auto-fight for live observation"
```

---

## Task 4 — Visual Gate Checklist (manual)

Run `npm run bot-fight` in one terminal, open the Godot client and join the same room as
an observer. Tick each item:

```
[ ] Combat panel opens automatically when COMBAT_STARTED fires
[ ] HP bars on grid cells update after each ROUND_RESOLVED
[ ] Suppression bars visible and increasing across rounds
[ ] EngagementBanner shows correct division pair, dashed dark-ink border
[ ] One division retreats on the strategic map after COMBAT_ENDED
[ ] Panel closes or shows "combat ended" state after COMBAT_ENDED
[ ] XP tier badges (Seasoned/Veteran) appear after a second bot fight (2–3 battles needed)
[ ] Armoured division (preset_combined_arms) in dense_forest province — verify no column
    shift occurs (check via hover attack preview or grid delta column distribution)
```

**Formation bonus note:** `formation_bonuses_active` is always `[]` until perk rules are
added in a future branch. The formation bonus indicator in the **DivisionBuilder UI** (small
icon when AT is placed adjacent to MG) is a separate client-side display — verify it there,
not in the combat panel's ROUND_RESOLVED data.

---

## Gate items verified by earlier branches (not re-tested here)

If these fail during visual walkthrough, treat as regressions in the combat engine, not
Branch M gaps:

- Infantry attacks frontmost occupied row (Branch D)
- Artillery accuracy scales with recon over rounds (Branch E)
- Armoured column shift flanking in plains (Branch E)
- AT gun fallback to infantry targeting when no armour present (Branch E)
- Row perks applying per position (Branch H)
- Research → movement profile recomputed (strategic layer, not Phase 6 scope)

---

## Verification checklist

- [ ] `npm test -- --grep "Phase 6 gate"` → all assertions GREEN (runs as ColyseusTestServer unit test)
- [ ] `npm run bot-fight` → prints COMBAT_STARTED → 3+ ROUND_RESOLVED → COMBAT_ENDED
- [ ] Visual gate checklist above: all items ticked
- [ ] No regressions: `npm test` full suite passes
