import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type { GameRoomState, DivisionState, GridCellState } from "../rooms/schema/GameRoomState.js";
import type { MovementSystem } from "./movement_system.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import type { GridCellDelta, UnitIncapacitatedPayload, RoundResolvedPayload, UnitTypeValue } from "../types/tactical_types.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

// Kilometres represented by one degree of lat/lng (approximate, matches movement_system)
const KM_PER_DEG = 111.0;

// Engagement detection is skipped for this many ticks so players can issue starting
// orders before border divisions auto-engage each other.
let COMBAT_GRACE_TICKS = 10;

export function setCombatGraceTicksForTesting(n: number): void { COMBAT_GRACE_TICKS = n; }

import { BASE_ATTRITION, HP_DAMAGE_FRACTION, SUPPRESSION_FRACTION } from "../data/combat_constants.js";

// Damage output multiplier by division type
const TYPE_MULT: Record<string, number> = {
  armoured:  1.4,
  motorised: 1.2,
  infantry:  1.0,
};

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

// ── Per-cell stat constants ───────────────────────────────────────────────────
const CELL_SUPP_DECAY_BASE    = 8;    // suppression points decayed per round during active combat
const CELL_SUPP_DECAY_RETREAT = 20;   // 2.5× faster during retreat

// Armour penetration table: [pen/armour ratio threshold, damage multiplier]
// Apply first entry where ratio ≥ threshold (table must be sorted descending).
const ARMOUR_PEN_TABLE: Array<[number, number]> = [
  [1.00, 1.00],
  [0.90, 0.70],
  [0.80, 0.40],
  [0.70, 0.30],
  [0.60, 0.20],
  [0.00, 0.00],
];

// Units that bypass the lethality ramp — deal full damage (multiplier=1.0) every round.
const FORCE_RECON_UNIT_TYPES = new Set<string>([
  "recon_infantry",
  "commando",
  "sniper",
]);

// Suppression level at which a defender (or meeting-battle participant) auto-retreats
const DEFENDER_SUPPRESS_THRESHOLD = 60;
// Suppression level at which an attacker auto-retreats
const ATTACKER_SUPPRESS_THRESHOLD = 80;

// Suppression recovered per tick while idle
const SUPPRESS_DECAY_IDLE = 1.5;
// Suppression recovered per tick while retreating
const SUPPRESS_DECAY_RETREAT = 3.5;

// Division must be within this radius of a city to capture it
const CAPTURE_RADIUS_KM = 40.0;
// Enemy must be THIS close to the city to contest capture (smaller than engagement radius so
// far-away frontline units don't permanently block every nearby capture attempt)
const CONTEST_RADIUS_KM = 20.0;

// Angle thresholds for flanking classification (max pairwise angle across all attacking divisions)
const FLANK_ANGLE_MIN = Math.PI / 2;          // 90° — counts as flank
const REAR_ANGLE_MIN  = (3 * Math.PI) / 4;   // 135° — counts as rear
// Damage multiplier applied to a secondary attacker when flanking
const FLANK_BONUS = 1.25;
// Damage multiplier applied to a secondary attacker when hitting the rear
const REAR_BONUS  = 1.50;

// ─── Stacking constants ─────────────────────────────────────────────────────

// Two same-nation stationary divisions within this distance form a positional stack
const STACK_THRESHOLD_KM = 15.0;
// Divisions with a move order are considered non-stationary; stacks dissolve when one moves
// Suppression at which the front stack division rotates to the back
const STACK_ROTATE_THRESHOLD = 50;
// When the LAST stack position hits retreat threshold it actually retreats (no more rotation)
const STACK_LAST_RETREAT_THRESHOLD = 60;

// ─── Terrain modifier tables ────────────────────────────────────────────────
// Each entry: [attacker_penalty, defender_bonus] as fractions of 1.0

const ELEV_MOD: Record<string, [number, number]> = {
  flat:      [0.00, 0.00],
  hills:     [0.15, 0.15],
  mountains: [0.35, 0.35],
};

const COVER_MOD: Record<string, [number, number]> = {
  plains:              [0.00, 0.00],
  farmland:            [0.00, 0.05],
  grassland:           [0.00, 0.00],
  steppe:              [0.00, 0.00],
  open_forest:         [0.10, 0.15],
  temperate_forest:    [0.15, 0.20],
  boreal_forest:       [0.15, 0.20],
  dense_forest:        [0.20, 0.25],
  urban:               [0.20, 0.30],
  town:                [0.15, 0.20],
  mediterranean_scrub: [0.05, 0.05],
  heathland:           [0.05, 0.05],
  hot_desert:          [0.00, 0.00],
  cold_desert:         [0.00, 0.00],
  tundra:              [0.05, 0.05],
  wetland:             [0.10, 0.10],
};

// ─── River crossing penalty constants ────────────────────────────────────────

const RIVER_PENALTY_MINOR   = 0.70;
const RIVER_PENALTY_MOD     = 0.55;
const RIVER_PENALTY_MAJOR   = 0.40;
const RIVER_PENALTY_MAP: Record<string, number> = {
  minor:    RIVER_PENALTY_MINOR,
  moderate: RIVER_PENALTY_MOD,
  major:    RIVER_PENALTY_MAJOR,
};

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceInfo {
  city_lng: number;
  city_lat: number;
  elevation: string;
  cover: string;
  polygons: [number, number][][];
}

// ── Exported pure functions (tested directly by 6c unit tests) ────────────────

export function _armorPenMultiplier(pen: number, armour: number): number {
  if (armour <= 0) return 1.0;
  const ratio = pen / armour;
  for (const [threshold, mult] of ARMOUR_PEN_TABLE) {
    if (ratio >= threshold) return mult;
  }
  return 0.0;
}

export function _getIncapFloor(unit_type: string): number {
  const stats = UNIT_COMBAT_STATS[unit_type];
  return stats?.hp_floor_pct ?? 0;
}

