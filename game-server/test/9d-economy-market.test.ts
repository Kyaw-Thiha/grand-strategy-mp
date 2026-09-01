import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import { MapSchema } from "@colyseus/schema";
import appConfig from "../src/app.config.js";
import { getTestPort } from "./helpers.js";
import {
  matchOrder, nationsShareBorder, nationsShareNavalAccess,
  tickTradeRoutes, SPOT_SPREAD_PCT,
} from "../src/systems/market_system.js";
import { npcFallbackPrice } from "../src/data/npc_liquidity_prices.js";
import {
  MarketOrderState, TradeRouteState, NationState, ProvinceState, type GameRoomState,
} from "../src/rooms/schema/GameRoomState.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

function makeOrder(overrides: Partial<{
  order_id: string; nation_id: string; resource_type: string; side: string; quantity: number; price: number;
}>): MarketOrderState {
  const o = new MarketOrderState();
  o.order_id = overrides.order_id ?? "o1";
  o.nation_id = overrides.nation_id ?? "germany";
  o.resource_type = overrides.resource_type ?? "iron";
  o.side = overrides.side ?? "buy";
  o.quantity = overrides.quantity ?? 10;
  o.price = overrides.price ?? 2.0;
  return o;
}

describe("lane:economy | Spot market matching (pure functions)", () => {
  it("a sell order matching an existing buy order at or above the sell price fills immediately", () => {
    const book = new MapSchema<MarketOrderState>();
    const buy = makeOrder({ order_id: "buy1", side: "buy", price: 3.0, quantity: 10 });
    book.set(buy.order_id, buy);
    const sell = makeOrder({ order_id: "sell1", side: "sell", price: 2.5, quantity: 10 });
    const result = matchOrder(sell, book);
    assert.strictEqual(result.filled, 10);
  });

  it("seller receives 80-90% of listed (resting buy) price — spread applied", () => {
    const book = new MapSchema<MarketOrderState>();
    const buy = makeOrder({ order_id: "buy1", side: "buy", price: 10.0, quantity: 10 });
    book.set(buy.order_id, buy);
    const sell = makeOrder({ order_id: "sell1", side: "sell", price: 10.0, quantity: 10 });
    const result = matchOrder(sell, book);
    const expectedGross = 10 * 10.0;
    const expectedProceeds = expectedGross * (1 - SPOT_SPREAD_PCT);
    assert.ok(Math.abs(result.proceeds - expectedProceeds) < 1e-6);
    assert.ok(result.proceeds < expectedGross);
  });

  it("buyer pays 110-120% of the going rate on a matched buy (spread applied to both legs)", () => {
    const book = new MapSchema<MarketOrderState>();
    const sell = makeOrder({ order_id: "sell1", side: "sell", price: 10.0, quantity: 10 });
    book.set(sell.order_id, sell);
    const buy = makeOrder({ order_id: "buy1", side: "buy", price: 10.0, quantity: 10 });
    const result = matchOrder(buy, book);
    const expectedGross = 10 * 10.0;
    const expectedCost = -(expectedGross * (1 + SPOT_SPREAD_PCT));
    assert.ok(Math.abs(result.proceeds - expectedCost) < 1e-6);
  });

  it("partial fills: a sell order larger than the best matching buy fills the buy fully and leaves the remainder unfilled to be posted", () => {
    const book = new MapSchema<MarketOrderState>();
    const buy = makeOrder({ order_id: "buy1", side: "buy", price: 10.0, quantity: 5 });
    book.set(buy.order_id, buy);
    const sell = makeOrder({ order_id: "sell1", side: "sell", price: 5.0, quantity: 20 });
    const result = matchOrder(sell, book);
    assert.strictEqual(result.filled, 5);
    assert.strictEqual(result.remaining, 15); // remainder rests as a posted order, not NPC-filled
    assert.strictEqual(book.get("buy1"), undefined); // resting order fully consumed, removed
  });

  it("no matching player order exists at all: the entire order rests in the book unfilled — no automatic NPC fill", () => {
    const book = new MapSchema<MarketOrderState>();
    const sell = makeOrder({ order_id: "sell1", resource_type: "chromium", side: "sell", price: 5.0, quantity: 10 });
    const result = matchOrder(sell, book);
    assert.strictEqual(result.filled, 0);
    assert.strictEqual(result.remaining, 10);
    assert.strictEqual(result.proceeds, 0);
    assert.deepStrictEqual(result.fills, []);
  });

  it("NPC liquidity price reference exists (future AI-player trading, not wired into matching yet)", () => {
    const sellPrice = npcFallbackPrice("iron", "sell");
    const buyPrice = npcFallbackPrice("iron", "buy");
    assert.ok(sellPrice < 2.5); // NPC_BASE_PRICE.iron = 2.5, sell floor must be below base
    assert.ok(buyPrice > 2.5); // buy floor must be above base
  });

  it("spread difference is burned — proceeds reflect exactly gross minus spread, no double counting", () => {
    const book = new MapSchema<MarketOrderState>();
    const buy = makeOrder({ order_id: "buy1", side: "buy", price: 4.0, quantity: 10 });
    book.set(buy.order_id, buy);
    const sell = makeOrder({ order_id: "sell1", side: "sell", price: 4.0, quantity: 10 });
    const result = matchOrder(sell, book);
    const gross = 10 * 4.0;
    assert.ok(result.proceeds < gross);
    assert.ok(Math.abs(gross - result.proceeds - gross * SPOT_SPREAD_PCT) < 1e-6);
  });
});

