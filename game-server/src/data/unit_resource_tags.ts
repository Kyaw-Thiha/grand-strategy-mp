// Which unit_type strings participate in which resource mechanic (RESOURCE_ECONOMY.md's Oil /
// Rubber / Nitrates / Chromium sections). "motorised_infantry"/"mechanised_infantry" were added
// to UnitType in Branch C (Phase 9 Task C) — motorised infantry is an explicit oil consumer per
// RESOURCE_ECONOMY.md's Oil section ("motorised infantry, all armour...") but stays in the
// infantry/leg incapacitation bucket (Barracks-produced, 20% floor), so it is NOT a vehicle-type
// unit for rubber-wear purposes. Mechanised infantry is Tank Plant-produced and sits in the
// vehicle incapacitation bucket (30% floor) per TACTICAL_COMBAT.md/ECONOMY_BUILDINGS.md — it is
// both an oil consumer and a vehicle-type unit for rubber wear.

// Oil consumers: "all armour" + motorised/mechanised infantry (RESOURCE_ECONOMY.md's Oil
// section). Naval/air aren't part of this land-grid set; air wings get the same debuff applied
// separately (see resource_economy_system.ts's air-wing speed hook), naval doesn't exist yet.
export const OIL_CONSUMING_TYPES = new Set<string>([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp", "self_propelled_gun",
  "motorised_infantry", "mechanised_infantry",
]);

// Rubber combat-round attrition: vehicle-type units only (RESOURCE_ECONOMY.md's Rubber section
// — "vehicle-type units"). Distinct from OIL_CONSUMING_TYPES: motorised infantry consumes oil
// but is not a vehicle-type unit for rubber-wear purposes (see file header).
export const VEHICLE_TYPES = new Set<string>([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp", "self_propelled_gun",
  "mechanised_infantry",
]);

// Nitrate combat-round attrition: every remaining infantry/artillery/crew-served unit type —
// the complement of VEHICLE_TYPES across the full unit_combat_stats.ts roster
// (RESOURCE_ECONOMY.md's Nitrates section — "infantry and artillery-type units").
export const INFANTRY_ARTILLERY_TYPES = new Set<string>([
  "infantry", "assault_infantry", "recon_infantry", "mg", "cavalry", "at_infantry",
  "sniper", "flamethrower", "commando", "force_recon_sniper", "motorised_infantry",
  "artillery", "at_gun", "aa_gun", "howitzer",
]);
