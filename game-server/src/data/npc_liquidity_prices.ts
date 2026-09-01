// Phase 9 Branch D — NPC liquidity floor for the spot market.
// Not real standing orders — a price fallback applied only when no compatible player order
// exists in the book, so a player is never stuck unable to trade. TBD playtesting — placeholder
// values, round numbers, not derived from any balancing pass.

export const NPC_BASE_PRICE: Record<string, number> = {
  money: 1.0, // money is the trade medium itself, not traded against itself in practice
  grain: 1.5,
  iron: 2.5,
  oil: 4.0,
  rubber: 5.0,
  nitrates: 3.5,
  tungsten: 8.0,
  chromium: 10.0,
  aluminium: 6.0,
  uranium: 20.0,
};

// The NPC floor is always slightly worse than a "fair" price for the player, on both sides —
// a safety net, not a good deal. TBD playtesting.
export const NPC_SPREAD = 0.1;

export function npcFallbackPrice(resourceType: string, side: "buy" | "sell"): number {
  const base = NPC_BASE_PRICE[resourceType] ?? 1.0;
  // Player selling to the NPC gets a worse (lower) price; player buying from the NPC pays a
  // worse (higher) price than the base reference.
  return side === "sell" ? base * (1 - NPC_SPREAD) : base * (1 + NPC_SPREAD);
}
