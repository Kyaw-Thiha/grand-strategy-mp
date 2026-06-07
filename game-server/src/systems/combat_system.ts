import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";
import type { MovementSystem } from "./movement_system.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

// Kilometres represented by one degree of lat/lng (approximate, matches movement_system)
const KM_PER_DEG = 111.0;

// Raw outgoing damage per combat tick at full HP, before all modifiers
const BASE_ATTRITION = 2.5;
// Fraction of dealt damage that goes to the HP pool
const HP_DAMAGE_FRACTION = 0.3;
// Fraction of dealt damage that goes to the suppression pool
const SUPPRESSION_FRACTION = 0.7;

// Damage output multiplier by division type
const TYPE_MULT: Record<string, number> = {
  armoured:  1.4,
  motorised: 1.2,
  infantry:  1.0,
};

// Suppression level at which a defender (or meeting-battle participant) auto-retreats
const DEFENDER_SUPPRESS_THRESHOLD = 60;
// Suppression level at which an attacker auto-retreats
const ATTACKER_SUPPRESS_THRESHOLD = 80;

// Suppression recovered per tick while idle
const SUPPRESS_DECAY_IDLE = 1.5;
// Suppression recovered per tick while retreating
const SUPPRESS_DECAY_RETREAT = 3.5;

// Division must be within this radius of a city to contest/capture it
const CAPTURE_RADIUS_KM = 15.0;

// Angle thresholds for flanking classification (relative to primary attacker vector)
const FLANK_ANGLE_MIN = Math.PI / 2;          // 90° — counts as flank
const REAR_ANGLE_MIN  = (3 * Math.PI) / 4;   // 135° — counts as rear
// Damage multiplier applied to a secondary attacker when flanking
const FLANK_BONUS = 1.25;
// Damage multiplier applied to a secondary attacker when hitting the rear
const REAR_BONUS  = 1.50;

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

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceInfo {
  city_lng: number;
  city_lat: number;
  elevation: string;
  cover: string;
}

interface ActivePair {
  attacker_id: string;  // "" in meeting battle
  defender_id: string;  // "" in meeting battle
  is_meeting: boolean;
  terrain_mult_atk: number; // multiplier on attacker outgoing damage (≤ 1.0 = penalty)
  terrain_mult_def: number; // multiplier on defender outgoing damage (≥ 1.0 = bonus)
  round: number;
  flanked_by: Map<string, "flank" | "rear">; // secondary attacker id → classification
}

// ─── CombatSystem ────────────────────────────────────────────────────────────

