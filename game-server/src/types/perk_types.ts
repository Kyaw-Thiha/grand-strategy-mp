export interface PerkModifiers {
  damage_mult: number;
  suppression_mult: number;
  suppression_resist_mult: number;
  movement_mult: number;
  observation_mult: number;
  recon_mult: number;
}

export const IDENTITY_MODIFIERS: PerkModifiers = {
  damage_mult: 1.0,
  suppression_mult: 1.0,
  suppression_resist_mult: 1.0,
  movement_mult: 1.0,
  observation_mult: 1.0,
  recon_mult: 1.0,
};

export type PerkScope = "unit_type" | "global" | "formation_synergy";

export interface PerkDefinition {
  perk_id: string;
  scope: PerkScope;
  applies_to_unit?: string;
  synergy_units?: [string, string];
  modifiers: Partial<PerkModifiers>;
}
