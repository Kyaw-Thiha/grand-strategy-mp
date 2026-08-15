# Branch K-ui — `feat/air-client-ui`

## Context

Branches A, K-stubs, B, B-patch, C, D, E, E-patch, F, G, H, J are merged. Branch I
(`feat/air-fleet-command`) stays deferred — nothing in this branch depends on it, and the
Air Fleet panel originally listed under K-ui is dropped from scope entirely.

K-ui was originally scoped as "pure UI panels — no map rendering logic." Codebase research
during planning found that several pieces of what the player needs are simply not implemented
server-side yet (escort auto-assignment, an IDLE mission, perk-gated mission eligibility for
non-standard loadouts). Per user decision, all of this is folded into K-ui rather than split
into a separate prerequisite branch — this branch is no longer purely client-only.

**Test-Driven Development is mandatory for all server changes.** Write failing tests before
each server step.

---

## Critical Pre-Read

### Scope (final, confirmed with user)

1. Military panel → Air sub-tab: wing list grouped by airbase, with a "+" to spawn new wings.
2. Bottom selection panel (`friendly_air_wing_panel.gd`): Retreat button, non-interactive Move
   hint label, filtered mission dropdown, wing size ±10 stepper, escort target display + manual
   picker button.
3. Escort auto-assignment (server, new) + manual override picker (client, new).
4. New `IDLE` mission (server, new) so a wing can be told to just sit at base.
5. Perk-gated mission eligibility, extending existing inert perk-flag pattern (server + client
   filtering; **no player-facing perk toggle UI** — perks stay dev/test-only this branch).
6. Notification toast — new `"air"` type.
7. New-wing spawn flow: pick aircraft type + count (default 10, ±10 stepper), confirm modal,
   spawns at nation capital. **No template system** — `AirWingTemplate`/template store concept
   is dropped entirely (see below).

Explicitly OUT of scope: Air Fleet panel, multi-select UI, province picker for new-wing
placement (defer to when buildings/economy exist), player-facing perk UI, upper cap or
resource cost on wing size.

### `AirWingTemplate` is dead code — do not use it

`game-server/src/rooms/schema/AirWingState.ts:50-53` defines an `AirWingTemplate` Schema class
(`aircraft_type` + `count`), but it is **never instantiated anywhere** — no
`air_wing_templates` MapSchema exists on `GameRoomState`, nothing references this class outside
its own declaration. Ignore it. The new-wing spawn flow (Step 6 below) is a plain
`{aircraft_type, count}` payload on a new `CREATE_WING` message — not a template system.

### `MISSION_TYPES` — 13 server values today, becomes 14 with `IDLE`

`game-server/src/rooms/schema/AirWingState.ts:19-33`:
```ts
export const MISSION_TYPES = {
  TACTICAL_BOMBING:    "tactical_bombing",
  INTERCEPTION:        "interception",
  AIR_SUPERIORITY:     "air_superiority",
  ESCORT:              "escort",
  LOGISTICS:           "logistics",
  AREA:                "area",
  INDUSTRY:            "industry",
  OIL:                 "oil",
  RECON:               "recon",
  TRADE_INTERDICTION:  "trade_interdiction",
  ANTI_SUBMARINE:      "anti_submarine",
  ANTI_SHIP:           "anti_ship",
  PORT_STRIKE:         "port_strike",
} as const;
```
`PORT_STRIKE` is real, not dead — consumed in `air_naval_bomber_system.ts:68` and its damage
constants are used at lines 79-80. Add `IDLE: "idle"` to this object.

**There is currently no way to keep a wing grounded.** `AirWingState.ts:80` defaults new wings'
`mission` to `MISSION_TYPES.INTERCEPTION` (an odd existing default — do not "fix" it, just make
sure `CREATE_WING` explicitly sets `mission = MISSION_TYPES.IDLE` rather than relying on the
schema default). `assignMission()` (`air_wing_lifecycle_system.ts:228-241`) *always* kicks an
`IDLE`/`LOITER` wing into `TRANSIT` the moment any mission is set:
```ts
assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  if (wing.lifecycle_state === WING_LIFECYCLE.ENGAGED) return false;

  wing.mission    = mission;
  wing.target_id  = targetId;
  if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
   || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    this._loiterTicks.delete(wingId);
  }
  return true;
}
```
Add an early-exception: when `mission === MISSION_TYPES.IDLE`, skip the TRANSIT kick (wing
stays `IDLE`/`LOITER` as-is, clears `target_id`).

### Filtered mission-per-aircraft-type table (confirmed with user)

This is what the client dropdown filters by, and roughly what the server should tolerate
(server does not need to hard-reject "wrong" missions this branch — client-side filtering is
the enforcement layer, consistent with how nothing else in `assignMission()` validates mission
legality today).

| Aircraft Type | Always-eligible missions | Perk-gated missions |
|---|---|---|
| FIGHTER | Idle, Air Superiority, Interception, Escort | Tactical Bombing (needs `perk_strafing`) |
| HEAVY_FIGHTER | Idle, Air Superiority, Interception, Escort | Tactical Bombing (needs `perk_strafing`, **new** — extends existing flag to a second type) |
| CAS_PLANE | Idle, Tactical Bombing, Air Superiority, Interception | — |
| DIVE_BOMBER | Idle, Tactical Bombing, Air Superiority, Interception | — |
| TACTICAL_BOMBER | Idle, Tactical Bombing, Area, Industry, Oil, Logistics | — |
| STRATEGIC_BOMBER | Idle, Area, Industry, Oil, Logistics | — |
| NAVAL_BOMBER | Idle, Trade Interdiction, Anti-Submarine, Anti-Ship, Port Strike | — |
| RECON_PLANE | Idle, Recon | — |

**Revised decision (superseding an earlier draft of this plan):** CAS_PLANE/DIVE_BOMBER get
Air Superiority/Interception **by default**, matching the client's existing (already-merged,
Branch H) `_can_intercept()` behavior, which already unconditionally allows them — see below.
The new `perk_air_combat` flag is no longer a mission-eligibility gate; it's purely a combat-
effectiveness multiplier (small base damage, larger with the perk). This avoids touching
`_can_intercept()` at all and keeps client/server mission-eligibility rules consistent with
zero extra reconciliation work.

### Perk mechanism — `setPerk()` is a closed whitelist switch, not free-form

`air_wing_lifecycle_system.ts:311-322`:
```ts
setPerk(wingId: string, perk: string, value: boolean, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  switch (perk) {
    case "multi_sortie":      wing.perk_multi_sortie      = value; return true;
    case "strafing":          wing.perk_strafing          = value; return true;
    case "extended_range":    wing.perk_extended_range    = value; return true;
    case "precision_bombing": wing.perk_precision_bombing = value; return true;
    case "splash":           wing.perk_splash           = value; return true;
    default: return false;
  }
}
```
Adding `perk_air_combat` requires a new `case "air_combat": wing.perk_air_combat = value; return true;` — an unrecognized perk string silently no-ops (`didChange` stays false in the
`SET_WING_PERK` handler, no broadcast). `SET_WING_PERK` (`GameRoom.ts:404-421`) is a real
player-facing handler already, but nothing in the client calls it (confirmed — grep across
`client/src` for perk UI returns nothing). Per user decision this branch does **not** add a
perk toggle UI; both perk fields are reachable only via the dev/test harness, same as
`perk_strafing` was until now. Practically: `perk_air_combat` only affects combat damage
magnitude (not mission eligibility, see revised decision below), so it being unreachable by
players this branch has no dropdown-visible effect — it's just untunable in a live game until a
future research-tree branch adds perk UI. `perk_strafing` on HEAVY_FIGHTER, by contrast, *does*
gate a dropdown row (Tactical Bombing) — that row is mechanically correct but practically
unreachable by players until then, same situation `perk_strafing` was already in for FIGHTER
before this branch. Neither is a bug to fix here.

`perk_strafing` is already consumed at `air_attack_pattern_registry.ts:139`
(`if (!ctx.perk_strafing) return { hit_cells: [], pattern_type: "fighter_strafe",
total_hp_damage: 0 };`) and passed into pattern context from `air_bombing_system.ts:89,174`. No
code change needed there for HEAVY_FIGHTER — that pattern function keys off `ctx.perk_strafing`
being true, aircraft-type-agnostic, so simply allowing `HEAVY_FIGHTER` wings to carry
`perk_strafing = true` (already possible via `setPerk`, no code change) makes the existing
pattern function work for them automatically. Only the **mission dropdown filter** needs to
know to show Tactical Bombing to HEAVY_FIGHTER when it has the perk — no server pattern-registry
change needed for that part.

### CAS/DIVE bomber air-to-air is functional by default; perk only boosts it

