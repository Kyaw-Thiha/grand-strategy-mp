export const NAVAL_CONTACT_QUALITY = {
  MARITIME_PATROL: "maritime_patrol",
  CARGO_SINKING:   "cargo_sinking",
  FLOTILLA_SCOUT:  "flotilla_scout",
} as const;

export type NavalContactQuality =
  typeof NAVAL_CONTACT_QUALITY[keyof typeof NAVAL_CONTACT_QUALITY];

export const QUALITY_DEFAULTS: Record<string, {
  radius_deg: number;
  duration_ms: number;
  is_refreshable: boolean;
}> = {
  maritime_patrol: { radius_deg: 0.15, duration_ms: 60_000, is_refreshable: true  },
  cargo_sinking:   { radius_deg: 0.8,  duration_ms: 20_000, is_refreshable: false },
  flotilla_scout:  { radius_deg: 0.4,  duration_ms: 40_000, is_refreshable: false },
};
