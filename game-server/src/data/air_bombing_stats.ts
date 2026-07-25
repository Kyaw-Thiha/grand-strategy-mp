export const BOMBING_STATS = {
  tactical_bomber: { hp_per_plane: 8.0,  supp_per_plane: 4.0  },
  cas_plane:       { hp_per_plane: 6.0,  supp_per_plane: 8.0  },
  dive_bomber:     { hp_per_plane: 12.0, supp_per_plane: 2.0  },
} as const;

export const BOMBING_RANGE_DEG = 0.5;

export const TARGET_NOISE_FLOOR = 0.1;

export const PROVINCE_BOMBING_STATS: Record<string, {
  population_damage:     number;
  infrastructure_damage: number;
  industry_damage:       number;
}> = {
  strategic_bomber: { population_damage: 0.4, infrastructure_damage: 0.3, industry_damage: 0.5 },
  tactical_bomber:  { population_damage: 0.2, infrastructure_damage: 0.2, industry_damage: 0.3 },
};

const DEFAULT_PROVINCE_STATS = {
  population_damage: 0.1, infrastructure_damage: 0.1, industry_damage: 0.1,
};

export function getProvinceBombingStats(aircraftType: string) {
  return PROVINCE_BOMBING_STATS[aircraftType] ?? DEFAULT_PROVINCE_STATS;
}

export let OIL_DEBUFF_DURATION_MS = 120_000;

export function setOilDebuffDurationForTesting(ms: number): void {
  OIL_DEBUFF_DURATION_MS = ms;
}
