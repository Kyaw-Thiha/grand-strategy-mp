# E2E Rewrite Report — germany_div_05 removal follow-up

## Context

`germany_div_05` was removed from `src/data/maps/western_europe_6/starting_positions.ts`
because it was a data bug (spawned inside French sovereign territory). All 10 files below
referenced it. Since no valid German-owned coordinate exists near Metz that would still
trigger auto-engagement, each file now spawns its own throwaway test divisions via the
test-only `SPAWN_DIVISION` client message (registered only when the game-server process has
`NODE_ENV=test` set — see `src/rooms/GameRoom.ts` line 565), following the pattern already
used by `test/6b-round-system.test.ts`.

**Strategy used for every combat-adjacent file**: spawn custom-ID germany/france divisions at
the *exact same coordinates* the old default-roster pair used — Sarreguemines (6.500, 49.190)
for the German division and Metz (6.175, 49.123) for the French division. This preserves every
distance-dependent assertion in these tests (the ~37 km engagement distance, the ~4.4 km
proximity of waypoint `wp_070996`, the ~670 km distance to `wp_079006`/Berlin) without relying
on a legally-owned starting position, since `SPAWN_DIVISION` skips territory validation.

## Per-file changes

### 1. `test/4c-combat.e2e.ts` (16 refs)
Rewrote header comment to describe the new SPAWN_DIVISION-based scenario. Introduced
`DE_DIV`/`FR_DIV` constants ("e2e-4c-de-front"/"e2e-4c-fr-front") at the Sarreguemines/Metz
coordinates. After `GAME_STARTED`/`DIVISIONS_SPAWNED`, the test now sends two `SPAWN_DIVISION`
messages and sleeps 300ms before proceeding. Replaced the old logic that pulled positions out
of the `DIVISIONS_SPAWNED` payload (since we now know the coordinates directly) with a
hard-coded distance sanity check. All subsequent `germany_div_05`/`france_div_05` string
literals replaced with `DE_DIV`/`FR_DIV`.

