extends Node
## Global signal relay. Modules never hold direct references to each other —
## they communicate only through signals emitted here.
## No state, no logic. Pure relay.

# ── Map ──────────────────────────────────────────────────────────────────────
signal province_changed(province_id: String)
signal province_captured(province_id: String, new_owner_id: String)
signal subprovince_captured(subprovince_id: String, province_id: String, new_owner_id: String)
signal province_contest_updated(province_id: String, contested: bool)
signal vision_visibility_changed(visible_provinces: Dictionary)
signal supply_hub_completed(province_id: String)
signal supply_route_updated(division_id: String, route: Dictionary)

# ── Military ─────────────────────────────────────────────────────────────────
signal unit_changed(unit_id: String)
signal combat_started(division_a: String, division_b: String, is_meeting_battle: bool)
signal combat_resolved(province_id: String, outcome: Dictionary)
signal unit_destroyed(division_id: String, nation_id: String)
signal flank_attack(attacker_a: String, defender_id: String)
signal rear_attack(attacker_a: String, defender_id: String)

# ── Tactical Combat ──────────────────────────────────────────────────────────
signal round_resolved(engagement_id: String, round_number: int, lethality_phase: String, attacker_grid_delta: Array, defender_grid_delta: Array, formation_bonuses_active: Array, ticks_until_next_round: int)
signal unit_incapacitated(division_id: String, cell_index: int)
signal tactical_combat_opened(engagement_id: String)
signal tactical_combat_closed()

# ── Divisions (Phase 4) ───────────────────────────────────────────────────────
signal division_added(division_id: String)
signal division_updated(division_id: String)
signal division_removed(division_id: String)
signal stack_formed(stack_id: String, division_ids: Array)
signal stack_rotated(stack_id: String, rotated_back: String, new_front: String)
signal stack_dissolved(stack_id: String)
signal division_selected(division_id: String)
signal division_deselected()
signal division_selection_changed(division_ids: Array[String])
signal division_active_changed(division_id: String)
signal division_hover_changed(division_id: String)
signal division_screen_position_updated(division_id: String, screen_position: Vector2)
signal division_inspector_requested(division_id: String)
signal division_active_requested(division_id: String)
signal division_selection_remove_requested(division_id: String)
signal division_hold_selected_requested()
signal division_hold_requested(division_id: String)
signal division_hold_eligibility_changed(division_id: String, eligible: bool)
signal division_retreat_selected_requested()
signal division_retreat_requested(division_id: String)
signal division_retreat_eligibility_changed(division_id: String, eligible: bool)
signal division_center_camera_requested(division_id: String)

# ── Players / session ────────────────────────────────────────────────────────
signal player_changed(user_id: String)
signal player_eliminated(user_id: String)
signal phase_changed(phase: String)
signal lobby_state_updated()

# ── Diplomacy ────────────────────────────────────────────────────────────────
signal relation_changed(from_id: String, to_id: String)
signal diplo_proposal_received(proposal: Dictionary)
signal diplo_resolved(proposal_id: String, accepted: bool)

# ── Research ─────────────────────────────────────────────────────────────────
signal research_started(entry_id: String)
signal research_progress_changed(entry_id: String, progress: float)
signal research_completed(entry_id: String, effects: Dictionary)
signal research_rejected(entry_id: String, reason: String)

# ── Selection (Phase 5c) ─────────────────────────────────────────────────────
signal province_selected(province_id: String)
signal province_deselected()
signal stack_selected(division_ids: Array)  # placeholder for future multi-select
signal move_mode_requested(division_id: String)
signal reposition_mode_requested(div_id: String)

# ── UI ───────────────────────────────────────────────────────────────────────
signal notification_requested(message: String, type: String)
signal interactive_notification_requested(notification: Dictionary)
signal interactive_notification_updated(notification: Dictionary)
signal map_mode_changed(mode: String)   # "political" | "cover" | "elevation"
signal settings_requested()
signal pause_menu_blocking_changed(blocking: bool)
signal ui_pointer_blocking_changed(blocking: bool)
signal ui_text_input_focus_changed(focused: bool)
signal move_mode_cancelled()
signal move_mode_active_changed(active: bool)
signal notification_cycle_next()
signal chat_message_received(time: String, email: String, message: String)
signal chat_input_focus_changed(focused: bool)

# ── Division Builder ───────────────────────────────────────────────────────
signal division_builder_open_requested(template_id: String)  # "" = new blank template
signal division_builder_closed()

# ── Division Template Viewer ─────────────────────────────────────────────
signal division_template_viewer_open_requested(division_id: String)
signal division_template_viewer_closed()

# ── Air Wings ─────────────────────────────────────────────────────────────────
signal air_wing_added(wing_id: String)
signal air_wing_updated(wing_id: String)
signal air_wing_removed(wing_id: String)
signal air_wing_selected(wing_id: String)
signal air_wing_deselected()
signal air_wing_path(path_data: Dictionary)
signal air_wing_detected(wing_id: String)
signal air_wing_detection_lost(wing_id: String)
signal air_combat_started(data: Dictionary)
signal air_combat_ended(data: Dictionary)
signal radar_updated(data: Dictionary)
signal division_revealed(division_id: String)
signal division_hidden(division_id: String)
signal division_appeared(division_id: String)
signal division_vanishing(division_id: String)
signal air_wing_vanishing(wing_id: String)
signal division_radar_ping(division_id: String)
signal air_bombing_result(data: Dictionary)
signal bombing_detail_open_requested(data: Dictionary)
signal bombing_detail_closed()
signal air_combat_detail_open_requested(data: Dictionary)
signal air_combat_detail_closed()
signal air_bombing_province_result(data: Dictionary)
signal province_aa_fired(data: Dictionary)
signal strategic_bombing_detail_open_requested(data: Dictionary)
signal strategic_bombing_detail_closed()

signal air_wing_escort_picker_open_requested(wing_id: String)
signal air_wing_spawn_open_requested(province_id: String)  ## province_id param reserved for future province picker

# ── Naval ──────────────────────────────────────────────────────────────────────

signal naval_contact_marker_added(data: Dictionary)
signal naval_contact_marker_expired(data: Dictionary)

signal resources_updated()
signal province_economy_updated(province_id: String)  ## empty string = bulk/multi-province update
signal province_detail_open_requested(province_id: String)
signal province_detail_closed()
signal production_panel_open_requested()
signal marshalling_updated()
signal reserve_updated()

# ── Market / Trade (Phase 9 Branch D) ─────────────────────────────────────────

signal market_updated()
signal trade_routes_updated()
signal market_panel_open_requested()
signal market_panel_closed()
signal propose_trade_route_open_requested()
signal propose_trade_route_closed()
