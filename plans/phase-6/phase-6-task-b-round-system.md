# Plan B — `feat/tactical-round-system`

## Context

Branch A added the 5×5 grid schema and event payload interfaces. Branch B wires up the **round engine**: combat currently applies damage every game tick (1 tick/s). This branch changes that to once per round (target 20 ticks = 20s), adds the 5-phase lethality escalation ramp, generates `engagement_id` per combat pair, and broadcasts `ROUND_RESOLVED` after each round. Grid deltas in the broadcast will be empty arrays for now — Branches C–F fill them in.

**Must start after Branch A merges.**

**TDD**: write the test file first, confirm all tests are RED, then implement until they go GREEN.

---

## Codebase Context

Key facts about the existing code before touching anything:

- `game-server/src/rooms/GameRoom.ts`: `TICK_MS = 1000` (1 tick/s); `gameTick()` runs on a `clock.setInterval`; calls `combatSystem.tick(state, this.tickCount, broadcast)` each tick.
- `game-server/src/systems/combat_system.ts`: `_resolveCombat()` calls `_applyDamage()` and increments `pair.round` **every single tick** currently. `COMBAT_RESULT` is broadcast every tick. `ActivePair` has a `round` field.
- Damage constants: `BASE_ATTRITION = 2.5`, `HP_DAMAGE_FRACTION = 0.3`, `SUPPRESSION_FRACTION = 0.7`, `TYPE_MULT = { armoured: 1.4, motorised: 1.2, infantry: 1.0 }`.
- `game-server/src/rooms/schema/GameRoomState.ts`: `DivisionState` has `combat_state`, `engaged_with`, `hp`, `suppression`, `grid` (from Branch A).
- `game-server/src/types/tactical_types.ts`: `RoundResolvedPayload` interface already exists (from Branch A). Import from here — do NOT redefine.
- Test pattern: real server boot via HTTP + Colyseus SDK (not `@colyseus/testing`). See `game-server/test/4c-combat.e2e.ts` for `waitForMessage`, `waitForDivisionState`, bot registration pattern.

---

## Files to Create

### 1. `game-server/test/6b-round-system.test.ts` (NEW — write FIRST, must be RED before any implementation)

Copy the server boot pattern (HTTP registration + Colyseus SDK join) and `waitForMessage`/`waitForDivisionState` helpers from `4c-combat.e2e.ts`. Reduce round length to 3 ticks for test speed.