describe("lane:economy | Trade route eligibility (pure functions)", () => {
  function makeProvinces(entries: Array<{ id: string; owner: string; port?: boolean }>): MapSchema<ProvinceState> {
    const m = new MapSchema<ProvinceState>();
    for (const e of entries) {
      const p = new ProvinceState();
      p.province_id = e.id;
      p.owner_id = e.owner;
      p.has_port = e.port ?? false;
      m.set(e.id, p);
    }
    return m;
  }

  it("two nations sharing a land border are eligible for a land route", () => {
    const provinces = makeProvinces([{ id: "p1", owner: "germany" }, { id: "p2", owner: "france" }]);
    const neighbors = new Map<string, string[]>([["p1", ["p2"]], ["p2", ["p1"]]]);
    assert.strictEqual(nationsShareBorder("germany", "france", provinces, neighbors), true);
  });

  it("two non-bordering nations are not eligible for a land route", () => {
    const provinces = makeProvinces([{ id: "p1", owner: "germany" }, { id: "p2", owner: "france" }]);
    const neighbors = new Map<string, string[]>();
    assert.strictEqual(nationsShareBorder("germany", "france", provinces, neighbors), false);
  });

  it("two nations each owning a has_port province are eligible for a port route, regardless of land adjacency", () => {
    const provinces = makeProvinces([
      { id: "p1", owner: "germany", port: true },
      { id: "p2", owner: "france", port: true },
    ]);
    assert.strictEqual(nationsShareNavalAccess("germany", "france", provinces), true);
  });

  it("a nation without any has_port province is not naval-eligible", () => {
    const provinces = makeProvinces([
      { id: "p1", owner: "germany", port: false },
      { id: "p2", owner: "france", port: true },
    ]);
    assert.strictEqual(nationsShareNavalAccess("germany", "france", provinces), false);
  });
});

