import type { PerkDefinition, PerkModifiers } from "../types/perk_types.js";
import { IDENTITY_MODIFIERS } from "../types/perk_types.js";

export const PERK_REGISTRY: Record<string, PerkDefinition> = {
  // Infantry specialization tree (suppression resistance)
  "infantry_suppression_resist_1": {
    perk_id: "infantry_suppression_resist_1",
    scope: "unit_type",
    applies_to_unit: "infantry",
    modifiers: { suppression_resist_mult: 1.10 },
  },
  "infantry_suppression_resist_2": {
    perk_id: "infantry_suppression_resist_2",
    scope: "unit_type",
    applies_to_unit: "infantry",
    modifiers: { suppression_resist_mult: 1.20 },
  },
  "infantry_suppression_resist_3": {
    perk_id: "infantry_suppression_resist_3",
    scope: "unit_type",
    applies_to_unit: "infantry",
    modifiers: { suppression_resist_mult: 1.35 },
  },

  // Cavalry specialization tree (charge damage)
  "cavalry_charge_damage_1": {
    perk_id: "cavalry_charge_damage_1",
    scope: "unit_type",
    applies_to_unit: "cavalry",
    modifiers: { damage_mult: 1.15 },
  },
  "cavalry_charge_damage_2": {
    perk_id: "cavalry_charge_damage_2",
    scope: "unit_type",
    applies_to_unit: "cavalry",
    modifiers: { damage_mult: 1.30 },
  },
  "cavalry_charge_damage_3": {
    perk_id: "cavalry_charge_damage_3",
    scope: "unit_type",
    applies_to_unit: "cavalry",
    modifiers: { damage_mult: 1.50 },
  },

  // Armour specialization tree (flank resistance)
  "armour_flank_resist_1": {
    perk_id: "armour_flank_resist_1",
    scope: "unit_type",
    applies_to_unit: "light_tank",
    modifiers: { damage_mult: 1.10 },
  },

  // Formation synergy (handled in combat round logic, not resolvePerkModifiers)
  "sniper_recon_enhanced": {
    perk_id: "sniper_recon_enhanced",
    scope: "formation_synergy",
    synergy_units: ["sniper", "recon_infantry"],
    modifiers: { recon_mult: 1.25 },
  },
};

/** Resolve combined PerkModifiers for a unit type given a list of active perk IDs.
 *  Multipliers stack multiplicatively. Unknown IDs and formation_synergy scope are skipped. */
export function resolvePerkModifiers(
  unitType: string,
  activePerkIds: string[]
): PerkModifiers {
  const result: PerkModifiers = { ...IDENTITY_MODIFIERS };
  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def) continue;
    if (def.scope === "unit_type" && def.applies_to_unit !== unitType) continue;
    if (def.scope === "formation_synergy") continue;
    for (const [key, val] of Object.entries(def.modifiers)) {
      (result as unknown as Record<string, number>)[key] *= val as number;
    }
  }
  return result;
}
