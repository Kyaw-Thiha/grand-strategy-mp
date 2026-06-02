extends Node
## Global signal relay. Modules never hold direct references to each other —
## they communicate only through signals emitted here.
## No state, no logic. Pure relay.

# ── Map ──────────────────────────────────────────────────────────────────────
signal province_changed(province_id: String)
signal province_captured(province_id: String, new_owner_id: String)

# ── Military ─────────────────────────────────────────────────────────────────
signal unit_changed(unit_id: String)
signal combat_started(province_id: String)
signal combat_resolved(province_id: String, outcome: Dictionary)

# ── Players / session ────────────────────────────────────────────────────────
signal player_changed(user_id: String)
signal player_eliminated(user_id: String)
signal phase_changed(phase: String)

# ── Diplomacy ────────────────────────────────────────────────────────────────
signal relation_changed(from_id: String, to_id: String)
signal diplo_proposal_received(proposal: Dictionary)
signal diplo_resolved(proposal_id: String, accepted: bool)

# ── UI ───────────────────────────────────────────────────────────────────────
signal notification_requested(message: String, type: String)
