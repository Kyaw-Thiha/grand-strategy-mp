export interface LobbyEntry {
  join_code: string;
  room_id: string | null;
  host_player_id: string;
  created_at: number;
}

/** In-memory lobby registry. Ephemeral — cleared on server restart. */
export const lobbies = new Map<string, LobbyEntry>();