export class CombatSystem {
  private provinces  = new Map<string, ProvinceInfo>();
  private activePairs = new Map<string, ActivePair>(); // sorted "idA|idB" → data
  private movementSystem: MovementSystem;

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
    broadcast: (type: string, msg: unknown) => void,
  ): Set<string> {
    const changed = new Set<string>();
    this._handleDestroyed(state, changed, broadcast);
    this._detectEngagements(state, changed, broadcast);
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
        if (a.combat_state === "destroyed" || b.combat_state === "destroyed") continue;

        // Skip if they are already mutually engaged in activePairs
        const key = this._pairKey(a.division_id, b.division_id);
        const distKm = this._distKm(
          a.position_lng, a.position_lat,
          b.position_lng, b.position_lat,
        );
        const engageRange = a.engagement_radius + b.engagement_radius;

        if (distKm <= engageRange) {
          if (!this.activePairs.has(key)) {
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
            const { atk, def } = this._terrainModifiers(midLng, midLat);

            const pair: ActivePair = {
              attacker_id,
              defender_id,
              is_meeting,
              terrain_mult_atk: atk,
              terrain_mult_def: def,
              round: 0,
              flanked_by: new Map(),
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

          } else {
            // ── Existing engagement — check for new flankers ────────────────
            const pair = this.activePairs.get(key)!;
            if (pair.is_meeting) continue; // no flank tracking in meeting battles

            // Only track flanks on the defender
            const defenderId  = pair.defender_id;
            const attackerId  = pair.attacker_id;
            if (!defenderId || !attackerId) continue;

            const defender = state.divisions.get(defenderId);
            const attacker = state.divisions.get(attackerId);
            if (!defender || !attacker) continue;

            // Look for a third division engaged with the defender that is NOT the original attacker
            for (const div of divList) {
              if (div.division_id === attackerId) continue;
              if (div.division_id === defenderId) continue;
              if (div.nation_id === defender.nation_id) continue;
              if (div.combat_state === "destroyed") continue;
              if (!div.engaged_with.includes(defenderId)) continue;
              if (pair.flanked_by.has(div.division_id)) continue;

              // Compute angle at defender between original attacker direction and new attacker direction
              const toOrigAtk_x = attacker.position_lng - defender.position_lng;
              const toOrigAtk_y = attacker.position_lat - defender.position_lat;
              const toNewAtk_x  = div.position_lng - defender.position_lng;
              const toNewAtk_y  = div.position_lat - defender.position_lat;

              const lenOrig = Math.sqrt(toOrigAtk_x ** 2 + toOrigAtk_y ** 2);
              const lenNew  = Math.sqrt(toNewAtk_x  ** 2 + toNewAtk_y  ** 2);
              if (lenOrig === 0 || lenNew === 0) continue;

              const dot   = (toOrigAtk_x * toNewAtk_x + toOrigAtk_y * toNewAtk_y) / (lenOrig * lenNew);
              const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

              let classification: "flank" | "rear";
              let eventType: string;

              if (angle >= REAR_ANGLE_MIN) {
                classification = "rear";
                eventType = "REAR_ATTACK";
              } else if (angle >= FLANK_ANGLE_MIN) {
                classification = "flank";
                eventType = "FLANK_ATTACK";
              } else {
                continue; // not a flank angle
              }

              pair.flanked_by.set(div.division_id, classification);
              broadcast(eventType, {
                flanker_id:  div.division_id,
                defender_id: defenderId,
                attacker_id: attackerId,
              });
            }
          }
        }
      }
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

      this._applyDamage(divA, divB, pair, state, changed, broadcast);
      pair.round++;
    }
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
      // Flanking bonus (is this attacker a secondary flanker of the defender?)
      const flankClass = pair.flanked_by.get(attacker.division_id);
      if (flankClass === "rear") {
        dmg *= REAR_BONUS;
      } else if (flankClass === "flank") {
        dmg *= FLANK_BONUS;
      }

      return dmg;
    };

    const damageByA = computeDamage(divA, divB);
    const damageByB = computeDamage(divB, divA);

    // Apply damage from A → B
    divB.hp           = Math.max(0, divB.hp           - damageByA * HP_DAMAGE_FRACTION);
    divB.suppression  = Math.min(100, divB.suppression + damageByA * SUPPRESSION_FRACTION);

    // Apply damage from B → A
    divA.hp           = Math.max(0, divA.hp           - damageByB * HP_DAMAGE_FRACTION);
    divA.suppression  = Math.min(100, divA.suppression + damageByB * SUPPRESSION_FRACTION);

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
      if (divA.suppression >= DEFENDER_SUPPRESS_THRESHOLD) this._initiateRetreat(divA, enemies(divA));
      if (divB.suppression >= DEFENDER_SUPPRESS_THRESHOLD) this._initiateRetreat(divB, enemies(divB));
    } else {
      // Defender
      const defender = divA.division_id === pair.defender_id ? divA : divB;
      const attacker = divA.division_id === pair.attacker_id ? divA : divB;

      if (defender.suppression >= DEFENDER_SUPPRESS_THRESHOLD) this._initiateRetreat(defender, enemies(defender));
      if (attacker.suppression >= ATTACKER_SUPPRESS_THRESHOLD) this._initiateRetreat(attacker, enemies(attacker));
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

      const distKm    = this._distKm(divA.position_lng, divA.position_lat, divB.position_lng, divB.position_lat);
      const threshold = (divA.engagement_radius + divB.engagement_radius) * 1.2; // 20% hysteresis

      if (distKm > threshold) {
        // Disengage both
        for (const div of [divA, divB]) {
          if (div.combat_state === "engaged") {
            div.combat_state  = "idle";
            div.attacker_role = "";
            div.engaged_with.splice(0, div.engaged_with.length);
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

        // Must be within capture radius of the city
        const distToCity = this._distKm(div.position_lng, div.position_lat, prov.city_lng, prov.city_lat);
        if (distToCity > CAPTURE_RADIUS_KM) continue;

        // No enemy division must have engagement area overlapping the city
        let contested = false;
        for (const enemy of divList) {
          if (enemy.nation_id === div.nation_id) continue;
          if (enemy.combat_state === "destroyed") continue;
          const enemyToCity = this._distKm(enemy.position_lng, enemy.position_lat, prov.city_lng, prov.city_lat);
          if (enemyToCity <= enemy.engagement_radius) {
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
      // "engaged" divisions do NOT decay suppression
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

    for (const key of pairsToRemove) this.activePairs.delete(key);
  }

  // ---------------------------------------------------------------------------
  // _initiateRetreat
  // ---------------------------------------------------------------------------

  /** Public — called by GameRoom for manual RETREAT commands. */
  initiateRetreat(div: DivisionState, enemies: DivisionState[]): void {
    this._initiateRetreat(div, enemies);
  }

  private _initiateRetreat(div: DivisionState, enemies: DivisionState[]): void {
    if (div.combat_state === "retreating" || div.combat_state === "destroyed") return;

    div.combat_state = "retreating";
    div.engaged_with.splice(0, div.engaged_with.length);
    div.attacker_role = "";

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
      retreatLat = div.position_lat + (20 / KM_PER_DEG);
    } else {
      const retreatKm    = 20;
      const retreatDeg   = retreatKm / KM_PER_DEG;
      retreatLng = div.position_lng + (dx / len) * retreatDeg;
      retreatLat = div.position_lat + (dy / len) * retreatDeg;
    }

    // Remove all active pairs involving this division
    const pairsToRemove: string[] = [];
    for (const [key] of this.activePairs) {
      const [idA, idB] = key.split("|");
      if (idA === div.division_id || idB === div.division_id) {
        pairsToRemove.push(key);
      }
    }
    for (const key of pairsToRemove) this.activePairs.delete(key);

    // Find nearest waypoint and set as retreat target
    const waypoint = this.movementSystem.getNearestWaypoint(retreatLng, retreatLat);
    if (waypoint) {
      div.move_order.splice(0, div.move_order.length);
      div.move_order.push(waypoint.id);
    }
    // If null (no waypoints loaded), division stops in place
  }

  // ---------------------------------------------------------------------------
  // _terrainModifiers
  // ---------------------------------------------------------------------------

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
  // _pairKey — stable sorted key for a pair of division IDs
  // ---------------------------------------------------------------------------

  private _pairKey(idA: string, idB: string): string {
    return [idA, idB].sort().join("|");
  }
}
