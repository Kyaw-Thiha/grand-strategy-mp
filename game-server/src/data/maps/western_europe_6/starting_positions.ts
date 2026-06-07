// Starting positions for western_europe_6.
// Playable nations: 8 divisions each, placed at province city positions.
// Non-playable neutrals: 2 divisions near their capital province.
// Coordinates are WGS84 (lng, lat) from map_data.json city_position fields.

export interface DivisionSpawnConfig {
  division_id: string;
  nation_id: string;
  lng: number;
  lat: number;
  is_neutral: boolean; // true = server-controlled, stationary
}

const PLAYABLE_POSITIONS: DivisionSpawnConfig[] = [
  // Germany — 8 divisions at province cities (near Rhine + Berlin interior)
  { division_id: "germany_div_01", nation_id: "germany", lng: 8.684450, lat: 50.063147, is_neutral: false },
  { division_id: "germany_div_02", nation_id: "germany", lng: 17.033000, lat: 51.100000, is_neutral: false },
  { division_id: "germany_div_03", nation_id: "germany", lng: 8.804892, lat: 53.052868, is_neutral: false },
  { division_id: "germany_div_04", nation_id: "germany", lng: 7.020536, lat: 51.437758, is_neutral: false },
  { division_id: "germany_div_05", nation_id: "germany", lng: 6.995000, lat: 49.237000, is_neutral: false }, // Saarbrücken — Franco-German border front
  { division_id: "germany_div_06", nation_id: "germany", lng: 13.385771, lat: 52.483566, is_neutral: false },
  { division_id: "germany_div_07", nation_id: "germany", lng: 14.553000, lat: 53.432000, is_neutral: false },
  { division_id: "germany_div_08", nation_id: "germany", lng: 10.056123, lat: 53.529503, is_neutral: false },

  // France — 8 divisions (Maginot corridor + Paris reserve + south)
  { division_id: "france_div_01", nation_id: "france", lng: 5.405745, lat: 43.335281, is_neutral: false },
  { division_id: "france_div_02", nation_id: "france", lng: 1.413266, lat: 43.575362, is_neutral: false },
  { division_id: "france_div_03", nation_id: "france", lng: 2.335453, lat: 48.896725, is_neutral: false },
  { division_id: "france_div_04", nation_id: "france", lng: 3.869983, lat: 43.609767, is_neutral: false },
  { division_id: "france_div_05", nation_id: "france", lng: 6.175000, lat: 49.123000, is_neutral: false }, // Metz — Lorraine/Maginot front
  { division_id: "france_div_06", nation_id: "france", lng: 4.828632, lat: 45.772470, is_neutral: false },
  { division_id: "france_div_07", nation_id: "france", lng: -1.666723, lat: 48.085267, is_neutral: false },
  { division_id: "france_div_08", nation_id: "france", lng: -0.577601, lat: 44.892560, is_neutral: false },

  // United Kingdom — 8 divisions (home islands)
  { division_id: "united_kingdom_div_01", nation_id: "united_kingdom", lng: -1.902741, lat: 52.542799, is_neutral: false },
  { division_id: "united_kingdom_div_02", nation_id: "united_kingdom", lng: -1.648638, lat: 55.038231, is_neutral: false },
  { division_id: "united_kingdom_div_03", nation_id: "united_kingdom", lng: -4.254251, lat: 55.862787, is_neutral: false },
  { division_id: "united_kingdom_div_04", nation_id: "united_kingdom", lng: -2.234739, lat: 53.542180, is_neutral: false },
  { division_id: "united_kingdom_div_05", nation_id: "united_kingdom", lng: -1.499997, lat: 53.366677, is_neutral: false },
  { division_id: "united_kingdom_div_06", nation_id: "united_kingdom", lng: -4.142000, lat: 50.375000, is_neutral: false },
  { division_id: "united_kingdom_div_07", nation_id: "united_kingdom", lng: -2.079987, lat: 57.170398, is_neutral: false },
  { division_id: "united_kingdom_div_08", nation_id: "united_kingdom", lng: -0.209940, lat: 51.538663, is_neutral: false },

  // Italy — 8 divisions (north + south)
  { division_id: "italy_div_01", nation_id: "italy", lng: 14.321372, lat: 40.863390, is_neutral: false },
  { division_id: "italy_div_02", nation_id: "italy", lng: 14.771645, lat: 40.703965, is_neutral: false },
  { division_id: "italy_div_03", nation_id: "italy", lng: 12.443317, lat: 41.979254, is_neutral: false },
  { division_id: "italy_div_04", nation_id: "italy", lng: 13.348081, lat: 38.126969, is_neutral: false },
  { division_id: "italy_div_05", nation_id: "italy", lng: 9.103982,  lat: 39.222398, is_neutral: false },
  { division_id: "italy_div_06", nation_id: "italy", lng: 9.189970,  lat: 45.544196, is_neutral: false },
  { division_id: "italy_div_07", nation_id: "italy", lng: 7.643775,  lat: 45.128455, is_neutral: false },
  { division_id: "italy_div_08", nation_id: "italy", lng: 11.217170, lat: 43.741406, is_neutral: false },

  // Spain — 8 divisions
  { division_id: "spain_div_01", nation_id: "spain", lng: -6.958379, lat: 38.866171, is_neutral: false },
  { division_id: "spain_div_02", nation_id: "spain", lng: 2.180324,  lat: 41.386175, is_neutral: false },
  { division_id: "spain_div_03", nation_id: "spain", lng: -5.973698, lat: 37.383055, is_neutral: false },
  { division_id: "spain_div_04", nation_id: "spain", lng: -0.891830, lat: 41.661947, is_neutral: false },
  { division_id: "spain_div_05", nation_id: "spain", lng: -0.392856, lat: 39.493067, is_neutral: false },
  { division_id: "spain_div_06", nation_id: "spain", lng: -3.675196, lat: 40.373968, is_neutral: false },
  { division_id: "spain_div_07", nation_id: "spain", lng: -8.702109, lat: 42.166298, is_neutral: false },
  { division_id: "spain_div_08", nation_id: "spain", lng: -2.929239, lat: 43.251366, is_neutral: false },

  // Algeria — 8 divisions
  { division_id: "algeria_div_01", nation_id: "algeria", lng: 6.859984, lat: 33.370404, is_neutral: false },
  { division_id: "algeria_div_02", nation_id: "algeria", lng: 8.117571, lat: 35.403780, is_neutral: false },
  { division_id: "algeria_div_03", nation_id: "algeria", lng: 5.049169, lat: 36.726041, is_neutral: false },
  { division_id: "algeria_div_04", nation_id: "algeria", lng: -0.635264, lat: 35.698603, is_neutral: false },
  { division_id: "algeria_div_05", nation_id: "algeria", lng: 3.080039, lat: 36.747008, is_neutral: false },
  { division_id: "algeria_div_06", nation_id: "algeria", lng: 6.601461, lat: 36.358476, is_neutral: false },
  { division_id: "algeria_div_07", nation_id: "algeria", lng: 6.176935, lat: 35.563969, is_neutral: false },
  { division_id: "algeria_div_08", nation_id: "algeria", lng: 3.250605, lat: 34.680390, is_neutral: false },
];

