import { Schema, type } from "@colyseus/schema";

export class NavalContactMarkerState extends Schema {
  @type("string") marker_id:      string  = "";
  @type("string") nation_id:      string  = "";
  @type("string") quality:        string  = "";
  @type("number") position_lng:   number  = 0;
  @type("number") position_lat:   number  = 0;
  @type("number") radius_deg:     number  = 0;
  @type("number") expires_at_ms:  number  = 0;
  @type("boolean") is_refreshable: boolean = false;
}

export function serializeNavalContactMarker(m: NavalContactMarkerState) {
  return {
    marker_id:      m.marker_id,
    nation_id:      m.nation_id,
    quality:        m.quality,
    position_lng:   m.position_lng,
    position_lat:   m.position_lat,
    radius_deg:     m.radius_deg,
    expires_at_ms:  m.expires_at_ms,
    is_refreshable: m.is_refreshable,
  };
}
