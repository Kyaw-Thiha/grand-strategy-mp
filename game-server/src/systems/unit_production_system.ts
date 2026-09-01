import type { MapSchema } from "@colyseus/schema";
import type { NationState, DivisionState } from "../rooms/schema/GameRoomState.js";
import { getUnitProductionStats, PRODUCTION_BUILDING_TYPES } from "../data/unit_production_stats.js";
import { getBuildingStats } from "../data/building_stats.js";
import { UNIT_COMBAT_STATS } from "../data/unit_combat_stats.js";
import { OIL_CONSUMING_TYPES, VEHICLE_TYPES, INFANTRY_ARTILLERY_TYPES } from "../data/unit_resource_tags.js";

export type BroadcastFn = (type: string, msg: unknown) => void;
export type BroadcastToNationFn = (type: string, msg: unknown, nationId: string) => void;

const HP_EQUIVALENT_PER_UNIT = 100;

export const MARSHALLING_RATE = 20; // TBD playtesting — flat national constant, HP-equivalent/tick

/**
 * SIMPLIFIED PLACEHOLDER — Phase 7 (Supply System) does not exist yet; no road-graph flow-rate
 * model to call. Deliberately slower than MARSHALLING_RATE so the early-deployment tradeoff
 * (fast guaranteed marshalling fill vs. potentially-slower field fill) is observable. Replace
 * with the real road-segment flow rate once Phase 7 lands.
 */
function fieldSupplyLineCapacity(): number {
  return MARSHALLING_RATE * 0.5;
}

// ─── Auto-scheduler: priority ranking + cost-weighted scoring (§6.2/§6.3) ──────────────────

// Amendment to unit_production_handoff.md §6 (2026-08-31, user decision — see that document's
// "Standing Reserve Production" addendum): the written design as originally drafted was a pure
// demand-pull system where a building with no open marshalling/resupply slot stays idle and
// produces nothing ("does not default to an arbitrary unit type 'just to stay busy'", per
// phase-9-task-c-unit-production-reserve.md's own zero-demand edge case). The user confirmed
// this was not the intended behavior: idle production buildings should keep banking into
// Reserve toward a standing buffer sized off the nation's currently-fielded roster, even with
// zero active marshalling/resupply demand — that's the actual point of Reserve existing as a
// buffer at all. "marshalling"/"field_resupply" demand always outranks this synthetic demand in
// practice because its missing_pct is computed off a much larger target (see below).
export type DemandStream = "marshalling" | "field_resupply" | "standing_reserve";

export interface DemandSlot {
  slot_id: string;
  unit_type: string;
  missing_pct: number; // 0.0 - 1.0
  stream: DemandStream;
}

/** §6.2 — pools marshalling-template demand and fielded-division-resupply demand into one ranking. */
export function rankDemand(slots: DemandSlot[]): DemandSlot[] {
  return [...slots].sort((a, b) => b.missing_pct - a.missing_pct);
}

export function isChromiumGated(unitType: string): boolean {
  return UNIT_COMBAT_STATS[unitType]?.chromium_gated ?? false;
}

// TBD playtesting — placeholder. Standing Reserve target = (count of unit_type currently
// present across a nation's fielded divisions' grid cells) x this fraction x
// HP_EQUIVALENT_PER_UNIT. Tapers to zero missing_pct once the buffer target is reached, so
// buildings naturally stop treating this as demand once Reserve is topped up — never an
// unbounded background sink.
export const STANDING_RESERVE_BUFFER_FRACTION = 0.5;

/**
 * Amendment (see DemandStream's doc comment above) — synthetic demand so an idle production
 * building whose nation has no one raising/resupplying still has something useful to build:
 * keep Reserve topped up toward a fraction of what's currently fielded. Returns 0 (no synthetic
 * demand) once reserve already meets or exceeds the target, or if nothing of this type is
 * fielded at all (a type nobody fields yet generates no standing demand — matches the
 * zero-demand-reads-as-neutral principle used elsewhere in this design, just no longer treating
 * *all* idle time as zero-demand).
 */
export function standingReserveMissingPct(fieldedCount: number, currentReserve: number): number {
  const target = fieldedCount * STANDING_RESERVE_BUFFER_FRACTION * HP_EQUIVALENT_PER_UNIT;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, (target - currentReserve) / target));
}

