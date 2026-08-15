# Branch D — `feat/economy-market`

## Context

**Prerequisite: Branches A and B merged.** (Does **not** need Branch C — the market trades
the ten tradeable resources plus money, neither of which depends on unit production/Reserve.
This branch can run in parallel with Branch C if two people pick them up at once, per the
overview's merge-order diagram.)

Implements `RESOURCE_ECONOMY.md`'s "Player-Driven Market" section in full: the spot market
(global order book, money-only, symmetric spread penalty, NPC liquidity floor) and standing
trade routes (port-to-port and land, resource-for-resource barter, no spread penalty). One
branch because both are "players trading resources" and share UI surface
(`plans/economy_production_ui_handoff.md` explicitly makes the Economy → My Trade tab a
read-only mirror of both).

**Two deliberate, already-documented placeholders, not scope cuts invented here:**
- Standing trade route disruption uses a flat "enemy unit present in the port's sea zone"
  check, not `NAVAL_COMBAT.md`'s real blockade-percentage math — `DEV_PHASES.md`'s own Phase
  9 verification gate specifies exactly this placeholder, replaced in Phase 14.
- Land trade routes are direct-border-only, no third-party transit-rights routing — Phase 10
  (Diplomacy) doesn't exist yet, so there is no transit-rights flag to consume. **This
  branch's Propose Trade Route modal therefore omits the "shown but not selectable +
  `[Request Transit]`" case from `plans/economy_production_ui_handoff.md` §6's mockup
  entirely** — a non-bordering, non-naval-reachable nation simply does not appear in the
  partner list at all in this branch, rather than appearing greyed-out with an inert button.
  Re-add the fuller mockup behavior once Phase 10 exists.

**Test-Driven Development is mandatory for every server step below.**

---

## Critical Pre-Read

### `relations` schema and stance values — verify exact strings before hardcoding "at war"

```typescript
export class RelationState extends Schema {
  @type("string") from_id: string = "";
  @type("string") to_id: string = "";
  @type("string") stance: string = "neutral";
}
```
`GameRoom.ts` has existing diplomacy handlers referencing `"Cannot declare war on an ally"`
and alliance-management error strings — **grep `GameRoom.ts`'s diplomacy handler block for
every literal string assigned to `.stance` before writing this branch's war-exclusion check**
(likely `"neutral"` / `"allied"` / `"war"`, but confirm the exact spelling — do not guess).
`getRelationStance(nationA, nationB)` already exists (`GameRoom.ts:~2085-2110`) and handles
the `from_id|to_id` vs `to_id|from_id` key-order lookup — reuse it directly, do not
re-implement relation lookup.

### `provinceNeighbors` — existing province-adjacency data, reused for nation-border checks

```typescript
provinceNeighbors: Map<string, string[]> = new Map(); // GameRoomState.ts:109, parsed once from map_data.json adjacency
```
No nation-level "does A border B" data exists — derive it: two nations border each other iff
any pair of provinces `(p ∈ ownedByA, q ∈ ownedByB)` has `q ∈ provinceNeighbors.get(p)`.
Compute on demand (small map sizes per `STRATEGIC_COMBAT.md`'s design intent — dozens of
provinces, not hundreds), not cached, since province ownership changes over a session
(captures) and a stale cache would silently misreport eligibility after a capture.

### `has_port` field — verify presence, same flag Branch B raised

Confirmed present in `map_data.json` (map-pipeline research), **not independently confirmed
on the live `ProvinceState` Colyseus schema** as of Branch A. If Branch B didn't already add
it while implementing Shipyard, add `@type("boolean") has_port: boolean = false;` to
`ProvinceState` now and read it in `_initProvinces()` the same way `industry`/`population`
already are.

### Existing `MapSchema`-of-`Schema` precedent — `proposals` field

`GameRoomState.ts:102`: `@type({ map: ProposalState }) proposals = new MapSchema<ProposalState>();`
**Read `ProposalState`'s full class definition before writing `MarketOrderState`/
`TradeRouteState`** — match its ID-generation approach and general field-naming style rather
than inventing a new convention for this branch's two new schema classes.

### `CREATE_WING` ownership-guard shape — reused once more

Every new handler in this branch (`PLACE_MARKET_ORDER`, `CANCEL_MARKET_ORDER`,
`PROPOSE_TRADE_ROUTE`, `RESPOND_TRADE_ROUTE`, `END_TRADE_ROUTE`) follows the same
`client → player → nation` resolution shown in Branch A/B/C's Critical Pre-Read sections —
not re-quoted here, see `phase-9-task-a-foundation.md`.

---

## Files to Create

| File | Purpose |
|---|---|
| `game-server/src/systems/market_system.ts` | Order matching engine, NPC fallback pricing, trade route eligibility + tick |
| `game-server/src/data/npc_liquidity_prices.ts` | `NPC_BASE_PRICE` per resource, spread constant — TBD-playtesting placeholders |
| `game-server/test/9d-economy-market.test.ts` | All Branch D server tests |

## Files to Modify

| File | Change |
|---|---|
| `game-server/src/rooms/schema/GameRoomState.ts` | New `MarketOrderState`, `TradeRouteState` classes; `market_orders`, `trade_routes` `MapSchema` fields on `GameRoomState`; `has_port` on `ProvinceState` if not already added by Branch B |
| `game-server/src/rooms/GameRoom.ts` | New `marketSystem` instance + `gameTick()` hookup (trade route flow); five new message handlers |
| `game-server/test-lanes.json` | `economy` lane: add `9d-economy-market.test.ts`, new source prefixes |
| `client/src/ui/hud/market_panel.gd` / `.tscn` | New FULL_CENTER modal, ten resource columns |
| `client/src/ui/hud/economy_panel.gd` | Third tab: My Trade (read-only spot orders + trade route mirror) |
| `client/src/ui/hud/diplomacy_panel.gd` | Third tab: Trade Routes (the one place routes are created/ended) |
| `client/src/ui/hud/propose_trade_route_panel.gd` / `.tscn` | New FULL_CENTER modal |
| `client/src/core/game_state.gd` | `market_orders: Dictionary`, `trade_routes: Dictionary`; `_apply_market_updates()`, `_apply_trade_route_updates()` |
| `client/src/core/event_bus.gd` | New signals |
| `client/src/systems/session/session_manager.gd` | New `match` arms |

---

## Step 1: Schema — `MarketOrderState`, `TradeRouteState`

### 1a. Implement (after reading `ProposalState` per Critical Pre-Read)

```typescript
export class MarketOrderState extends Schema {
  @type("string") order_id: string = "";
  @type("string") nation_id: string = "";
  @type("string") resource_type: string = "";
  @type("string") side: string = "buy";       // "buy" | "sell"
  @type("number") quantity: number = 0;       // remaining, decremented as fills happen
  @type("number") price: number = 0;          // per-unit, money
}

export class TradeRouteState extends Schema {
  @type("string") route_id: string = "";
  @type("string") nation_a_id: string = "";
  @type("string") nation_b_id: string = "";
  @type("string") kind: string = "land";      // "land" | "port"
  @type("string") status: string = "proposed"; // "proposed" | "active" | "disrupted"
  @type("string") a_sends_resource: string = "";
  @type("number") a_sends_rate: number = 0;   // per tick
  @type("string") b_sends_resource: string = "";
  @type("number") b_sends_rate: number = 0;
}
```
Added to `GameRoomState`: `@type({ map: MarketOrderState }) market_orders = new
MapSchema<MarketOrderState>();` and `@type({ map: TradeRouteState }) trade_routes = new
MapSchema<TradeRouteState>();` — both real Colyseus schema (not the off-schema
`ProvinceEconomyData` pattern), because both are small, globally-relevant, and every viewer
needs live reactivity on them (a market order fill or a route's disruption status must update
instantly for every client watching the Market/Diplomacy panels) — same justification
Branch A's Data Model section already used for `NationState.resources`.

**No tests for this step** — pure schema, covered by Step 2/4's functional tests.

---

## Step 2: Spot market — `PLACE_MARKET_ORDER`, matching, spread, NPC floor

### 2a. Tests first

```typescript
describe("lane:economy | Spot market matching", () => {
  it("a sell order matching an existing buy order at or above the sell price fills immediately", () => {});
  it("seller receives 80-90% of listed price (10-20% spread, symmetric)", () => {});
  it("buyer pays 110-120% of the going rate on a matched buy (spread applied to both legs, not one-sided)", () => {});
  it("the spread difference is burned — total money in the system decreases by exactly the spread amount, not redistributed to any other nation or pool", () => {});
  it("partial fills: a sell order larger than the best matching buy order fills the buy order fully and leaves the remainder of the sell order still posted", () => {});
  it("no matching player order exists: order fills against the NPC liquidity floor instead, never leaves a player stuck unable to trade", () => {});
  it("NPC floor price is always slightly worse than the nation's own listed price (a safety net, not a good deal)", () => {});
  it("placing an order with insufficient resource/money stock is rejected before it ever reaches the book", () => {});
});
```

### 2b. Implement

```typescript
const SPOT_SPREAD_PCT = 0.15; // TBD playtesting — 10-20% documented range, midpoint placeholder

export function matchOrder(newOrder: MarketOrderState, book: MapSchema<MarketOrderState>): { filled: number; proceeds: number } {
  const opposite = newOrder.side === "sell" ? "buy" : "sell";
  const candidates = [...book.values()]
    .filter(o => o.resource_type === newOrder.resource_type && o.side === opposite)
    .filter(o => newOrder.side === "sell" ? o.price >= newOrder.price : o.price <= newOrder.price)
    .sort((a, b) => newOrder.side === "sell" ? b.price - a.price : a.price - b.price); // best price first

  let remaining = newOrder.quantity;
  let proceeds = 0;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, candidate.quantity);
    const grossValue = fillQty * candidate.price; // matched at the RESTING order's price, standard order-book convention — confirm this is the intended rule, not the new order's own listed price
    const spreadCut = grossValue * SPOT_SPREAD_PCT;
    proceeds += newOrder.side === "sell" ? (grossValue - spreadCut) : -(grossValue + spreadCut);
    candidate.quantity -= fillQty;
    remaining -= fillQty;
    if (candidate.quantity <= 0) book.delete(candidate.order_id);
  }
  return { filled: newOrder.quantity - remaining, proceeds };
}

export function npcFallbackPrice(resourceType: string, side: "buy" | "sell"): number {
  const base = NPC_BASE_PRICE[resourceType];
  return side === "sell" ? base * (1 - NPC_SPREAD) : base * (1 + NPC_SPREAD); // worse than "fair" for the player either direction
}
```
**NPC liquidity is not modeled as literal standing orders in the book** — it is an unlimited-
quantity fallback price applied only when `matchOrder` finds zero compatible player
candidates. This avoids needing to track/replenish a fake order's quantity, and matches the
design intent ("baseline AI buy/sell wall... ensures a player is never stuck," not "a specific
tradeable NPC order players can strategically drain"). **Money burned on a spread does not
appear anywhere as a receiving party** — confirm the implementation above never credits the
spread cut to any nation, NPC pseudo-account, or pool; it is simply subtracted from
`grossValue` and never added back anywhere, per `RESOURCE_ECONOMY.md`'s explicit "a money
sink, not redistributed."

`PLACE_MARKET_ORDER` handler: ownership guard, verify the placing nation actually holds
`quantity` of the resource (sell) or `quantity × price` money (buy) **before** creating the
order (reject up front, matching Step 2a's last test), deduct/hold it, call `matchOrder`,
apply proceeds, broadcast `MARKET_UPDATES`.

**Manual verification (required):** two-bot-client scenario — bot A posts a sell order for
Iron, bot B posts a matching buy order, confirm both nations' money/iron numbers update
correctly with the spread visibly applied (seller receives less than listed, buyer pays more
than listed). Post an order for a resource with zero existing orders (e.g. Chromium on an
empty-lobby test) — confirm it fills against the NPC floor rather than sitting unfileld
forever, and confirm the fill price is worse than a "fair" reference.

---

## Step 3: `CANCEL_MARKET_ORDER`

### 3a. Tests

```typescript
describe("lane:economy | Cancel market order", () => {
  it("owner can cancel their own unfilled/partially-filled order, held stock/money for the remaining quantity is returned", () => {});
  it("non-owner cannot cancel another nation's order", () => {});
});
```

### 3b. Implement — same ownership-guard shape, `book.delete(order_id)` + refund remaining held
amount. No manual verification beyond a `[Cancel]` button click confirmed against a test.

---

## Step 4: Standing trade routes — proposal, eligibility, accept/reject

### 4a. Tests first

```typescript
describe("lane:economy | Trade route eligibility", () => {
  it("two nations sharing a land border are eligible for a land route", () => {});
  it("two non-bordering nations are not eligible for a land route (no transit-rights system exists yet — Phase 10 gap, documented, not a bug)", () => {});
  it("two nations each owning at least one has_port=true province are eligible for a port route, regardless of land adjacency", () => {});
  it("nations at war are excluded from eligibility entirely — confirm the exact stance string checked matches GameRoom.ts's real diplomacy code, not a guessed value", () => {});
  it("proposing a route to oneself, or duplicating an already-active route between the same two nations, is rejected", () => {});
});
describe("lane:economy | Trade route proposal flow", () => {
  it("PROPOSE_TRADE_ROUTE creates a status='proposed' TradeRouteState, visible to both parties", () => {});
  it("RESPOND_TRADE_ROUTE(accept) flips status to 'active'", () => {});
  it("RESPOND_TRADE_ROUTE(reject) removes the proposed route entirely", () => {});
  it("only the recipient nation (not the proposer) can respond", () => {});
  it("resource-for-itself (e.g. Iron for Iron) is rejected client-side per the design note, AND server-side as a defense-in-depth check", () => {});
});
```

### 4b. Implement eligibility check

```typescript
export function nationsShareBorder(nationA: string, nationB: string, provinces: MapSchema<ProvinceState>, neighbors: Map<string, string[]>): boolean {
  const ownedA = [...provinces.values()].filter(p => p.owner_id === nationA).map(p => p.province_id);
  const ownedB = new Set([...provinces.values()].filter(p => p.owner_id === nationB).map(p => p.province_id));
  return ownedA.some(pid => (neighbors.get(pid) ?? []).some(n => ownedB.has(n)));
}

export function nationsShareNavalAccess(nationA: string, nationB: string, provinces: MapSchema<ProvinceState>): boolean {
  const hasPort = (nationId: string) => [...provinces.values()].some(p => p.owner_id === nationId && p.has_port);
  // SIMPLIFIED — no real sea-lane/zone adjacency model exists (Phase 13 absent); any two
  // port-owning nations are treated as naval-reachable, regardless of actual geography. This
  // is a deliberate simplification, not a bug — real sea-zone connectivity is out of scope
  // until Naval Combat exists.
  return hasPort(nationA) && hasPort(nationB);
}
```
`PROPOSE_TRADE_ROUTE` handler: ownership guard, `getRelationStance(...) !== "war"` (confirm
exact string per Critical Pre-Read), eligibility via one of the two functions above depending
on requested `kind`, reject same-resource-both-sides, create `status: "proposed"`
`TradeRouteState`, broadcast to both nations (`broadcastToNation` twice, or once with a
filter — check the exact multi-recipient broadcast pattern already used elsewhere, e.g.
however `DIPLOMACY_NOTIFICATION` at `GameRoom.ts:~1007` reaches both parties, and mirror it).

**Manual verification (required):** two-bot scenario — bot A proposes a route to bordering
bot B, confirm bot B sees it as "proposed, awaiting response" in Diplomacy → Trade Routes;
bot B accepts, confirm both sides now show it as active. Attempt a proposal between two
non-bordering, non-port nations — confirm server rejects it (client never even offers the
option per Step 6's partner-list filtering, but test the server-side rejection independently
too, since the client filter alone is not a security boundary).

---

## Step 5: Trade route tick — resource flow + placeholder disruption

### 5a. Tests first

```typescript
describe("lane:economy | Trade route flow tick", () => {
  it("an active route moves a_sends_rate of a_sends_resource from A to B, and b_sends_rate of b_sends_resource from B to A, every tick", () => {});
  it("no spread penalty applied to trade route flow, unlike the spot market", () => {});
  it("a land route is disrupted (status flips to 'disrupted', flow stops) the tick after the shared border is lost (a province changes hands)", () => {});
  it("a port route's disruption check is a placeholder that currently always reports 'not disrupted' in the absence of any spawned naval units — document this rather than writing a test that pretends the check has real teeth yet", () => {});
});
```

### 5b. Implement

```typescript
export function tickTradeRoutes(routes: MapSchema<TradeRouteState>, nations: MapSchema<NationState>, provinces: MapSchema<ProvinceState>, neighbors: Map<string, string[]>, broadcast: BroadcastFn): void {
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
      // permanently false until that exists. Do not implement a fake sea-zone model here;
      // leave the function returning false with this comment, exactly like Aluminium's
      // Branch B stub.
    }
    const nationA = nations.get(route.nation_a_id), nationB = nations.get(route.nation_b_id);
    if (!nationA || !nationB) continue;
    nationA.resources.set(route.a_sends_resource, (nationA.resources.get(route.a_sends_resource) ?? 0) - route.a_sends_rate);
    nationB.resources.set(route.a_sends_resource, (nationB.resources.get(route.a_sends_resource) ?? 0) + route.a_sends_rate);
    nationB.resources.set(route.b_sends_resource, (nationB.resources.get(route.b_sends_resource) ?? 0) - route.b_sends_rate);
    nationA.resources.set(route.b_sends_resource, (nationA.resources.get(route.b_sends_resource) ?? 0) + route.b_sends_rate);
  }
}
```
**Edge case — a sender depleted below the agreed rate.** Design docs don't specify behavior
for a nation whose stock can't cover its side of the exchange this tick. **Clamp the transfer
to `min(rate, available)` rather than letting a resource go negative** (Branch B/C both
already establish a `Math.max(0, ...)` floor convention everywhere else in this design — stay
consistent) and note this as a reasonable implementation choice, not a documented rule, in a
code comment. Wire `tickTradeRoutes` into `gameTick()` after Branch B/C's resource ticks.

`END_TRADE_ROUTE` handler: either party can end an active route unilaterally (per the UI
handoff's `[End]` button being available to "my" side without requiring the other party's
consent — confirm this against `RESOURCE_ECONOMY.md`, which doesn't explicitly state
mutual-consent is required for ending, only for establishing), deletes the `TradeRouteState`.

**Manual verification (required):** establish an active land route, watch both nations'
resource numbers move correctly every tick with no spread deduction (contrast directly against
Step 2's spot market, which does apply one). Capture a province that breaks the shared
border, confirm the route flips to disrupted and flow stops on the next tick.

---

## Step 6: Client — Market modal, My Trade tab, Diplomacy Trade Routes tab

### 6a. Market modal (`market_panel.gd`, new `FULL_CENTER`)

Per `plans/economy_production_ui_handoff.md` §5's mockup — ten resource columns (all ten,
regardless of whether this nation produces/has deposits for them, **explicitly the opposite
curation rule from the top bar's flyout**, per that doc's own note), each with BUY (top 3
lowest sell-offers) / SELL (top 3 highest buy-offers) sections and an `[+ Add offer]` minimal
inline form (quantity + price, not a nested overlay). Empty-state columns render the same
card shape with "No offers yet / Be the first" text, per that doc's explicit empty-state
spec — **must look intentional, not broken.**

Opened from two entry points sharing one modal instance: the top bar's `[Market]` button
(Branch B, Step 11c) and Economy panel's My Trade tab (`[Market]` shortcut button, below).

### 6b. Economy panel — third tab, My Trade

`TabBar`/`TabButtons` extended to three tabs (`Resources`, `Industry`, `My Trade`) — narrow
scope per the UI handoff §4 Tab 3: only this player's own active spot orders (with `[Cancel]`
submitting `CANCEL_MARKET_ORDER`) and a **read-only** mirror of their trade routes. Does not
create or place orders itself — that's the Market modal's job.

### 6c. Diplomacy panel — third tab, Trade Routes

Per the UI handoff §6: `[ Nations ] [ Alliance ] [ Trade Routes ]` — the **only** place routes
are created or ended (`[+ Propose New Route]` opens the Propose modal, `[End]`/`[Cancel]`
submit `END_TRADE_ROUTE` on an active/proposed route respectively). **Confirm the existing
Diplomacy panel's tab structure before adding a third tab** — locate its current `.tscn`/`.gd`
to see whether it already uses the `TabBar`/`TabButtons` pattern (likely, given
`military_panel.gd`'s pattern is established codebase-wide) or something else, since this
branch is extending an *existing* multi-tab panel, not building a new one from scratch like
Branch B's Economy Industry tab was.

### 6d. Propose Trade Route modal

New `FULL_CENTER`, per the UI handoff §6's mockup. Partner list built from
`nationsShareBorder`/`nationsShareNavalAccess` results **already computed server-side and
broadcast** (do not duplicate the eligibility logic client-side from raw province-ownership
data — request it, or derive it from data the client already has via `GameState.provinces`'
existing ownership sync + a client-side port/adjacency check using the same public map data
the client already loaded for pathfinding). **Nations at war are excluded from the list
entirely, not shown greyed out** — matches the eligibility function's server-side hard
exclusion exactly, no separate client-side war-check needed since ineligible nations never
appear in whatever eligibility payload the server sends. Resource pair: two independent
dropdown+quantity pairs (You Send / You Receive), any of the ten resources on either side,
client-side validation blocking same-resource-both-sides (server also rejects it per Step
4a's defense-in-depth test).

**Manual verification (required):** open Market modal from the top bar, confirm all ten
columns render (including resources this nation has zero deposits for), place a buy offer via
`[+ Add offer]`'s inline form, confirm it appears in Economy → My Trade with a working
`[Cancel]`. Open Diplomacy → Trade Routes, propose a route to an eligible bordering nation via
the Propose modal, confirm the empty-partner-list state text appears correctly if you
temporarily test against a nation with no eligible partners (e.g. a war-only lobby setup).

---

## Common Misassumptions

| Misassumption | Reality |
|---|---|
| NPC liquidity should be modeled as real standing orders in the book | **Wrong** — implemented as a price fallback when no player order matches, not a depletable/strategically-drainable order; simpler and matches the "safety net" design intent exactly |
| The spread cut should go somewhere (a pool, the NPC, anyone) | **Wrong** — burned, period, per `RESOURCE_ECONOMY.md`'s explicit "not redistributed to any other player or pool" |
| Trade routes need Phase 10's transit-rights system to function at all | **Wrong** — direct border and naval-access routes work fully without it; only third-party transit routing through a non-participant is blocked, and that case is simply omitted from the UI rather than shown-but-disabled |
| Port-route disruption should attempt some real sea-zone check since naval provinces (`has_port`) already exist | **Wrong** — `has_port` existing doesn't mean sea-zone/naval-unit-presence concepts exist; this branch's port-disruption check is a permanent no-op stub, exactly like Aluminium's Branch B placeholder, not a partial implementation to be proud of finishing |
| A trade route requires mutual consent to end, same as to establish | **Unresolved by the design docs explicitly** — implemented here as unilateral `[End]`, matching the UI mockup's per-side button; flag if this reading is wrong |
| Money burned via spread + trade-route flow are the same code path | **Wrong** — trade routes explicitly have **no** spread penalty (`RESOURCE_ECONOMY.md`: "No spread penalty on trade routes — the friction here is setup time and exposure"); do not accidentally apply `SPOT_SPREAD_PCT` inside `tickTradeRoutes` |
