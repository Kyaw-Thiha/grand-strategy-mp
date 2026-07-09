export interface AirUnitStats {
  attack_vs_air: number;
  defense_vs_air: number;
  observation_deg: number;
}

const STAT_TABLE: Record<string, AirUnitStats> = {
  fighter:          { attack_vs_air: 0.25, defense_vs_air: 0.03, observation_deg: 0.25 },
  heavy_fighter:    { attack_vs_air: 0.22, defense_vs_air: 0.05, observation_deg: 0.35 },
  cas_plane:        { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.05 },
  dive_bomber:      { attack_vs_air: 0.0,  defense_vs_air: 0.03, observation_deg: 0.05 },
  tactical_bomber:  { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05 },
  strategic_bomber: { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05 },
  naval_bomber:     { attack_vs_air: 0.0,  defense_vs_air: 0.02, observation_deg: 0.05 },
  recon_plane:      { attack_vs_air: 0.0,  defense_vs_air: 0.01, observation_deg: 1.0  },
};

const DEFAULT_STATS: AirUnitStats = { attack_vs_air: 0.0, defense_vs_air: 0.0, observation_deg: 0.05 };

// Module-level override: when set, supersedes stat table for all non-recon_plane types.
// Used by setPassiveWingRadiusForTesting() in air_detection_system.ts for 12d backwards-compat.
let _passiveOverride: number | null = null;

export function setPassiveObservationOverrideForTesting(v: number | null): void {
  _passiveOverride = v;
}

export function getAirUnitStats(aircraftType: string): AirUnitStats {
  return STAT_TABLE[aircraftType] ?? DEFAULT_STATS;
}

export function getObservationDeg(aircraftType: string): number {
  if (_passiveOverride !== null && aircraftType !== "recon_plane") return _passiveOverride;
  return (STAT_TABLE[aircraftType] ?? DEFAULT_STATS).observation_deg;
}