```typescript
import assert from "assert";
import { describe, it, before, after } from "mocha";
import { Client } from "colyseus.js";
import { setRoundTicksForTesting, _isGridLocked } from "../src/systems/combat_system";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState";

// Copy helpers verbatim from 4c-combat.e2e.ts:
//   waitForMessage(room, type, timeoutMs): Promise<unknown>
//   waitForDivisionState(room, predicate, timeoutMs): Promise<any[]>
//   sleep(ms): Promise<void>

const COLYSEUS_URL = process.env.COLYSEUS_URL ?? "ws://localhost:2567";
const API_URL      = process.env.API_URL ?? "http://localhost:3000";

describe("6b — Round System", function () {
  this.timeout(120_000);

  // Set 3 ticks per round so test suite runs in ~30s total instead of 120s
  before(() => setRoundTicksForTesting(3));
  after(()  => setRoundTicksForTesting(20));

  // ── shared combat setup ───────────────────────────────────────────────────
  // Spawn two bot divisions adjacent to each other, wait for COMBAT_STARTED.
  // Use same bot-registration + START_GAME flow as 4c-combat.e2e.ts.
  // Store roomA, roomB, engagedDivAId, engagedDivBId in suite scope.

  it("ROUND_RESOLVED fires after ROUND_TICKS ticks with round_number=1 and lethality_phase='contact'", async () => {
    const msg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.strictEqual(msg.round_number, 1, "first round should be round 1");
    assert.strictEqual(msg.lethality_phase, "contact", "round 1 phase should be contact");
    assert.ok(typeof msg.engagement_id === "string" && msg.engagement_id.length > 0,
      "engagement_id must be a non-empty string");
  });

  it("ROUND_RESOLVED fires a second time with round_number=2 and lethality_phase='firefight'", async () => {
    const msg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.strictEqual(msg.round_number, 2);
    assert.strictEqual(msg.lethality_phase, "firefight");
  });

  it("lethality_phase reaches 'annihilation' at round 5", async () => {
    // wait for rounds 3, 4, 5
    let lastMsg: any;
    for (let i = 0; i < 3; i++) {
      lastMsg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000);
    }
    assert.strictEqual((lastMsg as any).round_number, 5);
    assert.strictEqual((lastMsg as any).lethality_phase, "annihilation");
  });

  it("lethality_phase stays 'annihilation' at round 6", async () => {
    const msg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.strictEqual(msg.round_number, 6);
    assert.strictEqual(msg.lethality_phase, "annihilation",
      "annihilation must not roll over to a new phase");
  });

  it("ROUND_RESOLVED payload has empty attacker_grid_delta and defender_grid_delta", async () => {
    const msg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.ok(Array.isArray(msg.attacker_grid_delta), "attacker_grid_delta must be an array");
    assert.ok(Array.isArray(msg.defender_grid_delta), "defender_grid_delta must be an array");
    assert.strictEqual(msg.attacker_grid_delta.length, 0, "must be empty until Branch C-F");
    assert.strictEqual(msg.defender_grid_delta.length, 0);
  });

  it("ROUND_RESOLVED payload has empty formation_bonuses_active and xp_changes", async () => {
    const msg = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.ok(Array.isArray(msg.formation_bonuses_active));
    assert.ok(Array.isArray(msg.xp_changes));
    assert.strictEqual(msg.formation_bonuses_active.length, 0, "must be empty until Branch I/G");
    assert.strictEqual(msg.xp_changes.length, 0);
  });

  it("same engagement_id appears in consecutive ROUND_RESOLVED events for the same combat", async () => {
    const msg1 = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    const msg2 = await waitForMessage(roomA, "ROUND_RESOLVED", 15_000) as any;
    assert.strictEqual(msg1.engagement_id, msg2.engagement_id,
      "engagement_id must be stable across rounds of the same combat");
  });

  it("_isGridLocked returns true for an engaged division and false for an idle one", async () => {
    // Access live state from the room (Colyseus SDK exposes room.state)
    const state = roomA.state as GameRoomState;
    assert.strictEqual(_isGridLocked(engagedDivAId, state), true);
    assert.strictEqual(_isGridLocked("non-existent-div-id", state), false);
  });
});
```

**Expected before implementation**: all 8 tests RED — `ROUND_RESOLVED` never fires, `setRoundTicksForTesting` does not exist, `_isGridLocked` does not exist.

---

## Files to Modify

### 2. `game-server/src/systems/combat_system.ts`

#### A. New constants — add near top of file with existing constants

```typescript
// ── Round system constants ────────────────────────────────────────────────────
let ROUND_TICKS = 20; // 20s per round at 1 tick/s; mutable for testing

export function setRoundTicksForTesting(n: number): void { ROUND_TICKS = n; }

// Phase index 0 = Round 1 (Contact), index 4 = Round 5+ (Annihilation, clamped)
const LETHALITY_PHASES: ReadonlyArray<{ name: string; multiplier: number }> = [
  { name: "contact",      multiplier: 0.5  },   // Round 1
  { name: "firefight",    multiplier: 0.75 },   // Round 2
  { name: "intense",      multiplier: 1.0  },   // Round 3
  { name: "decisive",     multiplier: 1.5  },   // Round 4
  { name: "annihilation", multiplier: 2.0  },   // Round 5+
];

// Units that bypass the lethality ramp — deal full damage (multiplier=1.0) every round.
// This is a per-cell check; if ANY non-incapacitated cell has one of these types,
// the division bypasses the ramp. Branch C will refine to per-cell calculation.
const FORCE_RECON_UNIT_TYPES = new Set<string>([
  "recon_infantry",
  "commando",
  "sniper",
]);
```