describe("lane:economy | Trade route flow tick (pure functions)", () => {
  function makeNation(id: string, resources: Record<string, number>): NationState {
    const n = new NationState();
    n.nation_id = id;
    for (const [k, v] of Object.entries(resources)) n.resources.set(k, v);
    return n;
  }

  it("an active route moves each side's agreed rate every tick, no spread penalty", () => {
    const routes = new MapSchema<TradeRouteState>();
    const route = new TradeRouteState();
    route.route_id = "r1";
    route.nation_a_id = "germany";
    route.nation_b_id = "france";
    route.kind = "land";
    route.status = "active";
    route.a_sends_resource = "iron";
    route.a_sends_rate = 10;
    route.b_sends_resource = "grain";
    route.b_sends_rate = 5;
    routes.set("r1", route);

    const nations = new MapSchema<NationState>();
    nations.set("germany", makeNation("germany", { iron: 100, grain: 0 }));
    nations.set("france", makeNation("france", { iron: 0, grain: 100 }));

    const provinces = new MapSchema<ProvinceState>();
    const pg = new ProvinceState(); pg.province_id = "pg"; pg.owner_id = "germany";
    const pf = new ProvinceState(); pf.province_id = "pf"; pf.owner_id = "france";
    provinces.set("pg", pg); provinces.set("pf", pf);
    const neighbors = new Map<string, string[]>([["pg", ["pf"]], ["pf", ["pg"]]]);

    let disrupted = false;
    tickTradeRoutes(routes, nations, provinces, neighbors, () => { disrupted = true; });

    assert.strictEqual(nations.get("germany")!.resources.get("iron"), 90);
    assert.strictEqual(nations.get("france")!.resources.get("iron"), 10); // no spread deduction: exactly the rate
    assert.strictEqual(nations.get("germany")!.resources.get("grain"), 5);
    assert.strictEqual(nations.get("france")!.resources.get("grain"), 95);
    assert.strictEqual(disrupted, false);
  });

  it("a land route is disrupted the tick the shared border is lost", () => {
    const routes = new MapSchema<TradeRouteState>();
    const route = new TradeRouteState();
    route.route_id = "r1";
    route.nation_a_id = "germany";
    route.nation_b_id = "france";
    route.kind = "land";
    route.status = "active";
    route.a_sends_resource = "iron"; route.a_sends_rate = 10;
    route.b_sends_resource = "grain"; route.b_sends_rate = 5;
    routes.set("r1", route);

    const nations = new MapSchema<NationState>();
    nations.set("germany", makeNation("germany", { iron: 100 }));
    nations.set("france", makeNation("france", { grain: 100 }));

    const provinces = new MapSchema<ProvinceState>(); // no provinces at all — no border possible
    const neighbors = new Map<string, string[]>();

    let disruptedRouteId = "";
    tickTradeRoutes(routes, nations, provinces, neighbors, (_type, msg: any) => { disruptedRouteId = msg.route_id; });

    assert.strictEqual(route.status, "disrupted");
    assert.strictEqual(disruptedRouteId, "r1");
  });

  it("a sender depleted below the agreed rate sends whatever it has, never goes negative", () => {
    const routes = new MapSchema<TradeRouteState>();
    const route = new TradeRouteState();
    route.route_id = "r1";
    route.nation_a_id = "germany";
    route.nation_b_id = "france";
    route.kind = "land";
    route.status = "active";
    route.a_sends_resource = "iron"; route.a_sends_rate = 10;
    route.b_sends_resource = "grain"; route.b_sends_rate = 5;
    routes.set("r1", route);

    const nations = new MapSchema<NationState>();
    nations.set("germany", makeNation("germany", { iron: 3 })); // less than the agreed rate
    nations.set("france", makeNation("france", { grain: 100 }));

    const provinces = new MapSchema<ProvinceState>();
    const pg = new ProvinceState(); pg.province_id = "pg"; pg.owner_id = "germany";
    const pf = new ProvinceState(); pf.province_id = "pf"; pf.owner_id = "france";
    provinces.set("pg", pg); provinces.set("pf", pf);
    const neighbors = new Map<string, string[]>([["pg", ["pf"]], ["pf", ["pg"]]]);

    tickTradeRoutes(routes, nations, provinces, neighbors, () => {});
    assert.strictEqual(nations.get("germany")!.resources.get("iron"), 0);
    assert.strictEqual(nations.get("france")!.resources.get("iron"), 3);
  });

  it("inactive (proposed/disrupted) routes do not flow", () => {
    const routes = new MapSchema<TradeRouteState>();
    const route = new TradeRouteState();
    route.route_id = "r1";
    route.nation_a_id = "germany"; route.nation_b_id = "france";
    route.kind = "land"; route.status = "proposed";
    route.a_sends_resource = "iron"; route.a_sends_rate = 10;
    routes.set("r1", route);
    const nations = new MapSchema<NationState>();
    nations.set("germany", makeNation("germany", { iron: 100 }));
    nations.set("france", makeNation("france", { iron: 0 }));
    tickTradeRoutes(routes, nations, new MapSchema<ProvinceState>(), new Map(), () => {});
    assert.strictEqual(nations.get("germany")!.resources.get("iron"), 100);
  });
});

