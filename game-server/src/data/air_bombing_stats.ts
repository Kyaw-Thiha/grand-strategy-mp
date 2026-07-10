export const BOMBING_STATS = {
  tactical_bomber: { hp_per_plane: 8.0,  supp_per_plane: 4.0  },
  cas_plane:       { hp_per_plane: 6.0,  supp_per_plane: 8.0  },
  dive_bomber:     { hp_per_plane: 12.0, supp_per_plane: 2.0  },
} as const;

export const BOMBING_RANGE_DEG = 0.5;

export const TARGET_NOISE_FLOOR = 0.1;