**Note on multiplier values**: the TACTICAL_COMBAT.md explicitly defers exact values to playtesting. These starter values (0.5 → 2.0) are placeholders — change freely without breaking any interface.

#### B. Update `ActivePair` interface — add new fields

Find the `ActivePair` interface (around line 114) and add:

```typescript
interface ActivePair {
  // ... all existing fields unchanged ...
  engagement_id:      string;   // stable ID for this combat instance, generated once on creation
  round_tick_counter: number;   // ticks elapsed since last round resolved; resets each round
  lethality_phase:    string;   // current phase name
  lethality_multiplier: number; // current damage multiplier
}
```

#### C. Update `_detectEngagements()` — assign `engagement_id` on pair creation

Find where a new pair object is pushed into `this.activePairs`. Add the new fields when constructing the pair:

```typescript
// When creating a new ActivePair:
const pair: ActivePair = {
  // ... all existing fields ...
  engagement_id:      `${divAId}_vs_${divBId}_${Date.now()}`,
  round_tick_counter: 0,
  lethality_phase:    LETHALITY_PHASES[0].name,
  lethality_multiplier: LETHALITY_PHASES[0].multiplier,
};
```

`engagement_id` must be generated **once** at pair creation, never regenerated. `Date.now()` provides sufficient uniqueness within a single game session.

#### D. Update `_resolveCombat()` — round-gated damage + ROUND_RESOLVED broadcast

This is the central change. Currently the method applies damage every tick. Change to:

```typescript
private _resolveCombat(
  state: GameRoomState,
  changed: Set<string>,
  broadcast: (type: string, msg: object) => void
): void {
  for (const [key, pair] of this.activePairs) {
    const divA = state.divisions.get(pair.attacker_id);
    const divB = state.divisions.get(pair.defender_id);
    if (!divA || !divB) continue;

    // Gate: only resolve damage at round boundary
    pair.round_tick_counter++;
    if (pair.round_tick_counter < ROUND_TICKS) continue;
    pair.round_tick_counter = 0;

    // Advance round (pair.round starts at 0; broadcast uses 1-indexed)
    pair.round++;
    const roundNumber = pair.round;

    // Advance lethality phase (clamp at last index for round 5+)
    const phaseIndex = Math.min(roundNumber - 1, LETHALITY_PHASES.length - 1);
    pair.lethality_phase    = LETHALITY_PHASES[phaseIndex].name;
    pair.lethality_multiplier = LETHALITY_PHASES[phaseIndex].multiplier;

    // Apply division-level damage (cell-level damage added in Branch C)
    this._applyDamage(divA, divB, pair, state, changed, broadcast);

    // Broadcast ROUND_RESOLVED — grid deltas empty until Branches C–F
    const payload = {
      engagement_id:           pair.engagement_id,
      round_number:            roundNumber,
      lethality_phase:         pair.lethality_phase,
      attacker_grid_delta:     [],
      defender_grid_delta:     [],
      formation_bonuses_active: [],
      xp_changes:              [],
    };
    broadcast("ROUND_RESOLVED", payload);

    changed.add(pair.attacker_id);
    changed.add(pair.defender_id);
  }
}
```

**IMPORTANT — audit for existing per-tick code**: search `_resolveCombat` for any `pair.round++` or `broadcast("COMBAT_RESULT", ...)` calls that currently fire every tick. These must be removed or moved inside the `if (pair.round_tick_counter < ROUND_TICKS) continue` gate. The `COMBAT_RESULT` broadcast can fire alongside `ROUND_RESOLVED` at the round boundary — it still carries aggregate HP info the existing strategic map UI uses.

#### E. Update `_applyDamage()` — apply lethality multiplier

Find where `dmg` is first computed (around line 457):

```typescript
dmg = BASE_ATTRITION * (attacker.hp / 100) * TYPE_MULT[division_type];
```

Immediately after, apply the multiplier — skipping it for divisions with force recon units:

```typescript
if (!this._divisionHasForceReconUnit(attacker, state)) {
  dmg *= pair.lethality_multiplier;
}
```

Add the helper method on the class:

