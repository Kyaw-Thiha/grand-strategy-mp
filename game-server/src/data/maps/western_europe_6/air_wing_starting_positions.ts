// Starting air wings for western_europe_6.
// One fighter wing per nation, spawned at capital province city_position from map_data.json.

export interface AirWingSpawnConfig {
  wing_id: string;
  nation_id: string;
  lng: number;
  lat: number;
  aircraft_type: string;
  home_airbase_province_id: string;
}

export const AIR_WING_STARTING_POSITIONS: AirWingSpawnConfig[] = [
  { wing_id: "germany_wing_01",        nation_id: "germany",        lng: 13.385771, lat: 52.483566, aircraft_type: "fighter", home_airbase_province_id: "we6_germany_06" },
  { wing_id: "france_wing_01",         nation_id: "france",         lng:  2.335453, lat: 48.896725, aircraft_type: "fighter", home_airbase_province_id: "we6_france_03" },
  { wing_id: "united_kingdom_wing_01", nation_id: "united_kingdom", lng: -0.209940, lat: 51.538663, aircraft_type: "fighter", home_airbase_province_id: "we6_united_kingdom_08" },
  { wing_id: "spain_wing_01",          nation_id: "spain",          lng: -3.675196, lat: 40.373968, aircraft_type: "fighter", home_airbase_province_id: "we6_spain_06" },
  { wing_id: "algeria_wing_01",        nation_id: "algeria",        lng:  3.080039, lat: 36.747008, aircraft_type: "fighter", home_airbase_province_id: "we6_algeria_05" },
  { wing_id: "italy_wing_01",          nation_id: "italy",          lng: 12.443317, lat: 41.979254, aircraft_type: "fighter", home_airbase_province_id: "we6_italy_03" },
];