// Non-playable neutrals: 2 divisions per nation, near capital city, stationary
const NEUTRAL_POSITIONS: DivisionSpawnConfig[] = [
  // Belgium — Brussels area
  { division_id: "belgium_div_01", nation_id: "belgium", lng: 4.293783, lat: 50.809396, is_neutral: true },
  { division_id: "belgium_div_02", nation_id: "belgium", lng: 4.353783, lat: 50.849396, is_neutral: true },

  // Netherlands — Amsterdam area
  { division_id: "netherlands_div_01", nation_id: "netherlands", lng: 4.914658, lat: 52.329414, is_neutral: true },
  { division_id: "netherlands_div_02", nation_id: "netherlands", lng: 4.974658, lat: 52.369414, is_neutral: true },

  // Switzerland — Bern area
  { division_id: "switzerland_div_01", nation_id: "switzerland", lng: 7.468737, lat: 46.929172, is_neutral: true },
  { division_id: "switzerland_div_02", nation_id: "switzerland", lng: 7.528737, lat: 46.969172, is_neutral: true },

  // Portugal — Lisbon + Porto
  { division_id: "portugal_div_01", nation_id: "portugal", lng: -9.170150, lat: 38.751196, is_neutral: true },
  { division_id: "portugal_div_02", nation_id: "portugal", lng: -8.614000, lat: 41.155000, is_neutral: true },

  // Denmark — Copenhagen area
  { division_id: "denmark_div_01", nation_id: "denmark", lng: 12.561540, lat: 55.680510, is_neutral: true },
  { division_id: "denmark_div_02", nation_id: "denmark", lng: 12.621540, lat: 55.720510, is_neutral: true },

  // Yugoslavia — Belgrade area
  { division_id: "yugoslavia_div_01", nation_id: "yugoslavia", lng: 17.179974, lat: 44.780405, is_neutral: true },
  { division_id: "yugoslavia_div_02", nation_id: "yugoslavia", lng: 21.165984, lat: 42.666710, is_neutral: true },

  // Poland — Warsaw area
  { division_id: "poland_div_01", nation_id: "poland", lng: 20.997392, lat: 52.235958, is_neutral: true },
  { division_id: "poland_div_02", nation_id: "poland", lng: 19.020158, lat: 50.261649, is_neutral: true },
];

export const STARTING_POSITIONS: DivisionSpawnConfig[] = [
  ...PLAYABLE_POSITIONS,
  ...NEUTRAL_POSITIONS,
];
