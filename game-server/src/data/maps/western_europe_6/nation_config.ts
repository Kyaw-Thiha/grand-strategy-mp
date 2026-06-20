// Nation availability config for western_europe_6.
// Shared across all 6 playable nations — per-nation divergence handled in Phase 5.

export const NATION_CONFIG = {
  available_units: [
    "standard_infantry",
    "machine_gun",
    "light_artillery",
    "light_tank",
    "cavalry",
  ],
  cavalry_available: true,
  research_starting_unlocks: [] as string[],
};