`air_unit_stats.ts` currently gives `cas_plane`/`dive_bomber` `attack_vs_air: 0.0`. Combat
resolution in `air_combat_system.ts`'s `_resolveOneSide()` (lines 122-153) reads this directly:
```ts
const stats = getAirUnitStats(attacker.aircraft_type);
let baseValue = attacker.weapon_ready ? stats.attack_vs_air : stats.defense_vs_air;
if (isSurprise && attacker.weapon_ready && stats.attack_vs_air > 0) {
  baseValue = stats.attack_vs_air * SURPRISE_MULTIPLIER;
}
...
if (attacker.weapon_ready && stats.attack_vs_air > 0 && target.count > 0) { ... }  // tank-hit trigger
if (stats.attack_vs_air > 0) { ... }                                              // readiness spike
```
**Revised decision:** rather than gating CAS/DIVE air-to-air capability entirely behind a perk,
give both types a small non-zero **base** `attack_vs_air` (they can already select Air
Superiority/Interception missions and already pass the client's existing `_can_intercept()`
gate unconditionally — see below — so making the base stat non-zero just makes that existing
capability actually do something). `perk_air_combat` becomes a pure effectiveness multiplier —
a higher `attack_vs_air_perked` value used when the flag is set — not an eligibility gate. Both
the base and perked values are explicit placeholders for a later balance pass. See Step 1c.

This also means **no client-side capability-gate change is needed**: `_can_intercept()`
(`client/src/systems/air/air_wing_system.gd:678-681`, from the already-merged Branch H) already
unconditionally allows `cas_plane`/`dive_bomber` right-click intercept:
```gdscript
func _can_intercept(aircraft_type: String) -> bool:
	return aircraft_type in ["fighter", "heavy_fighter", "cas_plane", "dive_bomber"]
```
Leave this function untouched — it was already correct in spirit, just waiting on a non-zero
base stat to make the interaction meaningful. This keeps the branch's server and client rules
in agreement without any client capability-gate edit.

### `serializeWing()` is missing `perk_splash` — fix while touching this function

`AirWingState.ts:167-198` (`serializeWing`) sends `perk_multi_sortie`, `perk_strafing`,
`perk_extended_range`, `perk_precision_bombing` to clients but **not** `perk_splash`, even
though the schema field exists (line 119) and `setPerk()` can set it (line 319). This branch
adds `perk_air_combat` to the same serialize block — include the pre-existing missing
`perk_splash` field in the same edit (one line, trivial, directly adjacent).

### Escort auto-assignment does not exist anywhere — confirmed via full-codebase search

`assignMission()` just does `wing.target_id = targetId` verbatim from whatever the caller
supplies — no priority logic, no load-balancing, anywhere in `game-server/src`. Design source:
`docs/AIR_COMBAT.md:628-633` ("Command Layer — Air Fleets" escort spread logic — applied
here **per-wing**, not as a fleet-batch operation, since Branch I/fleets stay deferred):
```
Heavy fighters → strategic/tactical bombers first; fall back to CAS/dive/naval if none
Fighters → CAS/dive/naval bombers first; fall back to strategic/tactical if none
Spread round-robin within each class so no bomber is double-covered while another is open
Excess heavy fighters (no bomber to escort) → keep current mission
Excess fighters (no bomber to escort) → AIR_SUPERIORITY
```
Confirmed decisions with user:
- Candidate pool: **airborne bombers only** (not `idle`/`refuel` — a bomber mid-sortie).
- On the escorted bomber's destruction (`disbandWing()`), the orphaned escort **re-runs
  auto-assignment** to find a new bomber (not self-RTB) — `disbandWing()`
  (`air_wing_lifecycle_system.ts:287-309`) currently does not scan for wings whose `target_id`
  points at the wing being deleted; this is a real dangling-reference bug independent of the
  new feature, fixed as part of the same change.
- No manual-vs-auto stickiness tracked anywhere — a manually-picked escort pairing is not
  "sticky"; once that bomber RTBs or is destroyed, the next assignment (auto or a fresh manual
  pick) just happens like any other pairing change.

### Client wiring facts (confirmed, exact)

- `GameState.get_air_wings_for_nation(nation_id) -> Array` exists
  (`client/src/core/game_state.gd:294-299`) — no province/airbase grouping exists; group
  client-side.
- `CommandQueue.submit(type: String, payload: Dictionary) -> void`
  (`client/src/core/command_queue.gd:12-21`) is the only conduit — validates auth/connection,
  calls `NetManager.send_command`.
- `friendly_air_wing_panel.gd`/`.tscn` today is **fully read-only** — labels only
  (`IdentityBlock`, `StatusBlock`, `ReadinessBlock`, `TargetBlock`), **no `ActionsBlock`, no
  buttons at all**. Compare to `friendly_division_panel.gd/.tscn`, which has
  `Margin/HBox/ActionsBlock/Row1/BtnMove`, `Row2/BtnRetreat`, `Row2/BtnCancel`,
  `Row3/BtnReposition`, wired via a disconnect-then-reconnect `_rewire_buttons(div_id)` pattern
  (lines 142-176) called from `populate()`. This is the exact pattern to copy for the air panel.
- `EventBus.air_wing_selected(wing_id)` (line 87) is already emitted by `air_wing_system.gd` on
  left-click-select and already consumed by `game_hud.gd:656` (`_on_air_wing_selected`), which
  populates `friendly_air_wing_panel` and shows it. **Do not invent a new selection signal for
  the Military panel Air tab list** — clicking a list row should emit this same signal.
- **Pre-existing gap, not this branch's problem:** `game_hud.gd:656-665`'s
  `_on_air_wing_selected` does not check nation ownership the way `_on_division_selected` does
  (no enemy-wing branch) — it always populates the *friendly* panel regardless of whose wing
  was clicked. Do not fix this as part of K-ui (out of scope), but do not build anything in this
  branch that assumes enemy-wing selection is handled correctly either.
- Military panel Air tab (`military_panel.tscn`, `TabBar/Air`) currently has **no
  `Scroll/ListContainer`** — just `HeaderAir/HBoxAir/{AccentBarAir,TitleAir}` +
  `PlaceholderAir` (a lone centered Label). The Land tab's working pattern is
  `Header/HBox/{AccentBar,Title}` + `Scroll/ListContainer` (note: Land's inner node names have
  **no suffix**, Air's have an `Air` suffix — this is a pre-existing naming inconsistency in the
  scene tree; when adding the Air list, follow whichever naming the `.tscn` file already uses
  for that branch's nodes, do not rename existing Land nodes).
- `military_panel.gd`'s disabled block (lines 179-247, `_refresh_land_list()`/
  `_make_division_item()`) is dead code marked `DISABLED` — it groups by `stack_id`, not
  applicable to air wings, but its list-building shape (clear container → iterate → build a
  `Button` per item → connect `pressed`) is the pattern to mirror for `_refresh_air_list()`.
  Wings group by `home_airbase_province_id` instead of `stack_id`.