```typescript
private _divisionHasForceReconUnit(div: DivisionState, state: GameRoomState): boolean {
  if (!div.grid) return false;
  return div.grid.cells.some(
    cell => !cell.incapacitated && FORCE_RECON_UNIT_TYPES.has(cell.unit_type)
  );
}
```

**Note on semantics**: Branch B uses a whole-division approximation — if ANY non-incapacitated cell is force recon, the entire division bypasses the ramp. Branch C will refine this to per-cell damage so only the force recon cells bypass; the rest of the division still uses the multiplier.

#### F. Add `_isGridLocked()` — exported for tests and future Branch L

```typescript
export function _isGridLocked(division_id: string, state: GameRoomState): boolean {
  const div = state.divisions.get(division_id);
  if (!div) return false;
  return div.combat_state === "engaged" || div.combat_state === "suppressed";
}
```

### 3. `game-server/src/rooms/GameRoom.ts`

Add import for `_isGridLocked` from combat_system:

```typescript
import { combatSystem, _isGridLocked } from "../systems/combat_system";
```

Inside the test-only `SET_CELL` handler (added in Branch A), add a grid-lock guard at the top:

```typescript
// Inside: if (process.env.NODE_ENV === "test") { this.onMessage("SET_CELL", ...) }
if (_isGridLocked(msg.division_id, this.state)) {
  console.warn(`[test] SET_CELL rejected — division ${msg.division_id} is grid-locked`);
  return;
}
```

Also add import at top of file:

```typescript
import type { RoundResolvedPayload } from "../types/tactical_types";
```

(Used for type safety if you type the broadcast payload explicitly.)

---

## Verification Gate

```bash
cd game-server && npx mocha --require tsx/cjs test/6b-round-system.test.ts
```

All 8 tests must pass. Then:

1. `npx tsc --noEmit` — zero TypeScript errors.
2. Run existing tests: `npx mocha --require tsx/cjs test/4c-combat.e2e.ts` — must still pass (suppression still builds, retreat still triggers, `COMBAT_RESULT` still fires).
3. Manual smoke test: start server, run two bot clients into combat, watch console — `ROUND_RESOLVED` should appear every ~20 seconds with incrementing `round_number` and correctly advancing `lethality_phase` through contact → firefight → intense → decisive → annihilation (stays there).

---

## Common Errors to Avoid

1. **`pair.round` off-by-one**: the existing code initialises `pair.round = 0` and historically incremented after each damage tick. In Branch B, increment `pair.round` at the round boundary **before** reading it for the broadcast, so the first broadcast shows `round_number: 1`.

2. **`COMBAT_RESULT` still fires every tick**: if the existing `broadcast("COMBAT_RESULT", ...)` lives inside `_resolveCombat()` and currently fires every tick, it must move inside the round-boundary gate. Grep for `COMBAT_RESULT` in the file to find all call sites.

3. **`ROUND_TICKS` captured as `const` at module load**: must be `let` so `setRoundTicksForTesting()` can mutate it at runtime. If you see it defined as `const ROUND_TICKS = 20`, change to `let ROUND_TICKS = 20`.

4. **`setRoundTicksForTesting` called after server boot**: the test `before()` hook sets it before calling `boot(appConfig)`. If the round tick value is read at construction time rather than at runtime, the override won't take effect. Verify `ROUND_TICKS` is read inside `_resolveCombat()` at call time, not captured in a closure at boot.

5. **`engagement_id` regenerated on every tick**: only set it once — when the `ActivePair` is first constructed in `_detectEngagements()`. If it's set inside `_resolveCombat()` it will change every round and the stability test will fail.

6. **Force recon check on empty grid cells**: `FORCE_RECON_UNIT_TYPES.has("")` returns false (empty string is not in the set), so cells with no unit placed won't incorrectly trigger the bypass. Still guard with `if (!div.grid) return false` in case a division has no grid yet.

7. **Circular import**: `combat_system.ts` imports from `tactical_types.ts` — this direction is fine. `tactical_types.ts` must NOT import from `combat_system.ts`. If you add the `RoundResolvedPayload` import to `combat_system.ts`, check it's already in `tactical_types.ts` (it is, from Branch A).