export function _computeDivisionSuppression(cells: GridCellState[]): number {
  const eligible = cells.filter(c => c.unit_type !== "" && !c.stealthed && !c.incapacitated);
  if (eligible.length === 0) return 0;
  return eligible.reduce((sum, c) => sum + c.suppression, 0) / eligible.length;
}

interface ActivePair {
  attacker_id: string;  // "" in meeting battle
  defender_id: string;  // "" in meeting battle
  is_meeting: boolean;
  terrain_mult_atk: number; // multiplier on attacker outgoing damage (≤ 1.0 = penalty)
  terrain_mult_def: number; // multiplier on defender outgoing damage (≥ 1.0 = bonus)
  round: number;
  is_primary_attacker: boolean;              // false for meeting battles; first attacker on this defender = true
  flank_class: "none" | "flank" | "rear";   // engagement-wide classification; "none" for primary/meeting
  river_crossing: string;                    // "" | "minor" | "moderate" | "major"
  river_side_attacker: string;               // division_id of crossing side ("" for meeting battle)
  engagement_id: string;                     // stable ID for this combat instance, generated once on creation
  round_tick_counter: number;                // ticks elapsed since last round resolved; resets each round
  lethality_phase: string;                   // current phase name
  lethality_multiplier: number;              // current damage multiplier
  _lastDeltaAttacker: GridCellDelta[];       // last round's attacker grid deltas (populated in _applyDamage)
  _lastDeltaDefender: GridCellDelta[];       // last round's defender grid deltas (populated in _applyDamage)
}

// ─── CombatSystem ────────────────────────────────────────────────────────────

export class CombatSystem {
  private provinces  = new Map<string, ProvinceInfo>();
  private activePairs = new Map<string, ActivePair>(); // sorted "idA|idB" → data
  private movementSystem: MovementSystem;
  private _resolveCombatTickCount = 0;

  constructor(movementSystem: MovementSystem) {
    this.movementSystem = movementSystem;
  }

  // ---------------------------------------------------------------------------
  // loadMapData
  // ---------------------------------------------------------------------------