### 2. `test/4d-encirclement.e2e.ts` (6 refs)
Only the `VICTIM_DIV` constant (`germany_div_05`) needed replacing — it's teleported deep into
France anyway, so exact starting coordinates don't matter for the scenario logic. Replaced with
`e2e-4d-victim`, spawned via `SPAWN_DIVISION` near `we6_germany_01` city (8.684450, 50.063147,
matching `germany_div_01`'s real starting position) before being `DEV_TELEPORT`ed to the deep-
France coordinates as before.
**Judgment call**: left the 8-division encirclement ring (`france_div_01`..`08`) and the stack
test pair (`germany_div_01`/`02`) completely untouched — these still exist in the default
roster (only `germany_div_05` was removed) and the test already teleports them elsewhere via
`DEV_TELEPORT`, so no ownership issue exists for them.

### 3. `test/4c-retreat-distance.e2e.ts` (6 refs)
Same pattern as file 1: `DE_DIV`/`FR_DIV` ("e2e-rd-de-front"/"e2e-rd-fr-front") spawned at
Sarreguemines/Metz coordinates via `SPAWN_DIVISION` right after `DIVISIONS_SPAWNED`. All
subsequent references (trackers, retreat-state predicates) updated to use the constants.

### 4. `test/debug-combat.ts` (1 ref)
This is a manual debug script (not an automated assertion suite — just logs messages for
20s). Minimal fix: declared local `DE_DIV`/`FR_DIV` constants and added `SPAWN_DIVISION` sends
for both after `START_GAME`, and updated the `DIVISION_UPDATES` filter to match the new IDs.

### 5. `test/4e-combat-cleanup.e2e.ts` (3 refs)
Same pattern as file 1: `DE_DIV`/`FR_DIV` ("e2e-4e-cleanup-de-front"/"...-fr-front") spawned
after `DIVISIONS_SPAWNED`, before the pre-registered `COMBAT_STARTED` listener resolves.

### 6. `test/4f-territory-movement.e2e.ts` (4 refs)
Only Test D ("Enemy territory allowed, at war") used `germany_div_05`; Tests A/B/C use
`germany_div_01`, which is untouched (still a valid default division) and left alone. Added a
`DE_TEST_DIV` ("e2e-4f-de-test") spawned via `SPAWN_DIVISION` near `germany_div_01`'s
coordinates (8.70, 50.05) inside actual German territory — it doesn't need to be near
`france_div_05` at all since this test only checks a `SUBMIT_MOVE_ORDER` rejection reason based
on nation war-status, not proximity/engagement.

### 7. `test/4d-meeting-battle.e2e.ts` (12 refs)
Same pattern as file 1: `DE_DIV`/`FR_DIV` ("e2e-4d-meeting-de-front"/"...-fr-front") spawned via
`SPAWN_DIVISION` after `DIVISIONS_SPAWNED`, then both immediately given parallel `MOVE` orders
toward Berlin (`wp_079006`) exactly as before, to force `is_meeting_battle === true`.

### 8. `test/4c-combat-state-machine.e2e.ts` (14 refs)
Same pattern as file 1, but this file has 3 independent tests (A/B/C) each calling a shared
`setupGame()` helper that creates its own room. `DE_DIV`/`FR_DIV` ("e2e-sm-de-front"/"...-fr-
front") are spawned inside `setupGame()` itself (once per test invocation, in a fresh room each
time, so no ID collision risk). All string literals and log messages updated.

### 9. `test/4g-reposition.e2e.ts` (18 refs)
Same pattern as file 1: `DE_DIV`/`FR_DIV` ("e2e-4g-de-front"/"...-fr-front") spawned via
`SPAWN_DIVISION` at Sarreguemines/Metz coordinates right after `DIVISIONS_SPAWNED`, preserving
the ~4.4 km proximity of `wp_070996` used in Test A's reposition target and the ~670 km
distance to `wp_079006` used in Test D.
**Judgment call**: `germany_div_01` (used in Tests C and E, unrelated to the front-line pair) is
untouched — it's still a valid default-roster division with no territory issue.

### 10. `test/4e-frontline.e2e.ts` (1 ref)
`TELEPORT_DIV` (`germany_div_05`) replaced with `e2e-4e-teleport-div`, spawned via
`SPAWN_DIVISION` near `we6_germany_01` city (8.684450, 50.063147) so it contributes to the
baseline germany-influence assertions (steps 5-7) exactly as the old division would have,
before being `DEV_TELEPORT`ed deep into France in step 8.

## Files where `france_div_05` was intentionally kept as-is

- `test/4d-encirclement.e2e.ts` line ~61: `france_div_05` is one of 8 default-roster French
  divisions (`france_div_01`..`08`) forming the encirclement ring — untouched because it still
  exists in `starting_positions.ts` and this file already teleports it elsewhere.

## Type-check results

Ran `npx tsc --noEmit -p .` from `game-server/`. The full project has a number of **pre-
existing** type errors unrelated to this change (Colyseus SDK type mismatches in
`GameRoom.test.ts`, `subprovince-capture.test.ts`, `subprovince-city-cascade.test.ts`,
`subprovince-loader.test.ts`, `subprovince-spatial-index.test.ts`,
`subprovince-supply-graph.test.ts`, `6j-terrain-modifiers.test.ts`, `auth-handshake.e2e.ts`,
`subprovince-loader-parity.test.ts`, `subprovince-retreat.test.ts`).

**None of the 10 rewritten files produced any type errors** — confirmed by filtering the tsc
output for each filename; zero matches.

## E2E files actually executed

None. These are `.e2e.ts` files requiring live Hono + Colyseus servers with `DEV_MODE=true`
AND `NODE_ENV=test` (the latter is required for the `SPAWN_DIVISION` handler to be registered
at all — see `src/rooms/GameRoom.ts` line 565: `if (process.env.NODE_ENV === "test")`). I did
not start these servers and did not run any of the 10 files live. All verification was done via
careful reading and comparison against the working `test/6b-round-system.test.ts` pattern, plus
the type-check above.

**Important operational note**: the existing helper scripts (`scripts/e2e-session-loop.sh`) run
`game-server`'s `npm start` without `NODE_ENV=test`, so `SPAWN_DIVISION` would NOT be registered
under that script as-is. To actually run any of these 10 rewritten files, the game-server must
be started with `NODE_ENV=test npm start` (or equivalent), not the current `npm start`. I have
not modified that script since it was outside the assigned scope (only the 10 test files listed
were in scope), but this is worth flagging to whoever runs these tests.

## Concerns

1. The `NODE_ENV=test` requirement above is the main open item — every rewritten file's header
   comment now documents the requirement, but no start script currently sets it for these e2e
   runs (only mocha's `test:*` npm scripts do).
2. All spawn/sleep timing (300ms after `SPAWN_DIVISION`) is a reasonable guess mirroring the
   `await room.waitForNextPatch()` used in the mocha test, but since these `.e2e.ts` files talk
   to a real Colyseus server over a real websocket (no direct room access), there's no
   equivalent "wait for patch" primitive — if 300ms proves too short in practice (e.g. under
   load), it may need bumping up. I have not been able to verify this live.
3. `test/4d-encirclement.e2e.ts`'s victim division is now spawned via `SPAWN_DIVISION` right
   before being `DEV_TELEPORT`ed — this adds one extra round trip but should be functionally
   equivalent to the old flow (division existed in default roster, then got teleported).
