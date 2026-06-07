import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

const KM_PER_DEG = 111.0;

// How many game ticks between full supply-status recalculation
const SUPPLY_TICK_INTERVAL = 5;

// Tier 1: division is OUT_OF_SUPPLY when farther than this from any friendly province city
const OOS_SUPPLY_RANGE_KM = 200;

// Tier 2: CUT_OFF requires Tier 1 AND no friendly division within this radius
const CUTOFF_BUDDY_RANGE_KM = 120;

// Tier 3: ENCIRCLED — sample points at MULT × engagement_radius from division centre;
// if BLOCKED_THRESHOLD of ENCIRCLE_DIRS are inside an enemy's engagement radius → encircled
const ENCIRCLE_SAMPLE_MULT      = 1.5;
const ENCIRCLE_DIRS             = 8;
const ENCIRCLE_BLOCKED_THRESHOLD = 7;  // 7 of 8 directions blocked

// HP drained every game tick (not supply tick) based on supply tier
const OOS_HP_DRAIN_PER_TICK       = 0.05;   // slow attrition out of supply
const CUTOFF_HP_DRAIN_PER_TICK    = 0.15;   // fighting-withdrawal cost
const ENCIRCLED_HP_DRAIN_PER_TICK = 0.35;   // rapid deterioration while fully encircled

// Status tiers in order of severity — degradation limited to one tier per supply tick
const TIER_ORDER = ["normal", "out_of_supply", "cut_off", "encircled"] as const;
type SupplyTier = typeof TIER_ORDER[number];

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceCity {
  city_lng:  number;
  city_lat:  number;
  nation_id: string; // initial owner (fallback when state.provinces has no entry)
}

// ─── SupplySystem ────────────────────────────────────────────────────────────

export class SupplySystem {
  private provinces = new Map<string, ProvinceCity>();

  // ---------------------------------------------------------------------------
  // loadMapData
  // ---------------------------------------------------------------------------

  loadMapData(mapId: string): void {
    const __dir    = dirname(fileURLToPath(import.meta.url));
    const dataPath = join(__dir, "../..", "..", "client", "assets", "data", mapId, "map_data.json");
    try {
      const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as {
        provinces: Array<{
          province_id:  string;
          nation_id:    string;
          city_position: [number, number];
        }>;
      };
      for (const p of raw.provinces ?? []) {
        if (!p.province_id || !p.city_position) continue;
        this.provinces.set(p.province_id, {
          city_lng:  p.city_position[0],
          city_lat:  p.city_position[1],
          nation_id: p.nation_id ?? "",
        });
      }
      console.log(`[SupplySystem] loaded ${this.provinces.size} province cities`);
    } catch {
      console.warn("[SupplySystem] map_data.json not found — supply checks disabled");
    }
  }

  // ---------------------------------------------------------------------------
  // tick — called every game tick from GameRoom
  // ---------------------------------------------------------------------------

  tick(
    state:      GameRoomState,
    tickCount:  number,
    broadcast:  (type: string, msg: unknown) => void,
  ): Set<string> {
    const changed = new Set<string>();

    if (tickCount === 1) {
      console.log(`[SupplySystem] first tick — provinces loaded: ${this.provinces.size}`);
    }
    if (tickCount % SUPPLY_TICK_INTERVAL === 0) {
      console.log(`[SupplySystem] supply tick ${tickCount} — checking ${Array.from(state.divisions.values()).filter(d => d.combat_state !== "destroyed").length} live divisions`);
    }

    // ── Per-tick HP drain based on current supply tier ──────────────────────
    for (const [, div] of state.divisions) {
      if (div.combat_state === "destroyed") continue;

      let drain = 0;
      if (div.supply_status === "out_of_supply") drain = OOS_HP_DRAIN_PER_TICK;
      else if (div.supply_status === "cut_off")    drain = CUTOFF_HP_DRAIN_PER_TICK;
      else if (div.supply_status === "encircled")  drain = ENCIRCLED_HP_DRAIN_PER_TICK;

      if (drain > 0) {
        div.hp = Math.max(0, div.hp - drain);
        changed.add(div.division_id);
      }
    }

    // ── Full status recalculation every N ticks ──────────────────────────────
    if (tickCount % SUPPLY_TICK_INTERVAL !== 0) return changed;

    const divList = Array.from(state.divisions.values());

    for (const div of divList) {
      if (div.combat_state === "destroyed") continue;

      const oldStatus = div.supply_status as SupplyTier;
      const computed  = this._computeStatus(div, divList, state) as SupplyTier;

      // Status can only degrade ONE tier per supply tick; can improve freely
      const oldTier      = TIER_ORDER.indexOf(oldStatus);
      const computedTier = TIER_ORDER.indexOf(computed);
      const newTier      = computedTier > oldTier ? oldTier + 1 : computedTier;
      const newStatus    = TIER_ORDER[newTier];

      if (newStatus === oldStatus) continue;

      div.supply_status = newStatus;
      changed.add(div.division_id);

      const evtNames: Record<string, string> = {
        out_of_supply: "OUT_OF_SUPPLY",
        cut_off:       "CUT_OFF",
        encircled:     "DIVISION_ENCIRCLED",
      };
      if (evtNames[newStatus]) {
        broadcast(evtNames[newStatus], {
          division_id:   div.division_id,
          nation_id:     div.nation_id,
          supply_status: newStatus,
        });
      } else if (newStatus === "normal") {
        broadcast("SUPPLY_RESTORED", {
          division_id: div.division_id,
          nation_id:   div.nation_id,
        });
      }

      console.log(`[SupplySystem] ${div.division_id}: ${oldStatus} → ${newStatus}`);
    }

    return changed;
  }

