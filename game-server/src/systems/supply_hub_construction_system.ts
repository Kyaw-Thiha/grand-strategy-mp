import type { GameRoomState } from "../rooms/schema/GameRoomState.js";
import type { SubprovinceSystem } from "./subprovince_system.js";

// Deliberate placeholder cost/duration: no real resource-pool economy exists in this codebase
// yet (docs/RESOURCE_ECONOMY.md is design-only), so this spends the one existing per-province
// quasi-economic value (ProvinceState.industry) instead of inventing a parallel currency. Swap
// for the real economy once it lands.
const SUPPLY_HUB_INDUSTRY_COST = 50;
const SUPPLY_HUB_BUILD_TIME_MS = 5 * 60_000; // 5 real minutes, tunable for playtesting

export type StartConstructionResult = { ok: true } | { ok: false; error: string };

/**
 * Lets a nation construct a new supply hub in a province it owns, beyond the map's static
 * starting hubs (Task A of the supply-hub plan). No cap on total hub count — a nation's real hub
 * count is bounded only by how much industry it can spend. Upgrade tiers (ProvinceState's
 * supply_hub_level field) are reserved but have no gameplay effect here — a later pass.
 */
export class SupplyHubConstructionSystem {
  /** Starts construction in provinceId for nationId, or returns a rejection reason. */
  startConstruction(
    nationId: string,
    provinceId: string,
    state: GameRoomState,
    subprovinceSystem: SubprovinceSystem,
    nowMs: number,
  ): StartConstructionResult {
    const province = state.provinces.get(provinceId);
    if (!province) return { ok: false, error: "unknown province" };
    if (province.owner_id !== nationId) return { ok: false, error: "province is not owned by the requesting nation" };
    if (subprovinceSystem.isStaticHubProvince(provinceId)) return { ok: false, error: "province already has a supply hub" };
    if (province.has_supply_hub) return { ok: false, error: "province already has a supply hub" };
    if (province.supply_hub_construction_ends_at_ms !== 0) return { ok: false, error: "a supply hub is already under construction here" };
    if (province.industry < SUPPLY_HUB_INDUSTRY_COST) return { ok: false, error: "insufficient industry" };

    province.industry -= SUPPLY_HUB_INDUSTRY_COST;
    province.supply_hub_construction_ends_at_ms = nowMs + SUPPLY_HUB_BUILD_TIME_MS;
    return { ok: true };
  }

  /** Completes any construction whose timer has elapsed, calling onCompleted(provinceId) for each. */
  tick(state: GameRoomState, nowMs: number, onCompleted: (provinceId: string) => void): void {
    for (const [provinceId, province] of state.provinces) {
      if (province.supply_hub_construction_ends_at_ms === 0) continue;
      if (nowMs < province.supply_hub_construction_ends_at_ms) continue;
      province.has_supply_hub = true;
      province.supply_hub_construction_ends_at_ms = 0;
      onCompleted(provinceId);
    }
  }
}
