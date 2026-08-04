export interface AirUnitStats {
  attack_vs_air:        number;
  defense_vs_air:       number;
  observation_deg:      number;
  min_turn_radius_deg:  number;
  speed_deg_per_ms:     number;
  attack_vs_air_perked?: number;
}

const STAT_TABLE: Record<string, AirUnitStats> = {
  fighter:          { attack_vs_air: 0.25, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.30, speed_deg_per_ms: 0.00024 },
  heavy_fighter:    { attack_vs_air: 0.22, defense_vs_air: 0.05, observation_deg: 0.25, min_turn_radius_deg: 0.50, speed_deg_per_ms: 0.00021 },
  cas_plane:        { attack_vs_air: 0.05, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.30, speed_deg_per_ms: 0.00018, attack_vs_air_perked: 0.15 },
  dive_bomber:      { attack_vs_air: 0.05, defense_vs_air: 0.03, observation_deg: 0.05, min_turn_radius_deg: 0.40, speed_deg_per_ms: 0.00018, attack_vs_air_perked: 0.15 },
  tactical_bomber:  { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.50, speed_deg_per_ms: 0.00019 },
  strategic_bomber: { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.65, speed_deg_per_ms: 0.00016 },
  naval_bomber:     { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05, min_turn_radius_deg: 0.40, speed_deg_per_ms: 0.00018 },
  recon_plane:      { attack_vs_air: 0.0,  defense_vs_air: 0.01, observation_deg: 1.0,  min_turn_radius_deg: 0.30, speed_deg_per_ms: 0.00019 },
};

const DEFAULT_STATS: AirUnitStats = { attack_vs_air: 0.0, defense_vs_air: 0.0, observation_deg: 0.05, min_turn_radius_deg: 0.30, speed_deg_per_ms: 0.0002 };

// Module-level override: when set, supersedes stat table for all non-recon_plane types.
// Used by setPassiveWingRadiusForTesting() in air_detection_system.ts for 12d backwards-compat.
let _passiveOverride: number | null = null;

export function setPassiveObservationOverrideForTesting(v: number | null): void {
  _passiveOverride = v;
}

export function getAirUnitStats(aircraftType: string): AirUnitStats {
  return STAT_TABLE[aircraftType] ?? DEFAULT_STATS;
}

export const MAX_FORMATION_BONUS   = 0.4;
export const FORMATION_DENSITY_CAP = 36;

export function getObservationDeg(aircraftType: string): number {
  if (_passiveOverride !== null && aircraftType !== "recon_plane") return _passiveOverride;
  return (STAT_TABLE[aircraftType] ?? DEFAULT_STATS).observation_deg;
}

export function getWingSpeedDegPerMs(aircraftType: string): number {
  return (STAT_TABLE[aircraftType] ?? DEFAULT_STATS).speed_deg_per_ms;
}