- `notification_feed.gd`'s `_get_type_color()` (391-404) and `_get_type_title()` (411-424) are
  `match` statements over `notification_type`; unmatched strings (including today's `"info"`)
  fall through to the default case (`"NOTICE"`, amber `Color(0.96, 0.78, 0.38, 1.0)`). Add an
  `"air"` case to both.
- `session_manager.gd:130-186` is the exact and only place server broadcasts turn into
  `EventBus`/notification calls for air. Exact current behavior per event (verified verbatim):
  - `AIR_WING_STAGING` (152-156) → `notification_requested.emit(..., "info")`
  - `AIR_WING_DESTROYED` (158-159) → **only** `GameState._apply_air_wing_destroyed(data)` — no
    toast today
  - `AIR_COMBAT_STARTED` (167-168) → **only** `EventBus.air_combat_started.emit(data)` (drives
    the map banner) — no toast today
  - `AIR_WING_RTB_QUEUED` (171-173) → `"info"`
  - `AIR_WING_MOVE_REJECTED` (174-176) → `"warning"` (stays `"warning"`, confirmed — it's a
    rejection, not an ops update)
  - `AIR_SUPERIORITY_LOST`/`AIR_WING_DRIVEN_OFF` interfaces exist in `AirWingState.ts` but are
    **never broadcast anywhere server-side** — do not wire these, they don't fire.
- `project.godot` autoloads are declared `Name="*res://path/to/script.gd"` — a new
  `AirWingTypeStore` autoload follows `DivisionTemplateStore="*res://src/core/division_template_store.gd"`'s exact pattern.
- Icon asset: only `res://assets/icons/jet-fighter-up-solid-full.svg` exists for air (already
  used by `air_combat_banner.gd`, `air_combat_detail_panel.gd`,
  `strategic_bombing_detail_panel.gd`, `bombing_run_indicator.gd`). **No per-mission icon set
  exists.** Confirmed decision: mission dropdown is **text-only**, no icons, for this branch.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/test/12k-escort-auto-assign.test.ts` | Escort auto-assign, orphan reassignment, IDLE mission, perk_air_combat damage tests |
| `game-server/test/12k-wing-management.test.ts` | `CREATE_WING`, `ADJUST_WING_SIZE` tests |
| `client/src/core/air_wing_constants.gd` | `MISSION_TYPES` (14 values) + per-type eligibility map, mirroring server exactly |
| `client/src/core/air_wing_type_store.gd` | New autoload — static list of spawnable aircraft types (name/type only, no persistence, no template concept) |
| `client/src/ui/hud/air_wing_escort_picker_panel.gd` + matching `.tscn` | Manual escort-target picker (card list of friendly airborne bombers) |
| `client/src/ui/hud/air_wing_spawn_panel.gd` + matching `.tscn` | New-wing confirm modal (type picker + count stepper) |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/AirWingState.ts` | Add `IDLE` to `MISSION_TYPES`; add `perk_air_combat` field; fix `serializeWing()` to include `perk_air_combat` and the pre-existing missing `perk_splash` |
| `game-server/src/data/air_unit_stats.ts` | Add optional `attack_vs_air_perked?: number` to interface; set placeholder value for `cas_plane`/`dive_bomber` |
| `game-server/src/systems/air_wing_lifecycle_system.ts` | `assignMission()` IDLE early-exit; `setPerk()` new `"air_combat"` case; new `autoAssignEscort()`; `disbandWing()` orphan-escort reassignment |
| `game-server/src/systems/air_combat_system.ts` | `_resolveOneSide()` reads perk-aware effective `attack_vs_air` |
| `game-server/src/rooms/GameRoom.ts` | `ASSIGN_WING_MISSION` ESCORT-with-empty-target_id → call `autoAssignEscort()`; new `ADJUST_WING_SIZE` handler; new `CREATE_WING` handler |
| `game-server/test-lanes.json` | Add the two new test files to the `air-combat` lane's `tests` array |
| `client/project.godot` | Register `AirWingTypeStore` autoload |
| `client/src/ui/hud/friendly_air_wing_panel.gd` + `.tscn` | Add `ActionsBlock` (Move hint label, Retreat button), mission dropdown (filtered), size ±10 stepper, escort target row + "Pick Target" button |
| `client/src/core/event_bus.gd` | Add `air_wing_escort_picker_open_requested(wing_id)`, `air_wing_spawn_open_requested(province_id)` signals |
| `client/src/ui/hud/military_panel.gd` + `.tscn` | Add `Scroll/ListContainer` under `Air` tab + `_refresh_air_list()`/`_make_air_wing_item()`; "+" button in Air tab header |
| `client/src/ui/hud/game_hud.gd` | Instantiate/wire the two new panels (escort picker, spawn modal), mirroring existing panel wiring |
| `client/src/ui/hud/notification_feed.gd` | Add `"air"` case to `_get_type_color()`/`_get_type_title()` |
| `client/src/systems/session/session_manager.gd` | Rewire `AIR_WING_STAGING`/`AIR_WING_RTB_QUEUED` from `"info"`→`"air"`; add toasts for `AIR_WING_DESTROYED`/`AIR_COMBAT_STARTED` |

---

## Step 1: Server — Schema, Constants, IDLE Mission, Perk Mechanism

### 1a. Write failing tests first

Create `game-server/test/12k-escort-auto-assign.test.ts` (use `getTestPort()` per
`test/12b-air-wing-lifecycle.test.ts`'s pattern; prefix every `describe` with
`"lane:air-combat | 12k — ..."`). Cover, at minimum:
- `MISSION_TYPES.IDLE === "idle"` exists.
- Assigning `IDLE` mission to an `IDLE`-lifecycle wing does NOT transition it to `TRANSIT`.
- Assigning `IDLE` mission to a `LOITER`-lifecycle wing does NOT transition it to `TRANSIT`
  (stays `LOITER` or moves to `IDLE` — pick one and assert it; recommend staying `LOITER` since
  the wing is still airborne and this branch doesn't add new RTB-on-idle behavior).
- `setPerk(wingId, "air_combat", true, state)` sets `wing.perk_air_combat = true` and returns
  `true`.
- `serializeWing()` output includes `perk_air_combat` and `perk_splash`.

### 1b. `AirWingState.ts` changes

```ts
export const MISSION_TYPES = {
  IDLE:                 "idle",
  TACTICAL_BOMBING:    "tactical_bombing",
  INTERCEPTION:        "interception",
  AIR_SUPERIORITY:     "air_superiority",
  ESCORT:              "escort",
  LOGISTICS:           "logistics",
  AREA:                "area",
  INDUSTRY:            "industry",
  OIL:                 "oil",
  RECON:               "recon",
  TRADE_INTERDICTION:  "trade_interdiction",
  ANTI_SUBMARINE:      "anti_submarine",
  ANTI_SHIP:           "anti_ship",
  PORT_STRIKE:         "port_strike",
} as const;
```

Add alongside the existing perk fields (after line 119):
```ts
  @type("boolean") perk_air_combat: boolean = false;
```

In `serializeWing()` (lines 193-196 today), add both missing fields:
```ts
    perk_precision_bombing:   wing.perk_precision_bombing,
    perk_splash:              wing.perk_splash,
    perk_air_combat:          wing.perk_air_combat,
  };
```

### 1c. `air_unit_stats.ts` changes

```ts
export interface AirUnitStats {
  attack_vs_air:        number;
  defense_vs_air:       number;
  observation_deg:      number;
  min_turn_radius_deg:  number;
  attack_vs_air_perked?: number;  // used only when wing.perk_air_combat is true
}

const STAT_TABLE: Record<string, AirUnitStats> = {
  fighter:          { attack_vs_air: 0.25, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.30 },
  heavy_fighter:    { attack_vs_air: 0.22, defense_vs_air: 0.05, observation_deg: 0.25, min_turn_radius_deg: 0.50 },
  cas_plane:        { attack_vs_air: 0.05, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.30, attack_vs_air_perked: 0.15 },  // PLACEHOLDER base + perk-boosted values — real perk-balance pass TBD
  dive_bomber:      { attack_vs_air: 0.05, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.40, attack_vs_air_perked: 0.15 },  // PLACEHOLDER base + perk-boosted values — real perk-balance pass TBD
  tactical_bomber:  { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.50 },
  strategic_bomber: { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.65 },
  naval_bomber:     { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.40 },
  recon_plane:      { attack_vs_air: 0.0,  defense_vs_air: 0.01, observation_deg: 1.0,  min_turn_radius_deg: 0.30 },
};
```
Do not add `attack_vs_air_perked` to any other type — only CAS_PLANE/DIVE_BOMBER need it per
the confirmed design.

### 1d. `air_wing_lifecycle_system.ts` — `assignMission()` IDLE exception

```ts
assignMission(wingId: string, mission: string, targetId: string, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  if (wing.lifecycle_state === WING_LIFECYCLE.ENGAGED) return false;

  wing.mission    = mission;
  wing.target_id  = targetId;
  if (mission === MISSION_TYPES.IDLE) {
    return true;  // stay grounded/loitering — do not force TRANSIT
  }
  if (wing.lifecycle_state === WING_LIFECYCLE.IDLE
   || wing.lifecycle_state === WING_LIFECYCLE.LOITER) {
    wing.lifecycle_state = WING_LIFECYCLE.TRANSIT;
    this._loiterTicks.delete(wingId);
  }
  return true;
}
```
`MISSION_TYPES` is already imported in this file (line 2) — no new import needed.

### 1e. `air_wing_lifecycle_system.ts` — `setPerk()` new case

```ts
setPerk(wingId: string, perk: string, value: boolean, state: GameRoomState): boolean {
  const wing = state.air_wings.get(wingId);
  if (!wing) return false;
  switch (perk) {
    case "multi_sortie":      wing.perk_multi_sortie      = value; return true;
    case "strafing":          wing.perk_strafing          = value; return true;
    case "extended_range":    wing.perk_extended_range    = value; return true;
    case "precision_bombing": wing.perk_precision_bombing = value; return true;
    case "splash":            wing.perk_splash             = value; return true;
    case "air_combat":        wing.perk_air_combat         = value; return true;
    default: return false;
  }
}
```
(Also fixes the pre-existing misaligned whitespace on the `"splash"` line while touching it —
cosmetic only, do not let it distract from the functional change.)

### 1f. `air_combat_system.ts` — perk-aware effective attack value

In `_resolveOneSide()` (lines 122-153), every use of `stats.attack_vs_air` must become
perk-aware. Replace:
```ts
const stats = getAirUnitStats(attacker.aircraft_type);
let baseValue = attacker.weapon_ready ? stats.attack_vs_air : stats.defense_vs_air;
if (isSurprise && attacker.weapon_ready && stats.attack_vs_air > 0) {
  baseValue = stats.attack_vs_air * SURPRISE_MULTIPLIER;
}
```
with:
```ts
const stats = getAirUnitStats(attacker.aircraft_type);
const effectiveAttackVsAir = (attacker.perk_air_combat && stats.attack_vs_air_perked !== undefined)
  ? stats.attack_vs_air_perked
  : stats.attack_vs_air;
let baseValue = attacker.weapon_ready ? effectiveAttackVsAir : stats.defense_vs_air;
if (isSurprise && attacker.weapon_ready && effectiveAttackVsAir > 0) {
  baseValue = effectiveAttackVsAir * SURPRISE_MULTIPLIER;
}
```
And replace the two other `stats.attack_vs_air` reads later in the same function (lines 140 and
145 in current numbering) with `effectiveAttackVsAir`:
```ts
    if (attacker.weapon_ready && effectiveAttackVsAir > 0 && target.count > 0) {
      target.status_fuel = +(target.status_fuel * 1.5).toFixed(4);
      lifecycleSystem.applyLandingDecay(attacker.wing_id, state);
    }

    if (effectiveAttackVsAir > 0) {
      attacker.combat_readiness = Math.max(0, attacker.combat_readiness - READINESS_COMBAT_SPIKE_AIR);
      target.combat_readiness   = Math.max(0, target.combat_readiness   - READINESS_COMBAT_SPIKE_AIR);
    }
```
Do not touch `defense_vs_air` reads — only `attack_vs_air` needs the perk substitution.

### 1g. Tests for 1d-1f

Append to `12k-escort-auto-assign.test.ts`:
- CAS_PLANE without `perk_air_combat`, `weapon_ready = true`, attacks an enemy fighter → target
  takes damage > 0, derived from the base `attack_vs_air = 0.05` (not zero — this is the
  behavior change from the previous draft of this plan).
- CAS_PLANE with `perk_air_combat = true`, `weapon_ready = true` → target takes MORE damage than
  the unperked case (derived from `attack_vs_air_perked = 0.15` vs. base `0.05`).
- DIVE_BOMBER, same two cases.
- FIGHTER (no perk field involved) — unaffected, damage calc identical to before this change
  (regression guard).

Run: `cd game-server && npm test` (lane-scoped) — must fail before 1b-1f, pass after.

---

## Step 2: Server — Escort Auto-Assignment + Orphan Reassignment

### 2a. Write failing tests first (append to `12k-escort-auto-assign.test.ts`)

- Heavy fighter set to ESCORT with empty `target_id`, one airborne `strategic_bomber` and one
  airborne `cas_plane` both present → pairs with the strategic bomber (not the CAS plane).
- Heavy fighter, no strategic/tactical bomber airborne, one airborne `cas_plane` present →
  falls back to pairing with the CAS plane.
- Fighter set to ESCORT, one airborne `cas_plane` and one airborne `strategic_bomber` present →
  pairs with the CAS plane (not the strategic bomber) — opposite priority from heavy fighter.
- Round-robin: 2 airborne `tactical_bomber`s, 3 fighters set to ESCORT in sequence → first two
  fighters pair with the two different bombers; third fighter also pairs with one of them
  (double-cover), not left unassigned.
- No eligible bomber airborne at all: heavy fighter set to ESCORT → mission stays `ESCORT`,
  `target_id` stays empty (heavy fighter "keeps current mission" — since ESCORT IS its current
  mission being newly set, this means it simply gets no target and remains on ESCORT, consistent
  with "keep current mission" when read as "don't force a different mission").
- No eligible bomber airborne: fighter set to ESCORT → mission becomes `AIR_SUPERIORITY`,
  `target_id` empty.
- Only `idle`/`refuel` bombers exist (not airborne) → treated as if no bomber exists (airborne-
  only candidate pool, confirmed decision).
- Orphan reassignment: escort A paired with bomber B (via auto-assign); a second eligible
  bomber C is airborne; `disbandWing(B)` is called → escort A's `target_id` becomes C's wing id
  (re-ran auto-assignment, found replacement).
- Orphan reassignment, no replacement available: escort A paired with bomber B; no other
  eligible bomber airborne; `disbandWing(B)` called → escort A falls into the same "no eligible
  bomber" branch as above (mission-dependent: heavy fighter keeps ESCORT with empty target;
  fighter becomes AIR_SUPERIORITY).
- Dangling reference regression guard: after `disbandWing(B)`, no wing anywhere in
  `state.air_wings` has `target_id === B`'s old wing id.

### 2b. `autoAssignEscort()` — new method on `AirWingLifecycleSystem`

Add to `air_wing_lifecycle_system.ts`, near `assignMission()`:
```ts
private static readonly HEAVY_FIGHTER_PRIMARY = new Set(["strategic_bomber", "tactical_bomber"]);
private static readonly HEAVY_FIGHTER_FALLBACK = new Set(["cas_plane", "dive_bomber", "naval_bomber"]);
private static readonly FIGHTER_PRIMARY = new Set(["cas_plane", "dive_bomber", "naval_bomber"]);
private static readonly FIGHTER_FALLBACK = new Set(["strategic_bomber", "tactical_bomber"]);

autoAssignEscort(wingId: string, state: GameRoomState): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;

  const isHeavy = wing.aircraft_type === "heavy_fighter";
  const primary  = isHeavy ? AirWingLifecycleSystem.HEAVY_FIGHTER_PRIMARY  : AirWingLifecycleSystem.FIGHTER_PRIMARY;
  const fallback = isHeavy ? AirWingLifecycleSystem.HEAVY_FIGHTER_FALLBACK : AirWingLifecycleSystem.FIGHTER_FALLBACK;

  const airborneStates = new Set([WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER, WING_LIFECYCLE.RTB]);
  // NOTE: RTB is intentionally excluded from "eligible to escort" in practice since a bomber
  // heading home isn't worth newly assigning an escort to — see pitfall note below. Use TRANSIT/ENGAGED/LOITER only:
  const eligibleStates = new Set([WING_LIFECYCLE.TRANSIT, WING_LIFECYCLE.ENGAGED, WING_LIFECYCLE.LOITER]);

  const escortCounts = new Map<string, number>();
  for (const w of state.air_wings.values()) {
    if (w.mission === MISSION_TYPES.ESCORT && w.target_id !== "") {
      escortCounts.set(w.target_id, (escortCounts.get(w.target_id) ?? 0) + 1);
    }
  }

  const pickFrom = (typeSet: Set<string>): string => {
    let best = "";
    let bestCount = Infinity;
    for (const w of state.air_wings.values()) {
      if (w.nation_id !== wing.nation_id) continue;
      if (!typeSet.has(w.aircraft_type)) continue;
      if (!eligibleStates.has(w.lifecycle_state as WING_LIFECYCLE)) continue;
      const count = escortCounts.get(w.wing_id) ?? 0;
      if (count < bestCount) {
        bestCount = count;
        best = w.wing_id;
      }
    }
    return best;
  };

  let target = pickFrom(primary);
  if (target === "") target = pickFrom(fallback);

  if (target === "") {
    if (!isHeavy) {
      wing.mission = MISSION_TYPES.AIR_SUPERIORITY;
    }
    wing.target_id = "";
    return;
  }

  wing.target_id = target;
}
```
`airborneStates` is dead/unused in the snippet above — remove it, it was left in from drafting;
only `eligibleStates` is used. (Flagging explicitly so the execution agent deletes it rather
than leaving unused code.)

### 2c. Wire into `GameRoom.ts`'s `ASSIGN_WING_MISSION` handler

Current handler (`GameRoom.ts:178-220`) always calls `assignMission()`. Change:
```ts
      const isAutoEscort = msg.mission === MISSION_TYPES.ESCORT && (!msg.target_id || msg.target_id === "");
      let didChange: boolean;
      if (isAutoEscort) {
        this.airWingLifecycleSystem.assignMission(msg.wing_id, msg.mission, "", this.state);
        this.airWingLifecycleSystem.autoAssignEscort(msg.wing_id, this.state);
        didChange = true;
      } else {
        didChange = this.airWingLifecycleSystem.assignMission(
          msg.wing_id,
          msg.mission,
          msg.target_id,
          this.state
        );
      }
      if (!didChange) return;
```
The rest of the handler (path computation, broadcast) is unchanged — it already reads
`updated.target_id`/`updated.mission` off `this.state.air_wings.get(msg.wing_id)` after the
mutation, so it will correctly pick up whatever `autoAssignEscort()` set. Note: `assignMission`
called with empty `target_id` first, then `autoAssignEscort` overwrites `target_id` if a match
is found — this two-call sequence is intentional (reuses `assignMission`'s existing
lifecycle-state transition + ENGAGED guard, then layers targeting on top).

### 2d. `disbandWing()` orphan reassignment

Current (`air_wing_lifecycle_system.ts:287-309`) deletes the wing without checking for
dependents. Add a scan **before** the delete:
```ts
disbandWing(wingId: string, state: GameRoomState, broadcast: BroadcastFn, messageType = "AIR_WING_DESTROYED"): void {
  const wing = state.air_wings.get(wingId);
  if (!wing) return;

  const orphanedEscorts: string[] = [];
  for (const w of state.air_wings.values()) {
    if (w.mission === MISSION_TYPES.ESCORT && w.target_id === wingId) {
      orphanedEscorts.push(w.wing_id);
    }
  }

  const nationId = wing.nation_id;
  state.air_wings.delete(wingId);

  this._engagementTicks.delete(wingId);
  this._loiterTicks.delete(wingId);
  this._refuelTicks.delete(wingId);
  this._weaponCooldown.delete(wingId);
  this._lastEngagedTarget.delete(wingId);
  this._pendingRedeployTarget.delete(wingId);
  this._pendingMissionAfterRedeploy.delete(wingId);
  this._pendingTransitAfterRedeploy.delete(wingId);
  this._statusFuel.delete(wingId);

  for (const escortId of orphanedEscorts) {
    this.autoAssignEscort(escortId, state);
  }

  broadcast(messageType, {
    wing_id: wingId,
    nation_id: nationId,
    destroyed_by_wing_id: "",
  });
}
```
Note: `autoAssignEscort()` internally re-scans `state.air_wings` for `escortCounts`, which will
no longer include the just-deleted wing (already removed above) — correct, no stale self-count.

### 2e. Verify

`cd game-server && npm test` (lane-scoped: `air-combat`), then `npm run build`.

---

## Step 3: Server — `ADJUST_WING_SIZE` and `CREATE_WING` handlers

### 3a. Write failing tests first

Create `game-server/test/12k-wing-management.test.ts` (same `getTestPort()`/lane-prefix pattern):
- `ADJUST_WING_SIZE` with `delta: 10` on a wing with `count: 20` → `count` becomes 30.
- `ADJUST_WING_SIZE` with `delta: -10` on a wing with `count: 5` → `count` clamps to 0 (not -5).
- `ADJUST_WING_SIZE` from a client not owning the wing's nation → no-op, `count` unchanged.
- `CREATE_WING` with a valid nation-owned `home_airbase_province_id` → new wing appears in
  `state.air_wings` with `mission = "idle"`, `lifecycle_state = "idle"`, requested
  `aircraft_type`/`count`.
- `CREATE_WING` with a `home_airbase_province_id` NOT owned by the requesting nation → rejected,
  no wing created.
- `CREATE_WING` from a client with no nation → rejected.

### 3b. `ADJUST_WING_SIZE` handler — add to `GameRoom.ts` near the other player-facing wing
handlers (after `SET_WING_PERK`, before the `DEV_MODE` block starts):
```ts
    this.onMessage("ADJUST_WING_SIZE", (client, msg: { wing_id: string; delta: number }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const wing = this.state.air_wings.get(msg.wing_id);
      if (!wing || wing.nation_id !== nation.nation_id) return;

      wing.count = Math.max(0, wing.count + msg.delta);
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    });
```

### 3c. `CREATE_WING` handler — same location:
```ts
    this.onMessage("CREATE_WING", (client, msg: {
      wing_id: string;
      aircraft_type: string;
      count: number;
      home_airbase_province_id: string;
    }) => {
      if (this.state.phase !== "running") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nation = this.getNationForPlayer(player.userId);
      if (!nation) return;
      const province = this.state.provinces.get(msg.home_airbase_province_id);
      if (!province || province.owner_id !== nation.nation_id) return;

      const wing = new AirWingState();
      wing.wing_id = msg.wing_id;
      wing.nation_id = nation.nation_id;
      wing.aircraft_type = msg.aircraft_type;
      wing.count = Math.max(0, msg.count);
      wing.home_airbase_province_id = msg.home_airbase_province_id;
      wing.position_lng = province.position_lng;  // confirm exact ProvinceState field name before use
      wing.position_lat = province.position_lat;  // confirm exact ProvinceState field name before use
      wing.lifecycle_state = WING_LIFECYCLE.IDLE;
      wing.mission = MISSION_TYPES.IDLE;
      this.state.air_wings.set(msg.wing_id, wing);
      this.broadcastFilteredAirWingUpdates({ wings: [serializeWing(wing)] });
    });
```
**Pitfall:** the exact field names for a province's coordinates were not verified during
planning (the dev-only `SPAWN_WING` handler takes `position_lng`/`position_lat` directly from
the client message rather than deriving them from a province, so there's no existing precedent
to copy for "look up a province's coordinates"). Before writing this handler, grep
`ProvinceState` in `game-server/src/rooms/schema/GameRoomState.ts` (or wherever it's defined)
for its position fields and use the real names — do not assume `position_lng`/`position_lat`
without checking, they may be named differently (e.g. `centroid_lng`/`centroid_lat`).
**Pitfall:** "nation's capital" needs a concrete definition — check `NationState` (or
`GameRoomState`) for an existing `capital_province_id`-style field before inventing one; if
none exists, use "first province where `owner_id === nation.nation_id`" as the fallback and
note this simplification in a code comment, since this branch explicitly defers a real capital
concept.

### 3d. Verify

`npm test` (lane-scoped), `npm run build`. Add both new test files to `test-lanes.json`'s
`air-combat.tests` array.

---

## Step 4: Client — Constants File

### 4a. `client/src/core/air_wing_constants.gd` (new)

```gdscript
class_name AirWingConstants
extends RefCounted
## Mirrors game-server/src/rooms/schema/AirWingState.ts MISSION_TYPES exactly.
## Keep in sync manually — no shared schema between client/server languages.

const MISSION_IDLE               := "idle"
const MISSION_TACTICAL_BOMBING   := "tactical_bombing"
const MISSION_INTERCEPTION       := "interception"
const MISSION_AIR_SUPERIORITY    := "air_superiority"
const MISSION_ESCORT             := "escort"
const MISSION_LOGISTICS          := "logistics"
const MISSION_AREA               := "area"
const MISSION_INDUSTRY           := "industry"
const MISSION_OIL                := "oil"
const MISSION_RECON              := "recon"
const MISSION_TRADE_INTERDICTION := "trade_interdiction"
const MISSION_ANTI_SUBMARINE     := "anti_submarine"
const MISSION_ANTI_SHIP          := "anti_ship"
const MISSION_PORT_STRIKE        := "port_strike"

## aircraft_type → always-eligible mission list (no perk needed)
const BASE_ELIGIBLE_MISSIONS := {
	"fighter":          [MISSION_IDLE, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION, MISSION_ESCORT],
	"heavy_fighter":    [MISSION_IDLE, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION, MISSION_ESCORT],
	"cas_plane":        [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION],
	"dive_bomber":      [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION],
	"tactical_bomber":  [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AREA, MISSION_INDUSTRY, MISSION_OIL, MISSION_LOGISTICS],
	"strategic_bomber": [MISSION_IDLE, MISSION_AREA, MISSION_INDUSTRY, MISSION_OIL, MISSION_LOGISTICS],
	"naval_bomber":     [MISSION_IDLE, MISSION_TRADE_INTERDICTION, MISSION_ANTI_SUBMARINE, MISSION_ANTI_SHIP, MISSION_PORT_STRIKE],
	"recon_plane":      [MISSION_IDLE, MISSION_RECON],
}

## Returns the full list of missions this wing can currently select, given its
## aircraft_type and perk flags (perk_strafing, perk_air_combat).
static func get_eligible_missions(aircraft_type: String, wing_data: Dictionary) -> Array:
	var missions: Array = BASE_ELIGIBLE_MISSIONS.get(aircraft_type, [MISSION_IDLE]).duplicate()

	var has_strafing: bool = wing_data.get("perk_strafing", false)
	if has_strafing and aircraft_type in ["fighter", "heavy_fighter"]:
		missions.append(MISSION_TACTICAL_BOMBING)

	# perk_air_combat (CAS/DIVE) is a damage-effectiveness multiplier only, not a mission
	# eligibility gate — Air Superiority/Interception are already in BASE_ELIGIBLE_MISSIONS
	# for those types, no perk check needed here.

	return missions

## Display label for a mission const (e.g. "trade_interdiction" -> "Trade Interdiction").
static func mission_label(mission: String) -> String:
	return mission.replace("_", " ").capitalize()
```

---

## Step 5: Client — Bottom Panel (`friendly_air_wing_panel`)

### Target layout (ASCII, confirmed with user)

```
┌─ WING: 2nd Fighter Wing ───────────────────────────┐
│ ✈ FIGHTER  x24    Readiness ████████░░ 82%         │
│ Fuel  ██████░░░░ 61%   Weapon: READY                │
│ Status: LOITER   Base: Warsaw                       │
├─────────────────────────────────────────────────────┤
│ MISSION: [ Air Superiority              ▾]          │
│                                                        │
│ Size:  [ −10 ]      24      [ +10 ]                  │
│                                                        │
│ ⓘ Right-click map to move/redeploy (micro-manage)    │
│                                                        │
│                [ Retreat ]                            │
└─────────────────────────────────────────────────────┘
```
When `mission == "escort"`, one extra row appears between MISSION and Size:
```
│ Escort target: auto (Bomber Wing 3)  [Pick Target]   │
```
`(Bomber Wing 3)` is illustrative — show the target wing's `wing_id`/`aircraft_type`, or
`"none yet"` if `target_id` is empty (e.g. auto-assign found no candidate).

### 5a. `.tscn` changes

Add under `Margin/HBox` (sibling to existing `IdentityBlock`/`StatusBlock`/`ReadinessBlock`/
`TargetBlock`), a new `ActionsBlock` `VBoxContainer`:
```
ActionsBlock (VBoxContainer)
├─ MissionRow (HBoxContainer)
│  ├─ MissionOptionButton (OptionButton)
├─ EscortRow (HBoxContainer, visible=false by default)
│  ├─ EscortTargetLabel (Label)
│  └─ BtnPickTarget (Button, text="Pick Target")
├─ SizeRow (HBoxContainer)
│  ├─ BtnSizeMinus (Button, text="−10")
│  ├─ SizeValueLabel (Label)
│  └─ BtnSizePlus (Button, text="+10")
├─ MoveHintLabel (Label, text="Right-click map to move/redeploy")
└─ BtnRetreat (Button, text="Retreat")
```

### 5b. `.gd` changes

Add node refs in `_ready()` alongside the existing ones:
```gdscript
var _mission_option: OptionButton
var _escort_row: HBoxContainer
var _escort_target_label: Label
var _btn_pick_target: Button
var _size_value_label: Label
var _btn_size_minus: Button
var _btn_size_plus: Button
var _btn_retreat: Button

func _ready() -> void:
	# ... existing node lookups unchanged ...
	_mission_option      = get_node_or_null("Margin/HBox/ActionsBlock/MissionRow/MissionOptionButton")
	_escort_row           = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow")
	_escort_target_label  = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow/EscortTargetLabel")
	_btn_pick_target       = get_node_or_null("Margin/HBox/ActionsBlock/EscortRow/BtnPickTarget")
	_size_value_label      = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/SizeValueLabel")
	_btn_size_minus        = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/BtnSizeMinus")
	_btn_size_plus         = get_node_or_null("Margin/HBox/ActionsBlock/SizeRow/BtnSizePlus")
	_btn_retreat           = get_node_or_null("Margin/HBox/ActionsBlock/BtnRetreat")
	# ... existing EventBus.air_wing_updated.connect unchanged ...
```

Rewrite `populate()` to call a new `_rewire_buttons(wing_id)`, mirroring
`friendly_division_panel.gd:142-176`'s disconnect-then-reconnect idiom exactly:
```gdscript
func populate(wing_id: String, data: Dictionary) -> void:
	_current_wing_id = wing_id
	_refresh_stats(data)
	_refresh_mission_dropdown(data)
	_refresh_escort_row(data)
	_refresh_size_row(data)
	var ls: String = data.get("lifecycle_state", "idle")
	if _btn_retreat != null:
		_btn_retreat.visible = ls in ["transit", "engaged", "loiter"]
	_rewire_buttons(wing_id)


func _rewire_buttons(wing_id: String) -> void:
	for btn: Button in [_btn_retreat, _btn_pick_target, _btn_size_minus, _btn_size_plus]:
		if btn == null:
			continue
		if btn.pressed.get_connections().size() > 0:
			for conn: Dictionary in btn.pressed.get_connections():
				btn.pressed.disconnect(conn["callable"])

	if _btn_retreat != null:
		_btn_retreat.pressed.connect(func() -> void:
			CommandQueue.submit("RETREAT_WING", { "wing_id": wing_id })
		)
	if _btn_pick_target != null:
		_btn_pick_target.pressed.connect(func() -> void:
			EventBus.air_wing_escort_picker_open_requested.emit(wing_id)
		)
	if _btn_size_minus != null:
		_btn_size_minus.pressed.connect(func() -> void:
			CommandQueue.submit("ADJUST_WING_SIZE", { "wing_id": wing_id, "delta": -10 })
		)
	if _btn_size_plus != null:
		_btn_size_plus.pressed.connect(func() -> void:
			CommandQueue.submit("ADJUST_WING_SIZE", { "wing_id": wing_id, "delta": 10 })
		)

	if _mission_option != null:
		if _mission_option.item_selected.is_connected(_on_mission_selected):
			_mission_option.item_selected.disconnect(_on_mission_selected)
		_mission_option.item_selected.connect(_on_mission_selected)
```
**Pitfall:** `OptionButton.item_selected` is a single persistent binding, not something you
reconnect per-wing the same way as `Button.pressed` closures — using a bound `Callable` (not an
anonymous `func()`) lets you check `is_connected`/`disconnect` cleanly, shown above. Do NOT use
an anonymous lambda for the `OptionButton` handler the way the `Button`s do, or you'll be unable
to disconnect it on the next `populate()` call and selections will fire multiple stacked
submissions.

```gdscript
func _on_mission_selected(index: int) -> void:
	if _mission_option == null or _current_wing_id.is_empty():
		return
	var mission: String = _mission_option.get_item_metadata(index)
	CommandQueue.submit("ASSIGN_WING_MISSION", {
		"wing_id": _current_wing_id,
		"mission": mission,
		"target_id": "",
	})


func _refresh_mission_dropdown(data: Dictionary) -> void:
	if _mission_option == null:
		return
	var aircraft_type: String = data.get("aircraft_type", "")
	var eligible: Array = AirWingConstants.get_eligible_missions(aircraft_type, data)
	_mission_option.clear()
	var current_mission: String = data.get("mission", "")
	var select_index := 0
	for i: int in range(eligible.size()):
		var m: String = eligible[i]
		_mission_option.add_item(AirWingConstants.mission_label(m), i)
		_mission_option.set_item_metadata(i, m)
		if m == current_mission:
			select_index = i
	_mission_option.select(select_index)


func _refresh_escort_row(data: Dictionary) -> void:
	if _escort_row == null:
		return
	var mission: String = data.get("mission", "")
	_escort_row.visible = mission == AirWingConstants.MISSION_ESCORT
	if _escort_target_label != null:
		var target_id: String = data.get("target_id", "")
		_escort_target_label.text = "Escort target: " + (target_id if not target_id.is_empty() else "none yet")


func _refresh_size_row(data: Dictionary) -> void:
	if _size_value_label != null:
		_size_value_label.text = str(int(data.get("count", 0)))
```

Also call `_refresh_mission_dropdown(data)`, `_refresh_escort_row(data)`, `_refresh_size_row(data)`
from the existing `_on_air_wing_updated()` handler (alongside the existing `_refresh_stats(data)`
call), so the panel updates live as `AIR_WING_UPDATES` broadcasts arrive (e.g. after
auto-assignment picks an escort target).

**Pitfall:** `_refresh_mission_dropdown()` rebuilding the `OptionButton` items on every update
will reset the user's dropdown scroll position but not their selection (since `select_index` is
recomputed from `current_mission` each time) — acceptable for this branch, not a bug.

---

## Step 6: Client — Escort Picker Panel (new)

### ASCII mockup (confirmed with user)

```
┌─ Choose Bomber to Escort ─────────────────┐
│ ┌────────────────────────────────────────┐│
│ │ ✈ TACTICAL_BOMBER x12  — LOITER  Warsaw ││
│ ├────────────────────────────────────────┤│
│ │ ✈ STRATEGIC_BOMBER x8  — TRANSIT Krakow ││
│ ├────────────────────────────────────────┤│
│ │ ✈ DIVE_BOMBER x16      — LOITER  Lodz   ││
│ └────────────────────────────────────────┘│
│              [ Cancel ]   [ Confirm ]      │
└─────────────────────────────────────────────┘
```

### 6a. `event_bus.gd` — add signal
```gdscript
signal air_wing_escort_picker_open_requested(wing_id: String)
```

### 6b. `air_wing_escort_picker_panel.gd` (new) + matching `.tscn`

Structural pattern to follow (simplified from `division_template_viewer_panel.gd:436-537`, no
hover-preview needed — just click-to-select + confirm):
```gdscript
extends PanelContainer

signal close_requested()

var _escort_wing_id: String = ""
var _selected_bomber_id: String = ""
var _list_container: VBoxContainer
var _btn_confirm: Button

const BOMBER_TYPES := ["strategic_bomber", "tactical_bomber", "cas_plane", "dive_bomber", "naval_bomber"]


func _ready() -> void:
	_list_container = get_node_or_null("Margin/VBox/Scroll/ListContainer")
	_btn_confirm    = get_node_or_null("Margin/VBox/Footer/BtnConfirm")
	var btn_cancel: Button = get_node_or_null("Margin/VBox/Footer/BtnCancel")
	if btn_cancel != null:
		btn_cancel.pressed.connect(func() -> void: close_requested.emit())
	if _btn_confirm != null:
		_btn_confirm.pressed.connect(_on_confirm_pressed)
		_btn_confirm.disabled = true


func open_for_wing(wing_id: String) -> void:
	_escort_wing_id = wing_id
	_selected_bomber_id = ""
	if _btn_confirm != null:
		_btn_confirm.disabled = true
	_rebuild_list()


func _rebuild_list() -> void:
	if _list_container == null:
		return
	for child: Node in _list_container.get_children():
		_list_container.remove_child(child)
		child.queue_free()

	var my_nation: String = GameState.get_my_nation_id()
	for wing_data: Dictionary in GameState.get_air_wings_for_nation(my_nation):
		if not wing_data.get("aircraft_type", "") in BOMBER_TYPES:
			continue
		if wing_data.get("lifecycle_state", "") == "idle" or wing_data.get("lifecycle_state", "") == "refuel":
			continue  # airborne-only, matches server eligibility
		_list_container.add_child(_make_bomber_card(wing_data))


func _make_bomber_card(wing_data: Dictionary) -> PanelContainer:
	var card := PanelContainer.new()
	var label := Label.new()
	var wing_id: String = wing_data.get("wing_id", "")
	label.text = "%s x%d — %s %s" % [
		wing_data.get("aircraft_type", "").to_upper(),
		int(wing_data.get("count", 0)),
		wing_data.get("lifecycle_state", "").to_upper(),
		wing_data.get("home_airbase_province_id", ""),
	]
	card.add_child(label)
	card.gui_input.connect(func(event: InputEvent) -> void:
		var mb := event as InputEventMouseButton
		if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			_selected_bomber_id = wing_id
			if _btn_confirm != null:
				_btn_confirm.disabled = false
	)
	return card


func _on_confirm_pressed() -> void:
	if _escort_wing_id.is_empty() or _selected_bomber_id.is_empty():
		return
	CommandQueue.submit("ASSIGN_WING_MISSION", {
		"wing_id": _escort_wing_id,
		"mission": "escort",
		"target_id": _selected_bomber_id,
	})
	close_requested.emit()
```
`.tscn`: `PanelContainer` → `Margin (MarginContainer)` → `VBox (VBoxContainer)` →
`Scroll (ScrollContainer)` → `ListContainer (VBoxContainer)`, plus `Footer (HBoxContainer)` with
`BtnCancel`/`BtnConfirm`. Mirror `division_template_viewer_panel.tscn`'s outer structure at a
smaller scale — no grid preview needed.

### 6c. Wire into `game_hud.gd`

Mirror how `friendly_air_wing_panel` itself is registered (`@onready var ... = $NodeName`) and
add:
```gdscript
EventBus.air_wing_escort_picker_open_requested.connect(func(wing_id: String) -> void:
	_air_wing_escort_picker_panel.open_for_wing(wing_id)
	_air_wing_escort_picker_panel.visible = true
)
```
with `_air_wing_escort_picker_panel.close_requested.connect(func() -> void:
_air_wing_escort_picker_panel.visible = false)` alongside it. Add the panel node to
`game_hud.tscn` as a centered popup (matching how other modal panels like
`division_template_viewer_panel` are parented — check `game_hud.tscn`'s existing modal-panel
parenting convention before adding a new sibling).

---

## Step 7: Client — Military Panel Air Tab + New-Wing Spawn Flow

### ASCII mockups (confirmed with user)

```
┌─ MILITARY ────────────────────────────┐
│ [ Land ] [ Air ] [ Naval ]            │
├────────────────────────────────────────┤
│  ▾ Warsaw (Airbase)              [+]  │
│    ┌──────────────────────────────┐  │
│    │ ✈ FIGHTER x24        ●92%    │  │
│    │ ✈ TACTICAL_BOMBER x12  ●61%   │  │
│    └──────────────────────────────┘  │
│  ▾ Krakow (Airbase)                   │
│    ┌──────────────────────────────┐  │
│    │ ✈ HEAVY_FIGHTER x18   ●88%    │  │
│    └──────────────────────────────┘  │
└────────────────────────────────────────┘
```
New-wing spawn modal (opened by "+"):
```
┌─ New Wing ─────────────────────────────────┐
│ Type: [ Fighter                    ▾]      │
│ Count: [ −10 ]      10      [ +10 ]         │
│ Spawns at: Warsaw (capital)                 │
│              [ Cancel ]   [ Confirm ]       │
└──────────────────────────────────────────────┘
```

### 7a. `military_panel.tscn` — add `Scroll/ListContainer` under `Air` tab

Following the Land tab's structure but keeping Air's existing suffixed node names
(`HeaderAir`/`HBoxAir`/`TitleAir` stay as-is — do not rename). Add, as a sibling to
`HeaderAir` and replacing `PlaceholderAir`:
```
Air (VBoxContainer)
├─ HeaderAir (existing, unchanged — but see 7b for "+" button injection)
└─ ScrollAir (ScrollContainer, size_flags_vertical=3)
   └─ ListContainerAir (VBoxContainer, size_flags_vertical=3/horizontal=3)
```
Remove `PlaceholderAir`.

### 7b. `military_panel.gd` changes

```gdscript
func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_inject_land_header()
	_inject_air_header()
	_refresh_template_list()
	_refresh_air_list()
	DivisionTemplateStore.templates_changed.connect(func() -> void: _refresh_template_list())
	EventBus.air_wing_added.connect(func(_id: String) -> void: _refresh_air_list())
	EventBus.air_wing_updated.connect(func(_id: String) -> void: _refresh_air_list())
	EventBus.air_wing_removed.connect(func(_id: String) -> void: _refresh_air_list())


func _inject_air_header() -> void:
	var hbox: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabBar/Air/HeaderAir/HBoxAir") as HBoxContainer
	if hbox == null:
		return
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(spacer)
	var add_btn := Button.new()
	add_btn.text = "+"
	add_btn.custom_minimum_size = Vector2(28, 28)
	add_btn.tooltip_text = "Spawn new air wing"
	add_btn.pressed.connect(func() -> void:
		EventBus.air_wing_spawn_open_requested.emit("")  # "" = default to capital; province picker deferred
	)
	hbox.add_child(add_btn)


func _refresh_air_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Air/ScrollAir/ListContainerAir") as VBoxContainer
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	var my_nation: String = GameState.get_my_nation_id()
	var by_airbase: Dictionary = {}  # province_id -> Array[Dictionary]
	for wing_data: Dictionary in GameState.get_air_wings_for_nation(my_nation):
		var base_id: String = wing_data.get("home_airbase_province_id", "")
		if not by_airbase.has(base_id):
			by_airbase[base_id] = []
		by_airbase[base_id].append(wing_data)

	var sorted_bases: Array = by_airbase.keys()
	sorted_bases.sort()
	for base_id: String in sorted_bases:
		var group_lbl := Label.new()
		group_lbl.text = base_id  # province name lookup TBD — see pitfall below
		group_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
		group_lbl.add_theme_font_size_override("font_size", 11)
		list_container.add_child(group_lbl)
		for wing_data: Dictionary in by_airbase[base_id]:
			list_container.add_child(_make_air_wing_item(wing_data))


func _make_air_wing_item(wing_data: Dictionary) -> Button:
	var btn := Button.new()
	btn.custom_minimum_size.y = 40
	btn.size_flags_horizontal = 3
	var wing_id: String = wing_data.get("wing_id", "")
	var readiness: float = float(wing_data.get("combat_readiness", 1.0))
	btn.text = "%s x%d   %.0f%%" % [
		wing_data.get("aircraft_type", "").to_upper(),
		int(wing_data.get("count", 0)),
		readiness * 100.0,
	]
	btn.pressed.connect(func() -> void:
		EventBus.air_wing_selected.emit(wing_id)
	)
	return btn
```
**Pitfall:** `group_lbl.text = base_id` displays the raw `province_id`, not a human-readable
province name — there is no existing helper confirmed during planning for
`province_id -> display_name` lookup off `GameState`. Check `GameState` for an existing
province-name accessor (likely used by province info panels) before shipping this as a raw ID;
if one exists, use it. This is a cosmetic gap, not a functional blocker — acceptable to ship
with raw IDs and note as a follow-up if no accessor is found quickly.

### 7c. `air_wing_spawn_panel.gd` (new) + matching `.tscn`

```gdscript
extends PanelContainer

signal close_requested()

var _type_option: OptionButton
var _count_label: Label
var _btn_confirm: Button
var _count: int = 10

const SPAWNABLE_TYPES := ["fighter", "heavy_fighter", "cas_plane", "dive_bomber",
	"tactical_bomber", "strategic_bomber", "naval_bomber", "recon_plane"]


func _ready() -> void:
	_type_option = get_node_or_null("Margin/VBox/TypeRow/TypeOptionButton")
	_count_label = get_node_or_null("Margin/VBox/CountRow/CountLabel")
	_btn_confirm = get_node_or_null("Margin/VBox/Footer/BtnConfirm")
	var btn_minus: Button = get_node_or_null("Margin/VBox/CountRow/BtnMinus")
	var btn_plus: Button  = get_node_or_null("Margin/VBox/CountRow/BtnPlus")
	var btn_cancel: Button = get_node_or_null("Margin/VBox/Footer/BtnCancel")

	if _type_option != null:
		for i: int in range(SPAWNABLE_TYPES.size()):
			_type_option.add_item(SPAWNABLE_TYPES[i].replace("_", " ").capitalize(), i)
			_type_option.set_item_metadata(i, SPAWNABLE_TYPES[i])

	if btn_minus != null:
		btn_minus.pressed.connect(func() -> void:
			_count = max(0, _count - 10)
			_refresh_count_label()
		)
	if btn_plus != null:
		btn_plus.pressed.connect(func() -> void:
			_count += 10
			_refresh_count_label()
		)
	if btn_cancel != null:
		btn_cancel.pressed.connect(func() -> void: close_requested.emit())
	if _btn_confirm != null:
		_btn_confirm.pressed.connect(_on_confirm_pressed)


func open_spawn_modal() -> void:
	_count = 10
	_refresh_count_label()
	if _type_option != null:
		_type_option.select(0)


func _refresh_count_label() -> void:
	if _count_label != null:
		_count_label.text = str(_count)


func _on_confirm_pressed() -> void:
	if _type_option == null:
		return
	var aircraft_type: String = _type_option.get_item_metadata(_type_option.selected)
	var wing_id: String = "wing_" + str(Time.get_unix_time_from_system()) + "_" + str(randi())
	var my_nation: String = GameState.get_my_nation_id()
	var capital_province_id: String = GameState.get_nation_capital_province_id(my_nation)  # confirm this accessor exists — see pitfall
	CommandQueue.submit("CREATE_WING", {
		"wing_id": wing_id,
		"aircraft_type": aircraft_type,
		"count": _count,
		"home_airbase_province_id": capital_province_id,
	})
	close_requested.emit()
```
**Pitfall:** `GameState.get_nation_capital_province_id(...)` was **not confirmed to exist**
during planning — client-side research did not check for a capital accessor (this mirrors the
same "confirm the field name" pitfall flagged in Step 3c for the server side). Before writing
this function, grep `GameState` for any existing capital/nation-province accessor; if none
exists, fall back to the first province returned by whatever function already lists a nation's
owned provinces (check `GameState` for a `get_provinces_for_nation`-style function), and pass
that province's id. Do not invent a new server round-trip just to resolve this — it should be
derivable from data the client already has cached.

### 7d. Wire into `game_hud.gd`, mirroring Step 6c's pattern:
```gdscript
EventBus.air_wing_spawn_open_requested.connect(func(_province_id: String) -> void:
	_air_wing_spawn_panel.open_spawn_modal()
	_air_wing_spawn_panel.visible = true
)
```

### 7e. `event_bus.gd` — add signal
```gdscript
signal air_wing_spawn_open_requested(province_id: String)
```
(`province_id` param is unused this branch — reserved for when a province picker is added
later; document with a one-line comment, do not delete the param just because it's unused now.)

---

## Step 8: Client — Notification Toast "air" type

### 8a. `notification_feed.gd`

```gdscript
func _get_type_color(notification_type: String) -> Color:
	match notification_type:
		"research":
			return Color(0.18, 0.62, 0.56, 1.0)
		"warning":
			return Color(0.96, 0.70, 0.26, 1.0)
		"error":
			return Color(0.88, 0.26, 0.20, 1.0)
		"combat":
			return Color(0.86, 0.36, 0.18, 1.0)
		"diplomacy":
			return Color(0.48, 0.31, 0.69, 1.0)
		"air":
			return Color(0.35, 0.55, 0.85, 1.0)
		_:
			return Color(0.96, 0.78, 0.38, 1.0)


func _get_type_title(notification_type: String) -> String:
	match notification_type:
		"research":
			return "RESEARCH"
		"warning":
			return "WARNING"
		"error":
			return "ERROR"
		"combat":
			return "COMBAT"
		"diplomacy":
			return "DIPLOMACY"
		"air":
			return "AIR OPS"
		_:
			return "NOTICE"
```

### 8b. `session_manager.gd` — rewire

```gdscript
		"AIR_WING_STAGING":
			EventBus.notification_requested.emit(
				"Wing out of range — auto-staging to closer airbase before executing order.",
				"air"
			)

		"AIR_WING_DESTROYED":
			GameState._apply_air_wing_destroyed(data)
			EventBus.notification_requested.emit("Air wing lost", "air")
		...
		"AIR_COMBAT_STARTED":
			EventBus.air_combat_started.emit(data)
			EventBus.notification_requested.emit("Air combat engaged", "air")
		"AIR_COMBAT_ENDED":
			EventBus.air_combat_ended.emit(data)
		"AIR_WING_RTB_QUEUED":
			EventBus.notification_requested.emit(
				"Wing returning to base — will proceed to target after refuelling.", "air")
		"AIR_WING_MOVE_REJECTED":
			EventBus.notification_requested.emit(
				"Target out of range — no staging airbase available.", "warning")
```
Only the type string changes on `AIR_WING_STAGING`/`AIR_WING_RTB_QUEUED` (`"info"` → `"air"`)
and two new `notification_requested.emit(...)` lines are added (`AIR_WING_DESTROYED`,
`AIR_COMBAT_STARTED`) — everything else in this block (lines 130-186) is unchanged, including
`AIR_WING_MOVE_REJECTED` staying `"warning"`.

---

## Verification Summary

- **Server:** `cd game-server && npm test` (fast, lane-scoped via `test-lanes.json`'s
  `air-combat` lane — run this repeatedly through Steps 1-3), then `npm run build` before
  considering the branch done. `npm run test:full` once before final merge.
- **Client:** No automated test harness for GDScript UI in this repo — verification is manual,
  via the `run` skill, launching the client and:
  1. Selecting an own fighter wing → bottom panel shows filtered mission dropdown (no ground-
     attack missions for a fighter without perks), Retreat button (only when airborne), a Move
     hint label (not a clickable button), and a ±10 size stepper that updates the live count.
  2. Setting mission to Escort with no perk/target picked → target auto-assigns (verify via the
     "Escort target:" row updating after the next `AIR_WING_UPDATES` broadcast) if an eligible
     bomber is airborne; "Pick Target" opens the picker and manually assigning works too.
  3. Disbanding/destroying an escorted bomber (via dev harness) with a second eligible bomber
     airborne → escort re-pairs automatically; verify no wing is left with a `target_id`
     pointing at a wing that no longer exists.
  4. Military panel → Air tab lists wings grouped by airbase; "+" opens the spawn modal; picking
     a type and confirming creates a new wing (visible in the list, `count == 10`, `mission ==
     "idle"`, sitting at the capital, not auto-launching).
  5. Triggering a staging event and a combat-start event → "AIR OPS" toast appears with the new
     sky-blue accent, not falling through to the generic "NOTICE" styling.
  6. Godot headless scene-load check on every modified/new `.tscn` file (no orphan-node /
     missing-script errors).
- After implementation: reconcile `docs/DEV_PHASES.md` §12's K-ui checkbox, per `AGENTS.md`
  workflow step 3.

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| A "nation preset air wing template" system needs building | **Wrong** — `AirWingTemplate` schema class is dead code, never instantiated. New wings are just `{aircraft_type, count}`, no template concept, per explicit user decision |
| `MISSION_TYPES` has 12 values matching the original phase-12 doc prose | **Wrong** — server has 13 today (`PORT_STRIKE` is real and used), becomes 14 with the new `IDLE` this branch adds |
| A wing can already be told to "just stay idle" | **Wrong** — `assignMission()` unconditionally forces `IDLE`/`LOITER` wings into `TRANSIT` the moment ANY mission is assigned; the new `IDLE` mission needs an explicit early-return to skip this |
| `setPerk()` accepts any perk string | **Wrong** — it's a closed `switch` whitelist; unrecognized perk names silently no-op (`didChange` stays false, no error) |
| CAS_PLANE/DIVE_BOMBER need `perk_air_combat` before they can select Air Superiority/Interception at all | **Wrong** (revised mid-planning) — those missions are base-eligible for both types, matching the client's existing unconditional `_can_intercept()` allowance; `perk_air_combat` only boosts damage effectiveness once eligible, it's not a mission gate |
| `attack_vs_air` is `0.0` for CAS_PLANE/DIVE_BOMBER and stays that way without the perk | **Wrong** (revised) — Step 1c gives both a non-zero placeholder base (`0.05`) so the mission is functional by default; `perk_air_combat` bumps it to a higher placeholder (`0.15`) via `attack_vs_air_perked`, read in `air_combat_system.ts`'s `_resolveOneSide()` |
| Escort auto-assignment already exists somewhere (maybe in a fleet system) | **Wrong** — confirmed via full-codebase search, `assignMission()`'s `target_id` handling is 100% manual pass-through; no priority/spread logic anywhere |
| `disbandWing()` already cleans up escorts pointed at the destroyed wing | **Wrong** — confirmed bug, no such scan exists; must be added as part of this branch |
| `_can_intercept()` needs a code change in this branch | **Wrong** (revised) — it already allows CAS/DIVE unconditionally (from Branch H); since the revised design makes Air Superiority/Interception base-eligible for those types too (not perk-gated), the client's existing behavior is already correct and is left untouched |
| `serializeWing()` sends every perk field to the client | **Wrong** — it's missing `perk_splash` today (pre-existing gap); fix while adding `perk_air_combat` to the same function |
| `friendly_air_wing_panel.gd` already has action buttons like the division panel does | **Wrong** — it's 100% read-only labels today; the `ActionsBlock` doesn't exist and must be added to both the `.gd` and `.tscn` |
| The Military panel's Air tab has a list container like the Land tab | **Wrong** — it's a bare `Header + PlaceholderAir Label`, no `Scroll/ListContainer` exists; must be added |
| Land tab and Air tab node names follow the same convention | **Wrong** — Land's inner nodes are unsuffixed (`Header/HBox/Title`), Air's are suffixed (`HeaderAir/HBoxAir/TitleAir`) — a pre-existing inconsistency; match whichever convention the tab you're editing already uses, don't rename Land's nodes to "fix" it |
| `game_hud.gd`'s air wing selection handler distinguishes friendly vs enemy wings like the division handler does | **Wrong** — `_on_air_wing_selected` always populates the friendly panel regardless of ownership; this is a pre-existing gap, out of scope for K-ui, do not build anything that assumes it's handled |
| `GameState` has a function to look up wings by province/airbase | **Wrong** — only `get_air_wing(id)` and `get_air_wings_for_nation(nation_id)` exist; grouping by `home_airbase_province_id` must happen client-side in the panel code |
| `GameState` has a confirmed capital-province accessor for a nation | **Unverified** — not confirmed during planning; check before use in Step 7c, don't assume the name |
| `ProvinceState` has `position_lng`/`position_lat` fields | **Unverified** — not confirmed during planning; the dev `SPAWN_WING` handler takes position directly from the client, so there's no existing precedent for deriving a wing's spawn position from a province — check the real field names before writing Step 3c |
| A per-mission icon set exists in `client/assets/icons/` | **Wrong** — only `jet-fighter-up-solid-full.svg` exists for air; mission dropdown is text-only this branch, confirmed decision |
| `OptionButton` selection handlers can be reconnected the same way as `Button.pressed` anonymous closures | **Wrong** — use a named/bound `Callable` for `item_selected` so `is_connected()`/`disconnect()` work correctly across repeated `populate()` calls; an anonymous lambda can't be disconnected later |
| `AIR_SUPERIORITY_LOST`/`AIR_WING_DRIVEN_OFF` are live events worth wiring into toasts | **Wrong** — both interfaces exist in `AirWingState.ts` but are never broadcast anywhere server-side; wiring them would be dead code |
| Adding an Air Fleet panel is still part of this branch | **Wrong** — explicitly dropped from K-ui scope; Branch I stays deferred |