// TBD playtesting — placeholder curve, shape confirmed (soft, monotonic, never fully excludes)
// not exact numbers. Mirrors oilSpeedMultiplier's "never a hard stop" shape from
// resource_economy_system.ts, applied here as a scoring deprioritization instead of a speed
// penalty.
const RESOURCE_SCARCITY_THRESHOLD = 0.15; // fraction of storage cap below which scarcity kicks in
const RESOURCE_SCARCITY_FLOOR = 0.2; // worst-case multiplier — deprioritized, never excluded

/**
 * §6.4 — "if a resource needed by a candidate unit type is running low, apply a
 * deprioritization multiplier." Distinct from chromium's hard exclusion (isChromiumGated):
 * this only ever softens a score, never removes a type from consideration. Reuses the existing
 * unit_resource_tags.ts sets (oil/vehicle/infantry-artillery) rather than a new per-unit
 * resource-cost-vector table, which doesn't exist anywhere in this codebase yet.
 */
export function resourceScarcityMultiplier(
  unitType: string,
  resourceStock: (resourceType: string) => number,
  resourceCap: (resourceType: string) => number,
): number {
  let mult = 1.0;
  const applyIfScarce = (resourceType: string) => {
    const cap = resourceCap(resourceType);
    if (cap <= 0) return; // cap unknown/not yet computed this tick — treat as not scarce
    const ratio = resourceStock(resourceType) / cap;
    if (ratio >= RESOURCE_SCARCITY_THRESHOLD) return;
    const severity = 1 - ratio / RESOURCE_SCARCITY_THRESHOLD;
    mult = Math.min(mult, 1.0 - severity * (1.0 - RESOURCE_SCARCITY_FLOOR));
  };
  if (OIL_CONSUMING_TYPES.has(unitType)) applyIfScarce("oil");
  if (VEHICLE_TYPES.has(unitType)) applyIfScarce("rubber");
  if (INFANTRY_ARTILLERY_TYPES.has(unitType)) applyIfScarce("nitrates");
  return Math.max(RESOURCE_SCARCITY_FLOOR, mult);
}

/**
 * §6.3 — build_points-weighted missing-% aggregation per unit_type. §6.4/§2c of the plan —
 * chromium is a hard exclusion filter here, not a scoring multiplier (RESOURCE_ECONOMY.md:
 * "cannot be built at all" below threshold). The general §6.4 resource-scarcity case (any other
 * resource running low) is a soft multiplier instead, via resourceScarcityMultiplierFn.
 */
export function scoreTypeForBuilding(
  buildingType: string,
  openSlots: DemandSlot[],
  chromiumAvailable: boolean,
  resourceScarcityMultiplierFn: (unitType: string) => number = () => 1.0,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const slot of openSlots) {
    const stats = getUnitProductionStats(slot.unit_type);
    if (stats.produced_by !== buildingType) continue;
    if (isChromiumGated(slot.unit_type) && !chromiumAvailable) continue;
    const score = slot.missing_pct * stats.build_points * resourceScarcityMultiplierFn(slot.unit_type);
    scores.set(slot.unit_type, (scores.get(slot.unit_type) ?? 0) + score);
  }
  return scores;
}

/** §6.1 — pull assignment: idle buildings request an order, never re-evaluated mid-order. */
export function assignIdleBuildings(
  idleBuildings: Array<{ province_id: string; building_type: string }>,
  demandByBuilding: Map<string, Map<string, number>>,
): Array<{ province_id: string; building_type: string; unit_type: string }> {
  const assignments: Array<{ province_id: string; building_type: string; unit_type: string }> = [];
  for (const b of idleBuildings) {
    const scores = demandByBuilding.get(b.building_type);
    if (!scores || scores.size === 0) continue;
    const [bestType] = [...scores.entries()].sort((x, y) => y[1] - x[1])[0];
    assignments.push({ ...b, unit_type: bestType });
  }
  return assignments;
}

// ─── Production tick — building -> Reserve (§3) ────────────────────────────────────────────

