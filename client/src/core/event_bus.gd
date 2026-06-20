extends Node
## Global signal relay. Modules never hold direct references to each other —
## they communicate only through signals emitted here.
## No state, no logic. Pure relay.

# ── Map ──────────────────────────────────────────────────────────────────────
signal province_changed(province_id: String)
signal province_captured(province_id: String, new_owner_id: String)
signal frontline_updated(province_id: String, nation_shares: Dictionary)

# ── Military ─────────────────────────────────────────────────────────────────
signal unit_changed(unit_id: String)
signal combat_started(division_a: String, division_b: String, is_meeting_battle: bool)
signal combat_resolved(province_id: String, outcome: Dictionary)
signal unit_destroyed(division_id: String, nation_id: String)
signal flank_attack(flanker_id: String, defender_id: String)
signal rear_attack(flanker_id: String, defender_id: String)

# ── Divisions (Phase 4) ───────────────────────────────────────────────────────
signal division_added(division_id: String)
signal division_updated(division_id: String)
signal division_removed(division_id: String)
signal division_selected(division_id: String)
signal division_deselected()

# ── Players / session ────────────────────────────────────────────────────────
signal player_changed(user_id: String)
signal player_eliminated(user_id: String)
signal phase_changed(phase: String)
signal lobby_state_updated()

# ── Diplomacy ────────────────────────────────────────────────────────────────
signal relation_changed(from_id: String, to_id: String)
signal diplo_proposal_received(proposal: Dictionary)
signal diplo_resolved(proposal_id: String, accepted: bool)

# ── UI ───────────────────────────────────────────────────────────────────────
signal notification_requested(message: String, type: String)
