import type { PerkDefinition, PerkModifiers, SpecialAttackConfig } from "../types/perk_types.js";
import { IDENTITY_MODIFIERS, DEFAULT_SNIPER_CONFIG, DEFAULT_ARTILLERY_CONFIG } from "../types/perk_types.js";
import {
  XP_HP_FULL_THRESHOLD,
  XP_RETENTION_INCAP_WIN,
  XP_RETENTION_DAMAGED,
} from "../data/combat_constants.js";

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

  // ── Stealth perks ──────────────────────────────────────────────────────────

  "sniper_forest_stealth": {
    perk_id: "sniper_forest_stealth",
    scope: "unit_type",
    applies_to_unit: "sniper",
    modifiers: {},
    terrain_stealth_bonus: { "light_forest": 1, "dense_forest": 2 },
  },
  "sniper_urban_stealth": {
    perk_id: "sniper_urban_stealth",
    scope: "unit_type",
    applies_to_unit: "sniper",
    modifiers: {},
    terrain_stealth_bonus: { "urban": 2 },
  },
  "commando_stealth_doctrine": {
    perk_id: "commando_stealth_doctrine",
    scope: "unit_type",
    applies_to_unit: "commando",
    modifiers: {},
    terrain_stealth_bonus: { "light_forest": 1, "dense_forest": 2, "urban": 2, "hills": 1 },
  },
  "elite_unit_doctrine": {
    perk_id: "elite_unit_doctrine",
    scope: "unit_type",
    applies_to_unit: "commando",
    modifiers: { xp_gain_mult: 1.25 },
    xp_config: { incap_retention: 0.55 },
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

/**
 * Returns unit_type → terrain stealth bonus for the given terrain cover string.
 * Stacks additively across all applicable perks for the same unit type.
 */
export function resolveTerrainStealthBonuses(
  terrain:       string,
  activePerkIds: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def || def.scope !== "unit_type" || !def.terrain_stealth_bonus || !def.applies_to_unit) continue;
    const bonus = def.terrain_stealth_bonus[terrain];
    if (!bonus) continue;
    result[def.applies_to_unit] = (result[def.applies_to_unit] ?? 0) + bonus;
  }
  return result;
}

/**
 * Returns effective XP config for a unit type. Last applicable perk wins per field.
 */
export function resolveXpConfig(
  unitType:      string,
  activePerkIds: string[],
): { full_hp_threshold: number; incap_retention: number; damaged_retention: number } {
  const result = {
    full_hp_threshold: XP_HP_FULL_THRESHOLD,
    incap_retention:   XP_RETENTION_INCAP_WIN,
    damaged_retention: XP_RETENTION_DAMAGED,
  };
  for (const id of activePerkIds) {
    const def = PERK_REGISTRY[id];
    if (!def || def.scope !== "unit_type" || def.applies_to_unit !== unitType || !def.xp_config) continue;
    if (def.xp_config.full_hp_threshold !== undefined) result.full_hp_threshold = def.xp_config.full_hp_threshold;
    if (def.xp_config.incap_retention   !== undefined) result.incap_retention   = def.xp_config.incap_retention;
    if (def.xp_config.damaged_retention !== undefined) result.damaged_retention = def.xp_config.damaged_retention;
  }
  return result;
}