export interface ProductionOrder {
  province_id: string;
  building_type: string;
  current_order: {
    unit_type: string;
    build_points_remaining: number;
    build_points_total: number;
    // HP-equivalent build_points/tick — cached for tickMarshalling/tickFieldDelivery's
    // min(production_rate, channel_rate) formula.
    effective_rate: number;
  } | null;
}

// ─── Marshalling — Reserve -> demand slots (§4/§5) ─────────────────────────────────────────

export interface MarshallingSlot {
  cell_index: number;
  unit_type: string;
  current_hp: number; // 0-100
}

export interface MarshallingData {
  marshalling_id: string;
  nation_id: string;
  template_id: string;
  home_province_id: string;
  slots: MarshallingSlot[];
}

let _marshallingIdCounter = 0;

type NationMap = Map<string, NationState> | MapSchema<NationState>;

export class UnitProductionSystem {
  private productionOrders = new Map<string, ProductionOrder>(); // keyed by `${province_id}:${building_type}`
  private marshalling = new Map<string, MarshallingData>();

  private orderKey(provinceId: string, buildingType: string): string {
    return `${provinceId}:${buildingType}`;
  }

  getOrder(provinceId: string, buildingType: string): ProductionOrder | undefined {
    return this.productionOrders.get(this.orderKey(provinceId, buildingType));
  }

  /** Starts a new order for an idle building. No-op if already producing something. */
  assignOrder(provinceId: string, buildingType: string, unitType: string): void {
    const key = this.orderKey(provinceId, buildingType);
    const existing = this.productionOrders.get(key);
    if (existing?.current_order) return; // already busy
    const stats = getUnitProductionStats(unitType);
    this.productionOrders.set(key, {
      province_id: provinceId,
      building_type: buildingType,
      current_order: {
        unit_type: unitType,
        build_points_remaining: stats.build_points,
        build_points_total: stats.build_points,
        effective_rate: 0,
      },
    });
  }

  /**
   * Sum of in-progress HP-equivalent/tick for a given unit_type, across every building
   * currently producing it — feeds tickMarshalling/tickFieldDelivery's
   * min(production_rate, channel_rate).
   */
  productionRateForType(unitType: string): number {
    let total = 0;
    for (const order of this.productionOrders.values()) {
      if (order.current_order?.unit_type !== unitType) continue;
      total += (order.current_order.effective_rate / order.current_order.build_points_total) * HP_EQUIVALENT_PER_UNIT;
    }
    return total;
  }

  tickProduction(
    provinceEconomy: Map<string, { buildings: Record<string, number> }>,
    provinceOwner: (provinceId: string) => NationState | undefined,
    industrySliceMultiplierForNation: (allocationPct: number) => number,
  ): void {
    for (const order of this.productionOrders.values()) {
      if (!order.current_order) continue;
      const nation = provinceOwner(order.province_id);
      if (!nation) continue;
      const level = provinceEconomy.get(order.province_id)?.buildings[order.building_type] ?? 0;
      if (level <= 0) continue; // building was demolished/never built — no-op, do not throw
      const baseRate = getBuildingStats(order.building_type).base_rate_by_level?.[level - 1] ?? 0;
      const allocPct = nation.industry_alloc.get("unit_production_speed") ?? 0;
      const effectiveRate = baseRate * industrySliceMultiplierForNation(allocPct);
      order.current_order.effective_rate = effectiveRate;
      order.current_order.build_points_remaining -= effectiveRate;

      if (order.current_order.build_points_remaining <= 0) {
        const unitType = order.current_order.unit_type;
        const cap = nation.reserve_cap;
        const current = nation.reserve_pool.get(unitType) ?? 0;
        const next = cap > 0 ? Math.min(cap, current + HP_EQUIVALENT_PER_UNIT) : current + HP_EQUIVALENT_PER_UNIT;
        nation.reserve_pool.set(unitType, next);
        order.current_order = null; // idle again — picked up by next assignIdleBuildings pass
      }
    }
  }

  /** Every owned province's production buildings with no in-progress order. */
  listIdleBuildings(
    provinceEconomy: Iterable<{ province_id: string; buildings: Record<string, number>; owner_id: string }>,
  ): Array<{ province_id: string; building_type: string }> {
    const idle: Array<{ province_id: string; building_type: string }> = [];
    for (const econ of provinceEconomy) {
      if (!econ.owner_id) continue;
      for (const buildingType of PRODUCTION_BUILDING_TYPES) {
        if ((econ.buildings[buildingType] ?? 0) <= 0) continue;
        const key = this.orderKey(econ.province_id, buildingType);
        if (this.productionOrders.get(key)?.current_order) continue;
        idle.push({ province_id: econ.province_id, building_type: buildingType });
      }
    }
    return idle;
  }