  loadMapData(mapId: string): void {
    const __dir    = dirname(fileURLToPath(import.meta.url));
    const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(dataPath, "utf-8"));
    } catch {
      console.warn(`[CombatSystem] map_data.json not found at ${dataPath} — terrain modifiers disabled`);
      return;
    }

    // map_data.json shape: { provinces: [ { province_id, city_position: [lng,lat], ... } ] }
    const rawAny = raw as unknown as { provinces: Array<Record<string, unknown>> };
    for (const entry of rawAny.provinces ?? []) {
      const province_id = entry["province_id"] as string | undefined;
      if (!province_id) continue;
      const city_pos = entry["city_position"] as [number, number] | undefined;
      if (!city_pos) continue;
      this.provinces.set(province_id, {
        city_lng:  city_pos[0],
        city_lat:  city_pos[1],
        elevation: (entry["terrain_elevation"] as string) ?? "flat",
        cover:     (entry["terrain_cover"]     as string) ?? "plains",
        polygons:  (entry["polygons"] as [number, number][][]) ?? [],
      });
    }

    const count = this.provinces.size;
    console.log(`[CombatSystem] loaded ${count} provinces`);
  }

  // ---------------------------------------------------------------------------
  // tick — main entry point called every game tick
  // ---------------------------------------------------------------------------

  tick(
    state: GameRoomState,
    tickCount: number,
    broadcast: (type: string, msg: unknown) => void,
  ): Set<string> {
    const changed = new Set<string>();
    this._handleDestroyed(state, changed, broadcast);
    this._dissolveInvalidStacks(state, changed, broadcast);
    this._detectStacks(state, changed, broadcast);
    if (tickCount > COMBAT_GRACE_TICKS) {
      this._checkRetreatCompletion(state, changed);
      this._detectEngagements(state, changed, broadcast);
    }
    this._resolveCombat(state, changed, broadcast);
    this._checkDisengagement(state, changed);
    this._checkProvinceCapture(state, broadcast);
    this._decaySuppression(state);
    return changed;
  }

  // ---------------------------------------------------------------------------
  // _detectEngagements
  // ---------------------------------------------------------------------------

  private _detectEngagements(
    state: GameRoomState,
    changed: Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const divList = Array.from(state.divisions.entries()).map(([, div]) => div);

    for (let i = 0; i < divList.length; i++) {
      for (let j = i + 1; j < divList.length; j++) {
        const a = divList[i];
        const b = divList[j];

        // Skip same-nation, destroyed
        if (a.nation_id === b.nation_id) continue;
        if (
        a.combat_state === "destroyed" ||
        a.combat_state === "retreating" ||
        a.combat_state === "suppressed"
      ) continue;
      if (
        b.combat_state === "destroyed" ||
        b.combat_state === "retreating" ||
        b.combat_state === "suppressed"
      ) continue;

        // Only the stack front (position 0) can initiate combat on behalf of the stack
        if (a.stack_id && a.stack_position !== 0) continue;
        if (b.stack_id && b.stack_position !== 0) continue;

        // Skip if they are already mutually engaged in activePairs
        const key = this._pairKey(a.division_id, b.division_id);
        const distKm = this._distKm(
          a.position_lng, a.position_lat,
          b.position_lng, b.position_lat,
        );
        const engageRange = a.engagement_radius + b.engagement_radius;

        if (distKm <= engageRange) {
          if (!this.activePairs.has(key)) {
            console.log(`[Combat] ENGAGE: ${a.division_id} ↔ ${b.division_id}, dist=${distKm.toFixed(1)}km, range=${engageRange}km`);
            // ── New engagement ──────────────────────────────────────────────
            const aHasOrder = a.move_order.length > 0;
            const bHasOrder = b.move_order.length > 0;

            let attacker_id = "";
            let defender_id = "";
            let is_meeting  = false;

            if (aHasOrder && !bHasOrder) {
              attacker_id = a.division_id;
              defender_id = b.division_id;
            } else if (bHasOrder && !aHasOrder) {
              attacker_id = b.division_id;
              defender_id = a.division_id;
            } else {
              is_meeting = true;
            }

            const midLng = (a.position_lng + b.position_lng) / 2;
            const midLat = (a.position_lat + b.position_lat) / 2;
            let { atk, def } = this._terrainModifiers(midLng, midLat);

            // River crossing check: if the attacker crosses a river to reach the defender
            const riverSize = this.movementSystem.checkRiverCrossing(
              a.position_lng, a.position_lat,
              b.position_lng, b.position_lat,
            );
            if (riverSize && !is_meeting) {
              atk = RIVER_PENALTY_MAP[riverSize] ?? 1.0;
            }

            // Primary = first attacker to engage this specific defender
            const isPrimary = is_meeting || !Array.from(this.activePairs.values())
              .some(p => p.defender_id === defender_id && !p.is_meeting);

            const pair: ActivePair = {
              attacker_id,
              defender_id,
              is_meeting,
              terrain_mult_atk: atk,
              terrain_mult_def: def,
              round: 0,
              is_primary_attacker: isPrimary,
              flank_class: "none",
              river_crossing: riverSize,
              river_side_attacker: riverSize && !is_meeting ? attacker_id : "",
              engagement_id:       `${a.division_id}_vs_${b.division_id}_${Date.now()}`,
              round_tick_counter:  0,
              lethality_phase:      LETHALITY_PHASES[0].name,
              lethality_multiplier: LETHALITY_PHASES[0].multiplier,
              _lastDeltaAttacker:   [],
              _lastDeltaDefender:   [],
            };
            this.activePairs.set(key, pair);

            // Update division states
            a.combat_state = "engaged";
            b.combat_state = "engaged";

            if (!a.engaged_with.includes(b.division_id)) a.engaged_with.push(b.division_id);
            if (!b.engaged_with.includes(a.division_id)) b.engaged_with.push(a.division_id);

            a.attacker_role = is_meeting ? "meeting" : (a.division_id === attacker_id ? "attacker" : "defender");
            b.attacker_role = is_meeting ? "meeting" : (b.division_id === attacker_id ? "attacker" : "defender");

            changed.add(a.division_id);
            changed.add(b.division_id);

            broadcast("COMBAT_STARTED", {
              division_a:        a.division_id,
              division_b:        b.division_id,
              is_meeting_battle: pair.is_meeting,
              attacker_id:       pair.attacker_id,
            });

            // If this is a secondary attacker on the same defender, re-evaluate
            // all pairwise angles now that this division has joined the engagement
            if (!is_meeting && !isPrimary) {
              this._evaluateFlankingForDefender(defender_id, state, broadcast);
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _evaluateFlankingForDefender
  // Called when a new secondary attacker joins an engagement. Recomputes all
  // pairwise angles between every attacking division at the defender, finds the
  // maximum, and applies that single engagement-wide classification to all
  // secondary pairs. Locked at this instant per the spec — not re-evaluated
  // each tick or on position drift, only when another division joins or leaves.
  // ---------------------------------------------------------------------------

  private _evaluateFlankingForDefender(
    defenderId: string,
    state: GameRoomState,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const defender = state.divisions.get(defenderId);
    if (!defender) return;

    // All non-meeting pairs where this division is the defender
    const pairs = Array.from(this.activePairs.entries())
      .filter(([, p]) => p.defender_id === defenderId && !p.is_meeting);

    if (pairs.length < 2) return;

    const attackerIds = pairs.map(([, p]) => p.attacker_id);

    // Find the max pairwise angle across every combination of attackers
    let maxAngle = 0;
    let winnerA  = "";
    let winnerB  = "";

    for (let i = 0; i < attackerIds.length; i++) {
      for (let j = i + 1; j < attackerIds.length; j++) {
        const a = state.divisions.get(attackerIds[i]);
        const b = state.divisions.get(attackerIds[j]);
        if (!a || !b) continue;

        const toA_x = a.position_lng - defender.position_lng;
        const toA_y = a.position_lat - defender.position_lat;
        const toB_x = b.position_lng - defender.position_lng;
        const toB_y = b.position_lat - defender.position_lat;

        const lenA = Math.sqrt(toA_x ** 2 + toA_y ** 2);
        const lenB = Math.sqrt(toB_x ** 2 + toB_y ** 2);
        if (lenA === 0 || lenB === 0) continue;

        const dot   = (toA_x * toB_x + toA_y * toB_y) / (lenA * lenB);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

        if (angle > maxAngle) {
          maxAngle = angle;
          winnerA  = attackerIds[i];
          winnerB  = attackerIds[j];
        }
      }
    }

    const newClass: "none" | "flank" | "rear" =
      maxAngle >= REAR_ANGLE_MIN  ? "rear"  :
      maxAngle >= FLANK_ANGLE_MIN ? "flank" :
      "none";

    // Apply to all secondary pairs; fire event if classification upgraded
    let prevClass: "none" | "flank" | "rear" = "none";
    for (const [, pair] of pairs) {
      if (pair.is_primary_attacker) continue;
      if (prevClass === "none") prevClass = pair.flank_class;
      pair.flank_class = newClass;
    }

    if (newClass !== "none" && newClass !== prevClass) {
      broadcast(newClass === "rear" ? "REAR_ATTACK" : "FLANK_ATTACK", {
        defender_id: defenderId,
        attacker_a:  winnerA,
        attacker_b:  winnerB,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // _resolveCombat
  // ---------------------------------------------------------------------------

  private _resolveCombat(
    state: GameRoomState,
    changed: Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    this._resolveCombatTickCount++;
    // Single pass using keyed iteration so we can recover division IDs for all pair types
    for (const [key, pair] of this.activePairs) {
      let divA: DivisionState | undefined;
      let divB: DivisionState | undefined;

      if (pair.is_meeting) {
        // attacker_id / defender_id are both "" for meeting battles — recover from key
        const [idA, idB] = key.split("|");
        divA = state.divisions.get(idA);
        divB = state.divisions.get(idB);
      } else {
        divA = state.divisions.get(pair.attacker_id);
        divB = state.divisions.get(pair.defender_id);
      }

      if (!divA || !divB) continue;
      if (divA.combat_state === "destroyed" || divA.combat_state === "retreating") continue;
      if (divB.combat_state === "destroyed" || divB.combat_state === "retreating") continue;

      // Re-check river crossing every tick (reposition may have changed positions)
      this._updateRiverCrossing(pair, divA, divB);

      // ── Round gate: only resolve damage at round boundary ────────────────
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

      // Broadcast COMBAT_RESULT alongside ROUND_RESOLVED for strategic map UI
      broadcast("COMBAT_RESULT", {
        division_a:    divA.division_id,
        division_b:    divB.division_id,
        round:         roundNumber,
        hp_a:          divA.hp,
        hp_b:          divB.hp,
        suppression_a: divA.suppression,
        suppression_b: divB.suppression,
      });
      broadcast("ROUND_RESOLVED", {
        engagement_id:           pair.engagement_id,
        round_number:            roundNumber,
        lethality_phase:         pair.lethality_phase as any,
        attacker_grid_delta:     pair._lastDeltaAttacker,
        defender_grid_delta:     pair._lastDeltaDefender,
        formation_bonuses_active: [],
        xp_changes:              [],
      } satisfies RoundResolvedPayload);

      // Reset for next round
      pair._lastDeltaAttacker = [];
      pair._lastDeltaDefender = [];

      changed.add(pair.attacker_id);
      changed.add(pair.defender_id);
    }
  }

  // ── Per-cell helpers ─────────────────────────────────────────────────────────

  private _getBestPenValue(div: DivisionState): number {
    if (!div.grid) return 10;
    let best = 0;
    for (const cell of div.grid.cells) {
      if (cell.unit_type === "" || cell.incapacitated) continue;
      const stats = UNIT_COMBAT_STATS[cell.unit_type];
      if (stats && stats.pen > best) best = stats.pen;
    }
    return best > 0 ? best : 10;
  }

  private _decayCellSuppression(div: DivisionState, isRetreating: boolean): void {
    if (!div.grid) return;
    const decay = isRetreating ? CELL_SUPP_DECAY_RETREAT : CELL_SUPP_DECAY_BASE;
    for (const cell of div.grid.cells) {
      if (cell.unit_type === "") continue;
      cell.suppression = Math.max(0, cell.suppression - decay);
    }
  }

  private _computeDivisionHp(cells: GridCellState[]): number {
    const occupied = cells.filter(c => c.unit_type !== "");
    if (occupied.length === 0) return 100;
    return occupied.reduce((sum, c) => sum + c.hp, 0) / occupied.length;
  }

  private _applyPerCellDamage(
    attacker: DivisionState,
    defender: DivisionState,
    rawDamage: number,
    pair: ActivePair,
    broadcast: (type: string, msg: unknown) => void,
  ): GridCellDelta[] {
    if (!defender.grid) return [];

    const eligibleCells = defender.grid.cells
      .map((cell, idx) => ({ cell, idx }))
      .filter(({ cell }) => cell.unit_type !== "" && !cell.incapacitated);

    if (eligibleCells.length === 0) return [];

    const attackerPen    = this._getBestPenValue(attacker);
    const perCellHpDmg   = (rawDamage * HP_DAMAGE_FRACTION)   / eligibleCells.length;
    const perCellSuppDmg = (rawDamage * SUPPRESSION_FRACTION) / eligibleCells.length;
    const deltas: GridCellDelta[] = [];

    for (const { cell, idx } of eligibleCells) {
      const stats    = UNIT_COMBAT_STATS[cell.unit_type];
      const penMult  = _armorPenMultiplier(attackerPen, stats?.armour ?? 0);
      const hpDelta  = perCellHpDmg * penMult;

      cell.hp          = Math.max(0, cell.hp - hpDelta);
      cell.suppression = Math.min(100, cell.suppression + perCellSuppDmg);

      const floor = _getIncapFloor(cell.unit_type);
      if (floor > 0 && cell.hp <= floor && !cell.incapacitated) {
        cell.incapacitated = true;
        broadcast("UNIT_INCAPACITATED", {
          engagement_id: pair.engagement_id,
          division_id:   defender.division_id,
          cell_index:    idx,
          unit_type:     cell.unit_type as UnitTypeValue,
          xp_retained:   0,
        } satisfies UnitIncapacitatedPayload);
      }

      deltas.push({
        cell_index:    idx,
        hp:            cell.hp,
        suppression:   cell.suppression,
        incapacitated: cell.incapacitated,
      });
    }

    return deltas;
  }

  // Helper: apply bidirectional damage between two divisions in a pair
  private _applyDamage(
    divA: DivisionState,
    divB: DivisionState,
    pair: ActivePair,
    state: GameRoomState,
    changed: Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const computeDamage = (attacker: DivisionState, _defender: DivisionState): number => {
      let dmg = BASE_ATTRITION * (attacker.hp / 100) * (TYPE_MULT[attacker.division_type] ?? 1.0);

      // Terrain modifier
      if (!pair.is_meeting) {
        if (attacker.division_id === pair.attacker_id) {
          dmg *= pair.terrain_mult_atk;
        } else {
          // defender hitting back
          dmg *= pair.terrain_mult_def;
        }
      }
      // Flanking bonus: applies to the attacker in a secondary pair (non-primary, non-meeting)
      if (!pair.is_primary_attacker && !pair.is_meeting && attacker.division_id === pair.attacker_id) {
        if (pair.flank_class === "rear") {
          dmg *= REAR_BONUS;
        } else if (pair.flank_class === "flank") {
          dmg *= FLANK_BONUS;
        }
      }

      // Lethality multiplier (force recon units bypass the ramp)
      if (!this._divisionHasForceReconUnit(attacker, state)) {
        dmg *= pair.lethality_multiplier;
      }

      return dmg;
    };

    // Suppressed divisions cannot attack — they are pinned and deal zero outgoing damage
    const damageByA = divA.combat_state === "suppressed" ? 0 : computeDamage(divA, divB);
    const damageByB = divB.combat_state === "suppressed" ? 0 : computeDamage(divB, divA);

    if (this._resolveCombatTickCount % 10 === 0) {
      console.log(`[Combat] DAMAGE: ${divA.division_id}(hp=${divA.hp.toFixed(1)}) ↔ ${divB.division_id}(hp=${divB.hp.toFixed(1)})`);
    }

    // Per-cell damage (returns deltas for ROUND_RESOLVED; stored on pair for collection)
    this._decayCellSuppression(divB, divB.combat_state === "retreating");
    const deltasB = this._applyPerCellDamage(divA, divB, damageByA, pair, broadcast);
    this._decayCellSuppression(divA, divA.combat_state === "retreating");
    const deltasA = this._applyPerCellDamage(divB, divA, damageByB, pair, broadcast);

    // Recompute division-level aggregates from cell data
    divB.hp           = this._computeDivisionHp(divB.grid?.cells ?? []);
    divB.suppression  = _computeDivisionSuppression(divB.grid?.cells ?? []);
    divA.hp           = this._computeDivisionHp(divA.grid?.cells ?? []);
    divA.suppression  = _computeDivisionSuppression(divA.grid?.cells ?? []);

    // Store deltas on pair so _resolveCombat can include them in ROUND_RESOLVED
    pair._lastDeltaAttacker = deltasA;
    pair._lastDeltaDefender = deltasB;

    changed.add(divA.division_id);
    changed.add(divB.division_id);

    // ── Auto-retreat checks ──────────────────────────────────────────────────
    const enemies = (div: DivisionState): DivisionState[] => {
      const result: DivisionState[] = [];
      for (const eid of div.engaged_with) {
        const e = state.divisions.get(eid);
        if (e) result.push(e);
      }
      return result;
    };

    if (pair.is_meeting) {
      this._checkAutoRetreatOrRotate(divA, DEFENDER_SUPPRESS_THRESHOLD, enemies(divA), state, changed, broadcast);
      this._checkAutoRetreatOrRotate(divB, DEFENDER_SUPPRESS_THRESHOLD, enemies(divB), state, changed, broadcast);
    } else {
      const defender = divA.division_id === pair.defender_id ? divA : divB;
      const attacker = divA.division_id === pair.attacker_id ? divA : divB;

      this._checkAutoRetreatOrRotate(defender, DEFENDER_SUPPRESS_THRESHOLD, enemies(defender), state, changed, broadcast);
      this._checkAutoRetreatOrRotate(attacker, ATTACKER_SUPPRESS_THRESHOLD, enemies(attacker), state, changed, broadcast);
    }
  }

  private _divisionHasForceReconUnit(div: DivisionState, state: GameRoomState): boolean {
    if (!div.grid) return false;
    return div.grid.cells.some(
      cell => !cell.incapacitated && FORCE_RECON_UNIT_TYPES.has(cell.unit_type)
    );
  }

  // ---------------------------------------------------------------------------
  // _checkRetreatCompletion — transitions retreating → idle when move order empties
  // ---------------------------------------------------------------------------

  private _checkRetreatCompletion(state: GameRoomState, changed: Set<string>): void {
    for (const [, div] of state.divisions) {
      if (div.combat_state === "retreating" && div.move_order.length === 0) {
        div.combat_state = "idle";
        changed.add(div.division_id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _checkDisengagement
  // ---------------------------------------------------------------------------

  private _checkDisengagement(state: GameRoomState, changed: Set<string>): void {
    const toRemove: string[] = [];

    for (const [key, pair] of this.activePairs) {
      const [idA, idB] = key.split("|");
      const divA = state.divisions.get(idA);
      const divB = state.divisions.get(idB);
      if (!divA || !divB) { toRemove.push(key); continue; }

      const distKm      = this._distKm(divA.position_lng, divA.position_lat, divB.position_lng, divB.position_lat);
      const softThreshold = divA.engagement_radius + divB.engagement_radius; // engagement circle edge
      const hardThreshold = softThreshold * 1.2;                              // 20% disengagement hysteresis

      if (distKm > softThreshold && distKm <= hardThreshold) {
        // In the buffer zone: past the engagement edge but not yet disengaging.
        // Block further reposition — the division cannot repos beyond the circle.
        if (divA.reposition_order.length > 0 || divB.reposition_order.length > 0) {
          divA.reposition_order.splice(0, divA.reposition_order.length);
          divB.reposition_order.splice(0, divB.reposition_order.length);
          changed.add(divA.division_id);
          changed.add(divB.division_id);
        }
      }

      if (distKm > hardThreshold) {
        // Disengage both
        for (const div of [divA, divB]) {
          if (div.combat_state === "engaged" || div.combat_state === "suppressed") {
            div.combat_state  = "idle";
            div.attacker_role = "";
            div.engaged_with.splice(0, div.engaged_with.length);
            div.reposition_order.splice(0, div.reposition_order.length);
            changed.add(div.division_id);
          }
        }
        toRemove.push(key);
      }
    }

    for (const key of toRemove) this.activePairs.delete(key);
  }

  // ---------------------------------------------------------------------------
  // _checkProvinceCapture
  // ---------------------------------------------------------------------------

  private _checkProvinceCapture(
    state: GameRoomState,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const divList = Array.from(state.divisions.entries()).map(([, div]) => div);

    for (const div of divList) {
      if (div.combat_state === "retreating" || div.combat_state === "destroyed") continue;

      for (const [province_id, prov] of this.provinces) {
        const stateProvince = state.provinces.get(province_id);
        if (!stateProvince) continue;
        if (stateProvince.owner_id === div.nation_id) continue;

        // Must be physically inside the province polygon
        if (!this._inProvince(div.position_lng, div.position_lat, prov)) continue;

        // Capture is contested only if an enemy is physically at the city (within CONTEST_RADIUS_KM).
        // Using engagement_radius (50 km) was too strict — any frontline unit blocked every nearby city.
        let contested = false;
        for (const enemy of divList) {
          if (enemy.nation_id === div.nation_id) continue;
          if (enemy.combat_state === "destroyed") continue;
          const enemyToCity = this._distKm(enemy.position_lng, enemy.position_lat, prov.city_lng, prov.city_lat);
          if (enemyToCity <= CONTEST_RADIUS_KM) {
            contested = true;
            break;
          }
        }
        if (contested) continue;

        // Capture
        stateProvince.owner_id = div.nation_id;
        broadcast("PROVINCE_CAPTURED", {
          province_id,
          new_owner_id:  div.nation_id,
          captured_by:   div.division_id,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _decaySuppression
  // ---------------------------------------------------------------------------

  private _decaySuppression(state: GameRoomState): void {
    for (const [, div] of state.divisions) {
      if (div.combat_state === "retreating") {
        div.suppression = Math.max(0, div.suppression - SUPPRESS_DECAY_RETREAT);
      } else if (div.combat_state === "idle") {
        div.suppression = Math.max(0, div.suppression - SUPPRESS_DECAY_IDLE);
      }
      // "engaged" and "suppressed" divisions do NOT decay suppression
    }
  }

  // ---------------------------------------------------------------------------
  // _handleDestroyed
  // ---------------------------------------------------------------------------

  private _handleDestroyed(
    state: GameRoomState,
    changed: Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const pairsToRemove: string[] = [];

    for (const [, div] of state.divisions) {
      if (div.hp <= 0 && div.combat_state !== "destroyed") {
        div.combat_state = "destroyed";
        div.move_order.splice(0, div.move_order.length);
        div.reposition_order.splice(0, div.reposition_order.length);
        div.engaged_with.splice(0, div.engaged_with.length);

        // Remove any active pairs involving this division
        for (const [key] of this.activePairs) {
          const [idA, idB] = key.split("|");
          if (idA === div.division_id || idB === div.division_id) {
            pairsToRemove.push(key);
          }
        }

        broadcast("UNIT_DESTROYED", {
          division_id: div.division_id,
          nation_id:   div.nation_id,
        });
        changed.add(div.division_id);
      }
    }

    // Clear reposition_order on opponents of destroyed divisions
    for (const key of pairsToRemove) {
      const [idA, idB] = key.split("|");
      for (const oppId of [idA, idB]) {
        const opp = state.divisions.get(oppId);
        if (opp && opp.combat_state !== "destroyed") {
          opp.reposition_order.splice(0, opp.reposition_order.length);
        }
      }
    }

    for (const key of pairsToRemove) this.activePairs.delete(key);
  }

  // ---------------------------------------------------------------------------
  // _initiateRetreat
  // ---------------------------------------------------------------------------

  /** Public — called by GameRoom for manual RETREAT commands. */
  initiateRetreat(
    div:       DivisionState,
    enemies:   DivisionState[],
    state:     GameRoomState,
    changed:   Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    this._initiateRetreat(div, enemies, state, changed, broadcast);
  }

  private _initiateRetreat(
    div:       DivisionState,
    enemies:   DivisionState[],
    state:     GameRoomState,
    changed:   Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    if (div.combat_state === "retreating" || div.combat_state === "destroyed") return;

    div.combat_state = "retreating";
    div.engaged_with.splice(0, div.engaged_with.length);
    div.attacker_role = "";
    div.reposition_order.splice(0, div.reposition_order.length);

    // Compute enemy centroid
    let centroidLng = 0;
    let centroidLat = 0;
    if (enemies.length > 0) {
      for (const e of enemies) {
        centroidLng += e.position_lng;
        centroidLat += e.position_lat;
      }
      centroidLng /= enemies.length;
      centroidLat /= enemies.length;
    } else {
      // No known enemies — stay put
      return;
    }

    // Retreat direction: away from centroid, 20 km
    const dx = div.position_lng - centroidLng;
    const dy = div.position_lat - centroidLat;
    const len = Math.sqrt(dx * dx + dy * dy);

    let retreatLng: number;
    let retreatLat: number;

    if (len === 0) {
      // Directly on centroid — pick arbitrary direction
      retreatLng = div.position_lng;
      retreatLat = div.position_lat + (50 / KM_PER_DEG);
    } else {
      const retreatKm    = 50;
      const retreatDeg   = retreatKm / KM_PER_DEG;
      retreatLng = div.position_lng + (dx / len) * retreatDeg;
      retreatLat = div.position_lat + (dy / len) * retreatDeg;
    }

    // Collect opponent IDs before deleting pairs, then reset after
    const opponentIds: string[] = [];
    const pairsToRemove: string[] = [];
    for (const [key] of this.activePairs) {
      const [idA, idB] = key.split("|");
      if (idA === div.division_id || idB === div.division_id) {
        pairsToRemove.push(key);
        opponentIds.push(idA === div.division_id ? idB : idA);
      }
    }
    for (const key of pairsToRemove) this.activePairs.delete(key);

    // Reset each opponent that is no longer in any remaining active pair.
    // Don't reset opponents that are already suppressed — they will retreat on their own
    // on the next tick (clearing their engaged_with would break their retreat flow).
    for (const opponentId of opponentIds) {
      const stillEngaged = Array.from(this.activePairs.keys())
        .some(k => k.startsWith(opponentId + "|") || k.endsWith("|" + opponentId));
      if (stillEngaged) continue;

      const opponent = state.divisions.get(opponentId);
      if (!opponent) continue;
      if (opponent.combat_state === "engaged") {
        opponent.combat_state  = "idle";
        opponent.attacker_role = "";
        opponent.engaged_with.splice(0, opponent.engaged_with.length);
        opponent.reposition_order.splice(0, opponent.reposition_order.length);
        changed.add(opponentId);
        broadcast("COMBAT_ENDED", { winner_id: opponentId, retreated_id: div.division_id });
      } else if (opponent.combat_state === "suppressed") {
        // Suppressed opponent will retreat naturally on the next tick.
        // Broadcast COMBAT_ENDED now so the client knows, but don't reset
        // the opponent — its engaged_with is needed for retreat direction.
        opponent.reposition_order.splice(0, opponent.reposition_order.length);
        broadcast("COMBAT_ENDED", { winner_id: opponentId, retreated_id: div.division_id });
      }
      // Opponents in "suppressed" state will retreat on their own next tick;
      // don't interfere — their retreat direction depends on engaged_with.
    }

    // Find nearest waypoint and set as retreat target
    const waypoint = this.movementSystem.getNearestNonNeutralWaypoint(retreatLng, retreatLat, div.nation_id, state.relations);
    if (waypoint) {
      div.move_order.splice(0, div.move_order.length);
      div.move_order.push(waypoint.id);
    }
    // If null (no waypoints loaded), division stops in place
  }

  // ---------------------------------------------------------------------------
  // _terrainModifiers
  // ---------------------------------------------------------------------------

  private _updateRiverCrossing(pair: ActivePair, a: DivisionState, b: DivisionState): void {
    if (pair.is_meeting) return;
    const riverSize = this.movementSystem.checkRiverCrossing(
      a.position_lng, a.position_lat,
      b.position_lng, b.position_lat,
    );
    pair.river_crossing = riverSize;
    pair.river_side_attacker = riverSize ? pair.attacker_id : "";
    if (riverSize) {
      pair.terrain_mult_atk = RIVER_PENALTY_MAP[riverSize] ?? 1.0;
    }
  }

  private _terrainModifiers(midLng: number, midLat: number): { atk: number; def: number } {
    const prov = this._nearestProvince(midLng, midLat);
    if (!prov) return { atk: 1.0, def: 1.0 };

    const [elevPenalty, elevBonus] = ELEV_MOD[prov.elevation] ?? [0, 0];
    const [coverPenalty, coverBonus] = COVER_MOD[prov.cover]    ?? [0, 0];

    const atk = Math.max(0.3, 1.0 - elevPenalty - coverPenalty);
    const def = 1.0 + elevBonus + coverBonus;

    return { atk, def };
  }

  // ---------------------------------------------------------------------------
  // _nearestProvince — O(n) scan by squared degree distance to city position
  // ---------------------------------------------------------------------------

  private _nearestProvince(lng: number, lat: number): ProvinceInfo | null {
    let best: ProvinceInfo | null = null;
    let bestDist = Infinity;

    for (const prov of this.provinces.values()) {
      const dx = prov.city_lng - lng;
      const dy = prov.city_lat - lat;
      const d  = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = prov; }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // _distKm — simple Euclidean distance in km (no cosine correction, matches movement_system)
  // ---------------------------------------------------------------------------

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG;
  }

  // ---------------------------------------------------------------------------
  // _checkAutoRetreatOrRotate
  // For stacked divisions: rotate if stack_position == 0 hits STACK_ROTATE_THRESHOLD.
  // The last stack member (highest position) follows normal retreat rules.
  // ---------------------------------------------------------------------------

  private _checkAutoRetreatOrRotate(
    div:       DivisionState,
    threshold: number,
    enemies:   DivisionState[],
    state:     GameRoomState,
    changed:   Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    if (div.suppression < threshold) return;

    // Encircled divisions cannot retreat — they are trapped
    if (div.supply_status === "encircled") return;

    // First time threshold is crossed: mark as "suppressed" for one tick so the
    // client can display the intermediate state before the retreat fires.
    if (div.combat_state === "engaged") {
      div.combat_state = "suppressed";
      return;
    }

    // Already suppressed — now initiate retreat or stack rotation.
    if (!div.stack_id) {
      // Not stacked — normal auto-retreat
      this._initiateRetreat(div, enemies, state, changed, broadcast);
      return;
    }

    // Find all divisions in this stack, ordered by position
    const stackMembers = Array.from(state.divisions.values())
      .filter(d => d.stack_id === div.stack_id && d.combat_state !== "destroyed")
      .sort((a, b) => a.stack_position - b.stack_position);

    if (stackMembers.length <= 1) {
      // Solo stack member — just retreat
      this._initiateRetreat(div, enemies, state, changed, broadcast);
      return;
    }

    const maxPos = stackMembers[stackMembers.length - 1].stack_position;

    if (div.stack_position === maxPos) {
      // Last member hits threshold — actual retreat for the whole stack front
      this._initiateRetreat(div, enemies, state, changed, broadcast);
      return;
    }

    // Rotate: current front (position 0) → last position; rest shift forward
    const oldPos = div.stack_position;
    for (const member of stackMembers) {
      if (member.stack_position > oldPos) {
        member.stack_position -= 1;
      }
    }
    div.stack_position = maxPos;

    broadcast("STACK_ROTATION", {
      stack_id:     div.stack_id,
      rotated_back: div.division_id,
      new_front:    stackMembers.find(m => m.stack_position === 0)?.division_id ?? "",
    });
  }

  // ---------------------------------------------------------------------------
  // _detectStacks — form permanent positional stacks from same-nation stationary pairs
  // ---------------------------------------------------------------------------

  private _detectStacks(
    state:     GameRoomState,
    changed:   Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const divList = Array.from(state.divisions.values()).filter(
      d => d.combat_state !== "destroyed" && d.move_order.length === 0,
    );

    for (let i = 0; i < divList.length; i++) {
      for (let j = i + 1; j < divList.length; j++) {
        const a = divList[i];
        const b = divList[j];

        if (a.nation_id !== b.nation_id) continue;
        if (a.stack_id && b.stack_id && a.stack_id === b.stack_id) continue; // already stacked together

        const dist = this._distKm(a.position_lng, a.position_lat, b.position_lng, b.position_lat);
        if (dist > STACK_THRESHOLD_KM) continue;

        // Merge into a stack
        if (!a.stack_id && !b.stack_id) {
          // New stack
          const sid = randomUUID();
          a.stack_id = sid; a.stack_position = 0;
          b.stack_id = sid; b.stack_position = 1;
          changed.add(a.division_id);
          changed.add(b.division_id);
          broadcast("STACK_FORMED", {
            stack_id:  sid,
            divisions: [a.division_id, b.division_id],
          });
        } else if (a.stack_id && !b.stack_id) {
          // Add b to a's stack
          const maxPos = this._stackMaxPosition(a.stack_id, state);
          b.stack_id       = a.stack_id;
          b.stack_position = maxPos + 1;
          changed.add(b.division_id);
        } else if (b.stack_id && !a.stack_id) {
          const maxPos = this._stackMaxPosition(b.stack_id, state);
          a.stack_id       = b.stack_id;
          a.stack_position = maxPos + 1;
          changed.add(a.division_id);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _dissolveInvalidStacks — remove divisions from stacks when they start moving
  // ---------------------------------------------------------------------------

  private _dissolveInvalidStacks(
    state:     GameRoomState,
    changed:   Set<string>,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    const toDissolve = new Map<string, DivisionState[]>(); // stackId → members leaving

    for (const [, div] of state.divisions) {
      if (!div.stack_id) continue;
      if (div.combat_state === "destroyed") continue;
      if (div.move_order.length > 0) {
        // This division started moving — remove from stack
        if (!toDissolve.has(div.stack_id)) toDissolve.set(div.stack_id, []);
        toDissolve.get(div.stack_id)!.push(div);
      }
    }

    for (const [stackId, leavers] of toDissolve) {
      for (const leaving of leavers) {
        leaving.stack_id = "";
        leaving.stack_position = 0;
        changed.add(leaving.division_id);
      }

      // Renumber remaining members from 0 upward
      const remaining = Array.from(state.divisions.values())
        .filter(d => d.stack_id === stackId && d.combat_state !== "destroyed")
        .sort((a, b) => a.stack_position - b.stack_position);

      if (remaining.length === 1) {
        // Only one left — dissolve the stack entirely
        remaining[0].stack_id = "";
        remaining[0].stack_position = 0;
        changed.add(remaining[0].division_id);
        broadcast("STACK_DISSOLVED", { stack_id: stackId });
      } else if (remaining.length > 1) {
        remaining.forEach((d, idx) => {
          d.stack_position = idx;
          changed.add(d.division_id);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _stackMaxPosition — highest stack_position among live members of a stack
  // ---------------------------------------------------------------------------

  private _stackMaxPosition(stackId: string, state: GameRoomState): number {
    let max = -1;
    for (const [, div] of state.divisions) {
      if (div.stack_id === stackId && div.combat_state !== "destroyed") {
        if (div.stack_position > max) max = div.stack_position;
      }
    }
    return max;
  }

  // ---------------------------------------------------------------------------
  // reorderStack — called by GameRoom for REORDER_STACK command
  // ---------------------------------------------------------------------------

  /** Reorder divisions within a stack. newOrder is an array of division_ids, index = new position. */
  reorderStack(
    stackId:  string,
    newOrder: string[],
    state:    GameRoomState,
    broadcast: (type: string, msg: unknown) => void,
  ): boolean {
    const members = Array.from(state.divisions.values()).filter(
      d => d.stack_id === stackId && d.combat_state !== "destroyed",
    );

    if (members.length !== newOrder.length) return false;

    // Validate all IDs belong to this stack
    const memberIds = new Set(members.map(m => m.division_id));
    if (!newOrder.every(id => memberIds.has(id))) return false;

    // Check that no stack member is currently engaged (can't reorder mid-combat)
    if (members.some(m => m.combat_state === "engaged")) return false;

    // Apply new order
    for (let i = 0; i < newOrder.length; i++) {
      const div = state.divisions.get(newOrder[i]);
      if (div) div.stack_position = i;
    }

    broadcast("STACK_REORDERED", { stack_id: stackId, new_order: newOrder });
    return true;
  }

  // ---------------------------------------------------------------------------
  // _pointInRing — ray-casting point-in-polygon test for one ring [lng, lat][]
  // ---------------------------------------------------------------------------

  private _pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (((yi > lat) !== (yj > lat)) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  private _inProvince(lng: number, lat: number, prov: ProvinceInfo): boolean {
    if (prov.polygons.length === 0) {
      // Fallback to city-distance if no polygon data available
      return this._distKm(lng, lat, prov.city_lng, prov.city_lat) <= CAPTURE_RADIUS_KM;
    }
    return prov.polygons.some(ring => this._pointInRing(lng, lat, ring));
  }

  // ---------------------------------------------------------------------------
  // _pairKey — stable sorted key for a pair of division IDs
  // ---------------------------------------------------------------------------

  private _pairKey(idA: string, idB: string): string {
    return [idA, idB].sort().join("|");
  }
}

export function _isGridLocked(division_id: string, state: GameRoomState): boolean {
  const div = state.divisions.get(division_id);
  if (!div) return false;
  return div.combat_state === "engaged"
    || div.combat_state === "suppressed"
    || div.combat_state === "retreating";
}