describe("lane:economy | GameRoom integration — PLACE_MARKET_ORDER / CANCEL_MARKET_ORDER", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig, getTestPort()); });
  after(async () => { await colyseus.shutdown(); });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinTwoNations() {
    const token1 = await makeToken("user-1");
    const token2 = await makeToken("user-2");
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client1 = await colyseus.connectTo(room, { token: token1 });
    const client2 = await colyseus.connectTo(room, { token: token2 });
    await room.waitForNextPatch();
    client1.send("SELECT_NATION", { nation_id: "germany" });
    client2.send("SELECT_NATION", { nation_id: "france" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client1, client2, room };
  }

  it("owner can place a sell order they can afford, order appears (resting) in market_orders — no auto-fill against an empty book", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("iron", 100);
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 10, price: 2.0 });
    await room.waitForNextPatch();
    const order = [...room.state.market_orders.values()].find((o) => o.nation_id === "germany");
    assert.ok(order, "expected the order to rest in the book, unmatched");
    assert.strictEqual(order!.quantity, 10);
    assert.strictEqual(nation.resources.get("iron"), 90); // held in escrow, not yet earned any money
  });

  it("placing a sell order with insufficient resource stock is rejected before it reaches the book", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("iron", 1);
    const before = room.state.market_orders.size;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 100, price: 2.0 });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.market_orders.size, before);
    assert.strictEqual(nation.resources.get("iron"), 1);
  });

  // Tolerance absorbs at most one routine _economyTick() money-trickle tick landing inside the
  // assertion window when the whole lane runs slower (the room's real setInterval keeps
  // running during the test) — the trickle is tiny (population-scaled), while a wrong escrow
  // formula would be off by whole units of the spread (7.5 on a 50-money order here), so this
  // tolerance still catches a real bug without being flaky on timing alone.
  const TRICKLE_TOLERANCE = 5.0;

  it("a resting buy order escrows quantity x price x (1 + spread) immediately at placement, not just quantity x price", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("money", 1000);
    const moneyBefore = nation.resources.get("money") ?? 0;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "buy", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();
    const order = [...room.state.market_orders.values()].find((o) => o.nation_id === "germany");
    assert.ok(order, "expected the buy order to rest — empty book, no counterparty");
    const expectedEscrow = 10 * 5.0 * (1 + SPOT_SPREAD_PCT);
    assert.ok(Math.abs((nation.resources.get("money") ?? 0) - (moneyBefore - expectedEscrow)) < TRICKLE_TOLERANCE);
  });

  it("placing a buy order rejects unless money covers quantity x price x (1 + spread), the worst-case zero-fill escrow", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    // Exactly covers the raw quantity*price but NOT the spread-inclusive escrow — must reject.
    nation.resources.set("money", 10 * 5.0);
    const moneyBefore = nation.resources.get("money") ?? 0;
    const before = room.state.market_orders.size;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "buy", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.market_orders.size, before);
    assert.ok(Math.abs((nation.resources.get("money") ?? 0) - moneyBefore) < TRICKLE_TOLERANCE); // untouched — never goes negative
  });

  it("a resting buy order pays its own spread when later filled as the passive counterparty (symmetric on both legs)", async () => {
    const { client1, client2, room } = await joinTwoNations();
    const germany = room.state.nations.get("germany")!;
    const france = room.state.nations.get("france")!;
    germany.resources.set("money", 1000);
    germany.resources.set("iron", 0);
    france.resources.set("iron", 100);
    france.resources.set("money", 0);

    // Germany's buy rests first (empty book).
    const germanyMoneyBefore = germany.resources.get("money") ?? 0;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "buy", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();
    const moneyAfterEscrow = germany.resources.get("money") ?? 0;
    const expectedEscrow = 10 * 5.0 * (1 + SPOT_SPREAD_PCT);
    assert.ok(Math.abs(moneyAfterEscrow - (germanyMoneyBefore - expectedEscrow)) < TRICKLE_TOLERANCE);

    // France's sell fills germany's resting buy — germany (the passive/resting side here)
    // must NOT be charged anything further, since its escrow already reserved its own spread;
    // france (the aggressor seller) pays its own, separate spread cut via its own proceeds.
    const franceMoneyBefore = france.resources.get("money") ?? 0;
    client2.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();

    assert.strictEqual(germany.resources.get("iron"), 10);
    assert.ok(Math.abs((germany.resources.get("money") ?? 0) - moneyAfterEscrow) < TRICKLE_TOLERANCE); // no further charge
    const expectedFranceProceeds = 10 * 5.0 * (1 - SPOT_SPREAD_PCT);
    assert.ok(Math.abs((france.resources.get("money") ?? 0) - (franceMoneyBefore + expectedFranceProceeds)) < TRICKLE_TOLERANCE);
  });

  it("cancelling a resting buy order refunds the full spread-inclusive escrow", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("money", 1000);
    const moneyBefore = nation.resources.get("money") ?? 0;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "buy", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();
    const order = [...room.state.market_orders.values()].find((o) => o.nation_id === "germany");
    assert.ok(order);
    client1.send("CANCEL_MARKET_ORDER", { order_id: order!.order_id });
    await room.waitForNextPatch();
    assert.ok(Math.abs((nation.resources.get("money") ?? 0) - moneyBefore) < TRICKLE_TOLERANCE);
  });

  it("a matching buy/sell pair between two nations fills, applying the spread to both legs", async () => {
    const { client1, client2, room } = await joinTwoNations();
    const germany = room.state.nations.get("germany")!;
    const france = room.state.nations.get("france")!;
    germany.resources.set("iron", 100);
    france.resources.set("iron", 0);

    // Two genuine handler calls, no manual state seeding: france's buy rests first (book is
    // empty, no auto-NPC-fill — orders are made by players and executed by other players),
    // then germany's sell matches against that real resting order.
    client2.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "buy", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();
    const restingOrder = [...room.state.market_orders.values()].find((o) => o.nation_id === "france");
    assert.ok(restingOrder, "expected france's buy order to rest in the book");

    // Captured immediately before the trade that we're measuring, to minimize the real-time
    // window a stray routine economy tick's money trickle could land in.
    const germanyMoneyBefore = germany.resources.get("money") ?? 0;
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 10, price: 5.0 });
    await room.waitForNextPatch();

    assert.strictEqual(germany.resources.get("iron"), 90);
    assert.strictEqual(france.resources.get("iron"), 10);
    assert.strictEqual(room.state.market_orders.get(restingOrder!.order_id), undefined); // fully consumed
    const expectedProceeds = 10 * 5.0 * (1 - SPOT_SPREAD_PCT);
    assert.ok(Math.abs((germany.resources.get("money") ?? 0) - (germanyMoneyBefore + expectedProceeds)) < TRICKLE_TOLERANCE);
  });

  // Seeds a tiny opposite-side candidate directly into the book so a subsequent, much larger
  // order (placed through the real handler) partially fills and leaves a genuine resting
  // remainder distinct from the "no candidates at all" case tested above.
  function seedTinyOppositeCandidate(room: any, resourceType: string, side: "buy" | "sell", price: number) {
    const o = new MarketOrderState();
    o.order_id = "seed_tiny";
    o.nation_id = "france";
    o.resource_type = resourceType;
    o.side = side;
    o.quantity = 1;
    o.price = price;
    room.state.market_orders.set(o.order_id, o);
  }

  it("non-owner cannot cancel another nation's order", async () => {
    const { client1, client2, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("iron", 100);
    seedTinyOppositeCandidate(room, "iron", "buy", 2.0);
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 10, price: 2.0 });
    await room.waitForNextPatch();
    const order = [...room.state.market_orders.values()].find((o) => o.nation_id === "germany");
    assert.ok(order, "expected the unmatched 9-unit remainder to rest in the book");
    client2.send("CANCEL_MARKET_ORDER", { order_id: order!.order_id });
    await room.waitForNextPatch();
    assert.ok(room.state.market_orders.get(order!.order_id));
  });

  it("owner can cancel their own unfilled order, held stock is returned", async () => {
    const { client1, room } = await joinTwoNations();
    const nation = room.state.nations.get("germany")!;
    nation.resources.set("iron", 100);
    seedTinyOppositeCandidate(room, "iron", "buy", 2.0);
    client1.send("PLACE_MARKET_ORDER", { resource_type: "iron", side: "sell", quantity: 10, price: 2.0 });
    await room.waitForNextPatch();
    const order = [...room.state.market_orders.values()].find((o) => o.nation_id === "germany");
    assert.ok(order, "expected the unmatched 9-unit remainder to rest in the book");
    assert.strictEqual(order!.quantity, 9);
    const ironAfterFill = nation.resources.get("iron"); // 100 - 10 (full held at placement) + spread proceeds on the 1 filled unit's iron? no — sell holds resource, not money
    client1.send("CANCEL_MARKET_ORDER", { order_id: order!.order_id });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.market_orders.get(order!.order_id), undefined);
    // Cancelling returns the still-held 9 units; the 1 already-filled unit was already sold.
    assert.strictEqual(nation.resources.get("iron"), (ironAfterFill ?? 0) + 9);
  });
});

