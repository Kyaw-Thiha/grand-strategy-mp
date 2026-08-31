// Which unit_type strings participate in which resource mechanic (RESOURCE_ECONOMY.md's Oil /
// Rubber / Nitrates / Chromium sections). No "motorised_infantry"/"mechanised_infantry" unit
// type exists anywhere in this codebase yet (confirmed against unit_combat_stats.ts) — the
// design docs' "motorised infantry" phrase is covered by the vehicle/armour set below until a
// distinct motorised infantry unit type is actually added elsewhere; not invented here.

// Oil consumers: "all armour" (RESOURCE_ECONOMY.md's Oil section) — every vehicle-type land
// unit. Naval/air aren't part of this land-grid set; air wings get the same debuff applied
// separately (see resource_economy_system.ts's air-wing speed hook), naval doesn't exist yet.
export const OIL_CONSUMING_TYPES = new Set<string>([
  "light_tank", "medium_tank", "heavy_tank", "armoured_car", "at_gun_sp", "self_propelled_gun",
]);

// Rubber combat-round attrition: same vehicle/armour set as oil (RESOURCE_ECONOMY.md's Rubber
// section — "vehicle-type units").
export const VEHICLE_TYPES = OIL_CONSUMING_TYPES;

// Nitrate combat-round attrition: every remaining infantry/artillery/crew-served unit type —
// the complement of VEHICLE_TYPES across the full unit_combat_stats.ts roster
// (RESOURCE_ECONOMY.md's Nitrates section — "infantry and artillery-type units").
export const INFANTRY_ARTILLERY_TYPES = new Set<string>([
  "infantry", "assault_infantry", "recon_infantry", "mg", "cavalry", "at_infantry",
  "sniper", "flamethrower", "commando", "force_recon_sniper",
  "artillery", "at_gun", "aa_gun", "howitzer",
]);
