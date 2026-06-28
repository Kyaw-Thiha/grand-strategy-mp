import type { PerkDefinition, PerkModifiers, SpecialAttackConfig } from "../types/perk_types.js";
import { IDENTITY_MODIFIERS, DEFAULT_SNIPER_CONFIG, DEFAULT_ARTILLERY_CONFIG } from "../types/perk_types.js";

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

  // Sniper doctrine tree
  "sniper_multitarget_1": {
    perk_id:         "sniper_multitarget_1",
    scope:           "unit_type",
    applies_to_unit: "sniper",
    modifiers:       {},
    attack_config:   { n_targets: 2 },
  },
  "sniper_counter_armour_doctrine": {
    perk_id:         "sniper_counter_armour_doctrine",
    scope:           "unit_type",
    applies_to_unit: "sniper",
    modifiers:       {},
    attack_config: {
      priority_list: ["heavy_tank","medium_tank","light_tank","armoured_car","at_gun_sp","at_gun"],
    },
  },

  // Artillery doctrine tree
  "arty_area_1": {
    perk_id:         "arty_area_1",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { area_radius: 1 },
  },
  "arty_area_2": {
    perk_id:         "arty_area_2",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { area_radius: 2 },
  },
  "arty_precision_fire": {
    perk_id:         "arty_precision_fire",
    scope:           "unit_type",
    applies_to_unit: "artillery",
    modifiers:       {},
    attack_config:   { falloff_per_col: 0.5 },
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

const _ARTY_UNIT_TYPES = new Set(["artillery", "howitzer", "self_propelled_gun"]);

/**
 * Resolves SpecialAttackConfig for a unit type given active perk IDs.
 * Returns a MUTABLE COPY — caller must set recon_value and rng_seed before use.
 *
 * Stacking rules:
 *   n_targets, area_radius   → max() across all applicable perks
 *   falloff_per_col          → last applicable perk wins
 *   priority_list            → last applicable perk fully replaces default
 */
export function resolveAttackConfig(
  unitType:      string,
  activePerkIds: string[],
): SpecialAttackConfig {
  const result: SpecialAttackConfig = _ARTY_UNIT_TYPES.has(unitType)
    ? { ...DEFAULT_ARTILLERY_CONFIG }
    : { ...DEFAULT_SNIPER_CONFIG, priority_list: [...DEFAULT_SNIPER_CONFIG.priority_list] };

  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def)                           continue;
    if (def.scope !== "unit_type")      continue;
    if (def.applies_to_unit !== unitType) continue;
    if (!def.attack_config)             continue;

    const ac = def.attack_config;
    if (ac.n_targets      !== undefined) result.n_targets      = Math.max(result.n_targets, ac.n_targets);
    if (ac.area_radius    !== undefined) result.area_radius    = Math.max(result.area_radius, ac.area_radius);
    if (ac.falloff_per_col !== undefined) result.falloff_per_col = ac.falloff_per_col;
    if (ac.priority_list  !== undefined) result.priority_list  = [...ac.priority_list];
  }

  return result;
}
