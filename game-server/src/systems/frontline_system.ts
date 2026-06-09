import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { GameRoomState, DivisionState } from "../rooms/schema/GameRoomState.js";

// ─── Tunable constants ──────────────────────────────────────────────────────

const KM_PER_DEG = 111.0;

// How many game ticks between frontline recalculation (mirrors supply tick interval)
const FRONTLINE_TICK_INTERVAL = 5;

// Division influence falls to 0 beyond this distance from province city
const MAX_INFLUENCE_RANGE_KM = 150;

// Owning a province adds this much raw influence to the owner nation
const OWNERSHIP_BONUS = 0.5;

// ─── Internal types ─────────────────────────────────────────────────────────

interface ProvinceCity {
  city_lng: number;
  city_lat: number;
  nation_id: string; // initial owner (fallback)
}

// ─── FrontlineSystem ─────────────────────────────────────────────────────────

export class FrontlineSystem {
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
          province_id:   string;
          nation_id:     string;
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
      console.log(`[FrontlineSystem] loaded ${this.provinces.size} province cities`);
    } catch {
      console.warn("[FrontlineSystem] map_data.json not found — frontline disabled");
    }
  }

  // ---------------------------------------------------------------------------
  // tick — called every game tick from GameRoom
  // ---------------------------------------------------------------------------

  tick(
    state:     GameRoomState,
    tickCount: number,
    broadcast: (type: string, msg: unknown) => void,
  ): void {
    if (tickCount % FRONTLINE_TICK_INTERVAL !== 0) return;
    if (this.provinces.size === 0) return;

    const liveDivisions = Array.from(state.divisions.values()).filter(
      d => d.combat_state !== "destroyed",
    );

    const batch: Record<string, Record<string, number>> = {};

    for (const [provinceId, prov] of this.provinces) {
      const stateProvince = state.provinces.get(provinceId);
      const ownerId = stateProvince ? stateProvince.owner_id : prov.nation_id;

      const rawInfluence = new Map<string, number>();

      // Unit-based influence from all live divisions within range
      for (const div of liveDivisions) {
        const distKm = this._distKm(div.position_lng, div.position_lat, prov.city_lng, prov.city_lat);
        if (distKm >= MAX_INFLUENCE_RANGE_KM) continue;

        const falloff = 1 - distKm / MAX_INFLUENCE_RANGE_KM;
        const contribution = (div.hp / 100) * falloff;
        rawInfluence.set(div.nation_id, (rawInfluence.get(div.nation_id) ?? 0) + contribution);
      }

      // Ownership bonus for the province's current owner
      if (ownerId) {
        rawInfluence.set(ownerId, (rawInfluence.get(ownerId) ?? 0) + OWNERSHIP_BONUS);
      }

      // Normalise to shares (0–1, summing to ≤ 1)
      let total = 0;
      for (const v of rawInfluence.values()) total += v;
      if (total === 0) continue;

      const nationShares: Record<string, number> = {};
      for (const [nationId, raw] of rawInfluence) {
        const share = raw / total;
        if (share > 0.001) nationShares[nationId] = Math.round(share * 1000) / 1000;
      }

      batch[provinceId] = nationShares;
    }

    if (Object.keys(batch).length > 0) {
      broadcast("FRONTLINE_BATCH", { provinces: batch });
    }
  }

  // ---------------------------------------------------------------------------
  // _distKm
  // ---------------------------------------------------------------------------

  private _distKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
    return Math.sqrt((aLng - bLng) ** 2 + (aLat - bLat) ** 2) * KM_PER_DEG;
  }
}