  startMarshalling(
    nationId: string, templateId: string, homeProvinceId: string,
    cells: Array<{ cell_index: number; unit_type: string }>,
  ): string {
    const id = `marshal_${nationId}_${++_marshallingIdCounter}`;
    this.marshalling.set(id, {
      marshalling_id: id,
      nation_id: nationId,
      template_id: templateId,
      home_province_id: homeProvinceId,
      slots: cells.map((c) => ({ cell_index: c.cell_index, unit_type: c.unit_type, current_hp: 0 })),
    });
    return id;
  }

  getMarshalling(id: string): MarshallingData | undefined {
    return this.marshalling.get(id);
  }

  listMarshallingForNation(nationId: string): MarshallingData[] {
    return [...this.marshalling.values()].filter((d) => d.nation_id === nationId);
  }

  aggregateHpPct(data: MarshallingData): number {
    if (data.slots.length === 0) return 0;
    const sum = data.slots.reduce((s, sl) => s + sl.current_hp, 0);
    return sum / (data.slots.length * HP_EQUIVALENT_PER_UNIT);
  }

  /** Non-destructive — every slot's already-allocated HP-equivalent returns to reserve_pool. */
  cancelMarshalling(id: string, nations: NationMap): boolean {
    const data = this.marshalling.get(id);
    if (!data) return false;
    const nation = nations.get(data.nation_id);
    if (nation) {
      for (const slot of data.slots) {
        if (slot.current_hp <= 0) continue;
        const current = nation.reserve_pool.get(slot.unit_type) ?? 0;
        nation.reserve_pool.set(slot.unit_type, current + slot.current_hp);
      }
    }
    this.marshalling.delete(id);
    return true;
  }

  removeMarshalling(id: string): void {
    this.marshalling.delete(id);
  }

  tickMarshalling(nations: NationMap): void {
    for (const data of this.marshalling.values()) {
      const nation = nations.get(data.nation_id);
      if (!nation) continue;
      for (const slot of data.slots) {
        if (slot.current_hp >= HP_EQUIVALENT_PER_UNIT) continue;
        const reserveAvail = nation.reserve_pool.get(slot.unit_type) ?? 0;
        const productionRate = this.productionRateForType(slot.unit_type);
        const fillRate = reserveAvail > 0 ? MARSHALLING_RATE : Math.min(MARSHALLING_RATE, productionRate);
        const drawn = Math.max(0, Math.min(fillRate, HP_EQUIVALENT_PER_UNIT - slot.current_hp, reserveAvail));
        slot.current_hp += drawn;
        if (drawn > 0) nation.reserve_pool.set(slot.unit_type, reserveAvail - drawn);
      }
    }
  }

  /**
   * Covers both a just-force-deployed division's remaining under-filled cells AND ordinary
   * combat-damage resupply for any fielded division — same delivery mechanism, §6.5's "supply
   * stream".
   */
  tickFieldDelivery(divisions: Iterable<DivisionState>, nations: NationMap): void {
    for (const div of divisions) {
      if (!div.grid) continue;
      const nation = nations.get(div.nation_id);
      if (!nation) continue;
      for (const cell of div.grid.cells) {
        if (cell.unit_type === "" || cell.hp >= HP_EQUIVALENT_PER_UNIT) continue;
        const reserveAvail = nation.reserve_pool.get(cell.unit_type) ?? 0;
        const productionRate = this.productionRateForType(cell.unit_type);
        const channelRate = fieldSupplyLineCapacity();
        const fillRate = reserveAvail > 0 ? channelRate : Math.min(channelRate, productionRate);
        const drawn = Math.max(0, Math.min(fillRate, HP_EQUIVALENT_PER_UNIT - cell.hp, reserveAvail));
        cell.hp += drawn;
        if (drawn > 0) nation.reserve_pool.set(cell.unit_type, reserveAvail - drawn);
      }
    }
  }
}
