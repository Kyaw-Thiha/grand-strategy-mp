class_name AirWingConstants
extends RefCounted

const MISSION_IDLE               := "idle"
const MISSION_TACTICAL_BOMBING   := "tactical_bombing"
const MISSION_INTERCEPTION       := "interception"
const MISSION_AIR_SUPERIORITY    := "air_superiority"
const MISSION_ESCORT             := "escort"
const MISSION_LOGISTICS          := "logistics"
const MISSION_AREA               := "area"
const MISSION_INDUSTRY           := "industry"
const MISSION_OIL                := "oil"
const MISSION_RECON              := "recon"
const MISSION_TRADE_INTERDICTION := "trade_interdiction"
const MISSION_ANTI_SUBMARINE     := "anti_submarine"
const MISSION_ANTI_SHIP          := "anti_ship"
const MISSION_PORT_STRIKE        := "port_strike"

const BASE_ELIGIBLE_MISSIONS := {
	"fighter":          [MISSION_IDLE, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION, MISSION_ESCORT],
	"heavy_fighter":    [MISSION_IDLE, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION, MISSION_ESCORT],
	"cas_plane":        [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION],
	"dive_bomber":      [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AIR_SUPERIORITY, MISSION_INTERCEPTION],
	"tactical_bomber":  [MISSION_IDLE, MISSION_TACTICAL_BOMBING, MISSION_AREA, MISSION_INDUSTRY, MISSION_OIL, MISSION_LOGISTICS],
	"strategic_bomber": [MISSION_IDLE, MISSION_AREA, MISSION_INDUSTRY, MISSION_OIL, MISSION_LOGISTICS],
	"naval_bomber":     [MISSION_IDLE, MISSION_TRADE_INTERDICTION, MISSION_ANTI_SUBMARINE, MISSION_ANTI_SHIP, MISSION_PORT_STRIKE],
	"recon_plane":      [MISSION_IDLE, MISSION_RECON],
}


static func get_eligible_missions(aircraft_type: String, wing_data: Dictionary) -> Array:
	var missions: Array = BASE_ELIGIBLE_MISSIONS.get(aircraft_type, [MISSION_IDLE]).duplicate()

	var has_strafing: bool = wing_data.get("perk_strafing", false)
	if has_strafing and aircraft_type in ["fighter", "heavy_fighter"]:
		missions.append(MISSION_TACTICAL_BOMBING)

	return missions


static func mission_label(mission: String) -> String:
	return mission.replace("_", " ").capitalize()
