import { MapSchema } from "@colyseus/schema";
import type { MarketOrderState, NationState, ProvinceState, TradeRouteState } from "../rooms/schema/GameRoomState.js";

type BroadcastFn = (type: string, msg: unknown) => void;

// RESOURCE_ECONOMY.md — Player-Driven Market, Spot market: 10-20% documented range, midpoint
// placeholder. TBD playtesting.
export const SPOT_SPREAD_PCT = 0.15;

export interface MatchFill {
  nation_id: string;      // the RESTING (passive) order's owning nation, credited by the caller
  side: string;           // the resting order's own side ("buy" | "sell")
  qty: number;
  price: number;          // the resting order's own price — the price the fill executed at
}

export interface MatchResult {
  filled: number;    // quantity actually filled against real player orders
  remaining: number; // quantity left over that should rest in the book as a new posted order
  proceeds: number;  // net money delta for the placing (aggressor) nation: + on a sell, - (cost) on a buy
  fills: MatchFill[]; // per-counterparty fills against resting player orders
}

/**
 * Matches a newly-placed order against the resting book. Fills at the RESTING order's price
 * (standard order-book convention), applies the symmetric spread penalty to both legs, and
 * burns the spread difference (never redistributed).
 *
 * No automatic NPC fill: an order with no (or insufficient) compatible player candidates
 * simply rests in the book for its unmatched remainder — real, visible player liquidity is
 * the only thing that fills an order in this branch. `npc_liquidity_prices.ts` is kept as a
 * price reference for a future AI-player trading system (not yet implemented) rather than
 * wired into matching here — confirmed with design: orders are made by players and are meant
 * to be executed by other players (and, eventually, AI-driven nations placing real orders of
 * their own), not instantly vacuumed up by an invisible fallback the instant the book is thin.
 */
export function matchOrder(
  newOrder: MarketOrderState,
  book: MapSchema<MarketOrderState>,
): MatchResult {
  const opposite = newOrder.side === "sell" ? "buy" : "sell";
  const candidates = [...book.values()]
    .filter((o) => o.order_id !== newOrder.order_id)
    .filter((o) => o.resource_type === newOrder.resource_type && o.side === opposite)
    .filter((o) => (newOrder.side === "sell" ? o.price >= newOrder.price : o.price <= newOrder.price))
    .sort((a, b) => (newOrder.side === "sell" ? b.price - a.price : a.price - b.price)); // best price first

  let remaining = newOrder.quantity;
  let proceeds = 0;
  const fills: MatchFill[] = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, candidate.quantity);
    const grossValue = fillQty * candidate.price; // matched at the resting order's price
    const spreadCut = grossValue * SPOT_SPREAD_PCT;
    proceeds += newOrder.side === "sell" ? grossValue - spreadCut : -(grossValue + spreadCut);
    fills.push({ nation_id: candidate.nation_id, side: candidate.side, qty: fillQty, price: candidate.price });
    candidate.quantity -= fillQty;
    remaining -= fillQty;
    if (candidate.quantity <= 0) book.delete(candidate.order_id);
  }

  return { filled: newOrder.quantity - remaining, remaining, proceeds, fills };
}

/** Two nations share a land border iff any pair of their owned provinces are adjacent. */
export function nationsShareBorder(
  nationA: string,
  nationB: string,
  provinces: MapSchema<ProvinceState>,
  neighbors: Map<string, string[]>,
): boolean {
  const ownedA = [...provinces.values()].filter((p) => p.owner_id === nationA).map((p) => p.province_id);
  const ownedB = new Set([...provinces.values()].filter((p) => p.owner_id === nationB).map((p) => p.province_id));
  return ownedA.some((pid) => (neighbors.get(pid) ?? []).some((n) => ownedB.has(n)));
}

/**
 * SIMPLIFIED — no real sea-lane/zone adjacency model exists (Phase 13 Naval Combat is absent).
 * Any two port-owning nations are treated as naval-reachable regardless of actual geography.
 * Deliberate simplification, not a bug — replaced once real sea-zone connectivity exists.
 */
export function nationsShareNavalAccess(
  nationA: string,
  nationB: string,
  provinces: MapSchema<ProvinceState>,
): boolean {
  const hasPort = (nationId: string) => [...provinces.values()].some((p) => p.owner_id === nationId && p.has_port);
  return hasPort(nationA) && hasPort(nationB);
}

/**
 * Per-tick flow for every active trade route: moves each side's agreed resource rate,
 * disrupts land routes the tick a shared border is lost, and leaves the port-route disruption
 * check as a permanent no-op stub (no sea-zone/naval-unit-presence concept exists yet —
 * Phase 13 absent, mirrors Aluminium's Branch B placeholder). No spread penalty applied here,
 * unlike the spot market — trade route friction is setup time and exposure, not a price haircut.
 */
export function tickTradeRoutes(
  routes: MapSchema<TradeRouteState>,
  nations: MapSchema<NationState>,
  provinces: MapSchema<ProvinceState>,
  neighbors: Map<string, string[]>,
  broadcast: BroadcastFn,
): void {
  for (const route of routes.values()) {
    if (route.status !== "active") continue;

    if (route.kind === "land" && !nationsShareBorder(route.nation_a_id, route.nation_b_id, provinces, neighbors)) {
      route.status = "disrupted";
      broadcast("TRADE_ROUTE_DISRUPTED", { route_id: route.route_id });
      continue;
    }
    if (route.kind === "port") {
      // PLACEHOLDER: real check needs "enemy unit physically present in either port's sea
      // zone" per DEV_PHASES.md's documented Phase 9 simplification. No sea-zone concept and
      // no naval units exist in this codebase yet (Phase 13 absent) — this check is
      // permanently false until that exists.
    }

    const nationA = nations.get(route.nation_a_id);
    const nationB = nations.get(route.nation_b_id);
    if (!nationA || !nationB) continue;

    // Clamp transfers to what's actually available — a sender depleted below the agreed rate
    // sends whatever it has rather than going negative (matches the Math.max(0, ...) floor
    // convention already established by Branches B/C elsewhere in this design).
    const aAvail = nationA.resources.get(route.a_sends_resource) ?? 0;
    const aSend = Math.min(route.a_sends_rate, aAvail);
    nationA.resources.set(route.a_sends_resource, aAvail - aSend);
    nationB.resources.set(route.a_sends_resource, (nationB.resources.get(route.a_sends_resource) ?? 0) + aSend);

    const bAvail = nationB.resources.get(route.b_sends_resource) ?? 0;
    const bSend = Math.min(route.b_sends_rate, bAvail);
    nationB.resources.set(route.b_sends_resource, bAvail - bSend);
    nationA.resources.set(route.b_sends_resource, (nationA.resources.get(route.b_sends_resource) ?? 0) + bSend);
  }
}