  // ---------------------------------------------------------------------------
  // _computeStatus
  // ---------------------------------------------------------------------------

  private _computeStatus(
    div:      DivisionState,
    divList:  DivisionState[],
    state:    GameRoomState,
  ): string {
    // Tier 1: distance to nearest friendly-owned province city
    const nearestKm = this._nearestFriendlyProvinceKm(
      div.nation_id, div.position_lng, div.position_lat, state,
    );
    if (nearestKm <= OOS_SUPPLY_RANGE_KM) return "normal";

    // Tier 2: any friendly division within range?
    const hasBuddy = divList.some(
      d => d.division_id !== div.division_id
        && d.nation_id   === div.nation_id
        && d.combat_state !== "destroyed"
        && this._distKm(
             div.position_lng, div.position_lat,
             d.position_lng,   d.position_lat,
           ) <= CUTOFF_BUDDY_RANGE_KM,
    );
    if (hasBuddy) return "out_of_supply";

    // Tier 3: geometric encirclement check
    if (this._isEncircled(div, divList)) return "encircled";

    return "cut_off";
  }

  // ---------------------------------------------------------------------------
  // _nearestFriendlyProvinceKm
  // ---------------------------------------------------------------------------

  private _nearestFriendlyProvinceKm(
    nationId: string,
    lng: number,
    lat: number,
    state: GameRoomState,
  ): number {
    let best = Infinity;
    for (const [provinceId, prov] of this.provinces) {
      // Use live owner from state if available, otherwise fall back to initial owner
      const stateProvince = state.provinces.get(provinceId);
      const ownerId = stateProvince ? stateProvince.owner_id : prov.nation_id;
      if (ownerId !== nationId) continue;

      const d = this._distKm(lng, lat, prov.city_lng, prov.city_lat);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // _isEncircled — sample 8 directions; count those blocked by enemy divisions
  // ---------------------------------------------------------------------------

  private _isEncircled(div: DivisionState, divList: DivisionState[]): boolean {
    const sampleRadiusDeg = (div.engagement_radius * ENCIRCLE_SAMPLE_MULT) / KM_PER_DEG;
    const enemies = divList.filter(
      d => d.nation_id !== div.nation_id && d.combat_state !== "destroyed",
    );

    let blockedCount = 0;
    for (let i = 0; i < ENCIRCLE_DIRS; i++) {
      const angle    = (2 * Math.PI * i) / ENCIRCLE_DIRS;
      const sampleLng = div.position_lng + Math.cos(angle) * sampleRadiusDeg;
      const sampleLat = div.position_lat + Math.sin(angle) * sampleRadiusDeg;

      for (const enemy of enemies) {
        const distToEnemy = this._distKm(sampleLng, sampleLat, enemy.position_lng, enemy.position_lat);
        if (distToEnemy <= enemy.engagement_radius) {
          blockedCount++;
          break;
        }
      }
    }

    return blockedCount >= ENCIRCLE_BLOCKED_THRESHOLD;
  }

  // ---------------------------------------------------------------------------
  // _distKm — matches movement_system / combat_system
  // ---------------------------------------------------------------------------

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG;
  }
}