describe("lane:economy | GameRoom integration — trade routes", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => { colyseus = await boot(appConfig, getTestPort()); });
  after(async () => { await colyseus.shutdown(); });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function joinTwoNations() {
    const token1 = await makeToken("user-1");
    const token2 = await makeToken("user-2");
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client1 = await colyseus.connectTo(room, { token: token1 });
    const client2 = await colyseus.connectTo(room, { token: token2 });
    await room.waitForNextPatch();
    client1.send("SELECT_NATION", { nation_id: "germany" });
    client2.send("SELECT_NATION", { nation_id: "france" });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    return { client1, client2, room };
  }

  it("PROPOSE_TRADE_ROUTE between bordering nations creates a status='proposed' route", async () => {
    const { client1, room } = await joinTwoNations();
    // we6_germany_04 / we6_france_05 are confirmed bordering provinces on this map
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    const route = [...room.state.trade_routes.values()][0];
    assert.ok(route, "expected a proposed route to have been created");
    assert.strictEqual(route.status, "proposed");
  });

  it("nations at war are rejected outright", async () => {
    const { client1, room } = await joinTwoNations();
    client1.send("SET_RELATION", { nation_a: "germany", nation_b: "france", stance: "war" });
    await room.waitForNextPatch();
    const before = room.state.trade_routes.size;
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.size, before);
  });

  it("same-resource-both-sides is rejected server-side (defense in depth)", async () => {
    const { client1, room } = await joinTwoNations();
    const before = room.state.trade_routes.size;
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "iron", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.size, before);
  });

  it("RESPOND_TRADE_ROUTE(accept) by the recipient flips status to active; proposer cannot respond to their own proposal", async () => {
    const { client1, client2, room } = await joinTwoNations();
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    const route = [...room.state.trade_routes.values()][0];
    assert.ok(route);

    client1.send("RESPOND_TRADE_ROUTE", { route_id: route.route_id, accept: true });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.get(route.route_id)!.status, "proposed");

    client2.send("RESPOND_TRADE_ROUTE", { route_id: route.route_id, accept: true });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.get(route.route_id)!.status, "active");
  });

  it("RESPOND_TRADE_ROUTE(reject) removes the proposed route entirely", async () => {
    const { client1, client2, room } = await joinTwoNations();
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    const route = [...room.state.trade_routes.values()][0];
    client2.send("RESPOND_TRADE_ROUTE", { route_id: route.route_id, accept: false });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.get(route.route_id), undefined);
  });

  it("END_TRADE_ROUTE can be submitted unilaterally by either party on an active route", async () => {
    const { client1, client2, room } = await joinTwoNations();
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "land",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    const route = [...room.state.trade_routes.values()][0];
    client2.send("RESPOND_TRADE_ROUTE", { route_id: route.route_id, accept: true });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.get(route.route_id)!.status, "active");

    client2.send("END_TRADE_ROUTE", { route_id: route.route_id });
    await room.waitForNextPatch();
    assert.strictEqual(room.state.trade_routes.get(route.route_id), undefined);
  });

  it("naval (port) route eligible when both nations directly mutate a has_port province", async () => {
    const { client1, room } = await joinTwoNations();
    // Germany owns no port province on this map — force one for this eligibility test.
    for (const p of room.state.provinces.values()) {
      if (p.owner_id === "germany") { p.has_port = true; break; }
    }
    client1.send("PROPOSE_TRADE_ROUTE", {
      partner_nation_id: "france", kind: "port",
      a_sends_resource: "iron", a_sends_rate: 10,
      b_sends_resource: "grain", b_sends_rate: 5,
    });
    await room.waitForNextPatch();
    const route = [...room.state.trade_routes.values()][0];
    assert.ok(route, "expected the port route proposal to succeed once germany has a has_port province");
  });
});
