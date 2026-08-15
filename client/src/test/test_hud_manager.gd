extends Node
## Automated test for HUDManager registry and signal contract.
## Run headless: --scene scenes/test/test_hud_manager.tscn
## Pass condition: prints "ALL PASS" and exits with code 0.

const HUDManagerScript = preload("res://src/ui/hud/hud_manager.gd")
const MilitarySystemScript = preload("res://src/systems/military/military_system.gd")

var _pass_count := 0
var _fail_count := 0


func _ready() -> void:
	_setup_mock_diplomacy_state()
	var hud: Node = preload("res://scenes/game/game_hud.tscn").instantiate()
	add_child(hud)
	await get_tree().process_frame
	await get_tree().process_frame
	var mgr: HUDManagerScript = hud.get_node("HUDManager")
	var session_timer: Label = hud.get_node("HUDRoot/TopBar/HBox/RightBlock/SessionTimer") as Label
	_check(session_timer.text == "00:00:00", "SessionTimer starts at 00:00:00")
	hud._process(1.0)
	_check(session_timer.text == "00:00:01", "SessionTimer advances in hh:mm:ss format")
	var chat_panel: Control = hud.get_node("ChatPanel") as Control
	_check(chat_panel != null, "GameHUD includes ChatPanel")
	_check(chat_panel.theme != null, "ChatPanel has HUD theme")
	_check(chat_panel.get_node("%ScrollContainer") != null, "ChatPanel has scroll container")
	_check(chat_panel.get_node("%MessageInput") is TextEdit, "ChatPanel has TextEdit input")
	var send_button: Button = chat_panel.get_node("%SendButton") as Button
	_check(send_button != null and send_button.icon != null, "ChatPanel send button has icon")
	var diplomacy_panel: Control = hud.find_child("DiplomacyPanel", true, false) as Control
	_check(_has_label_text(diplomacy_panel, "ALLIANCE 2 / 5"), "Diplomacy Nations page shows alliance section")
	_check(_has_label_text(diplomacy_panel, "ENEMY"), "Diplomacy Nations page shows enemy section")
	_check(_has_button_text(diplomacy_panel, "Kick"), "Diplomacy Nations page has Kick action")
	_check(_has_button_text(diplomacy_panel, "Peace"), "Diplomacy Nations page has Peace action")
	_check(_has_label_text(diplomacy_panel, "MY ALLIANCE 2 / 5"), "Diplomacy Alliance page shows my alliance")
	var submitted_diplomacy_actions: Array[String] = []
	DiplomacySystem.action_submitted.connect(func(action: String, target_nation_id: String) -> void:
		submitted_diplomacy_actions.append(action + ":" + target_nation_id)
	)
	var ally_button: Button = _find_button_text(diplomacy_panel, "Ally")
	_check(ally_button != null, "Diplomacy panel has Ally action")
	if ally_button != null:
		ally_button.pressed.emit()
		_check(
			not submitted_diplomacy_actions.is_empty()
				and submitted_diplomacy_actions[0].begins_with("invite:"),
			"Diplomacy Ally action submits invite command through DiplomacySystem"
		)
	var notification_feed: VBoxContainer = hud.get_node("HUDRoot/ToastContainer") as VBoxContainer
	var submitted_vote_responses: Array[String] = []
	DiplomacySystem.vote_response_submitted.connect(func(vote_id: String, accepted: bool) -> void:
		submitted_vote_responses.append(vote_id + ":" + str(accepted))
	)
	EventBus.interactive_notification_requested.emit({
		"notification_id": "test_vote_notice",
		"vote_id": "test_vote",
		"notification_type": "diplomacy",
		"message": "Vote to invite France into your alliance.",
		"requires_response": true,
		"deadline_at": Time.get_unix_time_from_system() * 1000.0 + 15000.0,
		"duration_ms": 15000,
		"yes_label": "Yes",
		"no_label": "No",
		"voters": [
			{"nation_id": "germany", "status": "pending"},
			{"nation_id": "france", "status": "pending"},
		],
	})
	await get_tree().process_frame
	_check(_has_label_text(notification_feed, "Vote to invite France into your alliance."), "Interactive diplomacy notification shows message")
	_check(_has_button_text(notification_feed, "Yes"), "Interactive diplomacy notification has Yes button")
	_check(_has_button_text(notification_feed, "No"), "Interactive diplomacy notification has No button")
	_check(_count_vote_rectangles(notification_feed) == 2, "Interactive diplomacy notification shows voter rectangles")
	var yes_vote_button: Button = _find_button_text(notification_feed, "Yes")
	if yes_vote_button != null:
		yes_vote_button.pressed.emit()
		_check(submitted_vote_responses == ["test_vote:true"], "Interactive Yes button submits vote response")
	EventBus.interactive_notification_updated.emit({
		"notification_id": "test_vote_notice",
		"requires_response": false,
		"voters": [
			{"nation_id": "germany", "status": "yes"},
			{"nation_id": "france", "status": "no"},
		],
	})
	await get_tree().process_frame
	_check(_has_vote_rectangle_color(notification_feed, Color(0.28, 0.72, 0.36, 1.0)), "Vote update colors yes rectangle green")
	_check(_has_vote_rectangle_color(notification_feed, Color(0.86, 0.26, 0.22, 1.0)), "Vote update colors no rectangle red")
	var chat_toggle_button: Button = chat_panel.find_child("MaximizeMinimizeToggleButton", true, false) as Button
	var chat_input: TextEdit = chat_panel.get_node("%MessageInput") as TextEdit
	var minimized_chat_size: Vector2 = chat_panel.size
	var viewport_size: Vector2 = hud.get_viewport().get_visible_rect().size
	_check(not bool(chat_panel.get("is_maximized")), "ChatPanel starts minimized")
	_check(
		is_equal_approx(chat_panel.global_position.y + minimized_chat_size.y, viewport_size.y - 16.0),
		"minimized chat stays anchored to bottom margin"
	)
	var chat_key: InputEventKey = InputEventKey.new()
	chat_key.pressed = true
	chat_key.physical_keycode = KEY_ENTER
	hud._input(chat_key)
	await get_tree().process_frame
	await get_tree().process_frame
	_check(bool(chat_panel.get("is_maximized")), "chat keybind maximizes minimized chat")
	_check(chat_input.has_focus(), "chat keybind focuses message input")
	var maximized_chat_size: Vector2 = chat_panel.size
	_check(minimized_chat_size.y < maximized_chat_size.y, "maximizing chat increases assigned height")
	hud.call("_layout_bottom_hud")
	await get_tree().process_frame
	await get_tree().process_frame
	_check(_toast_is_above_chat(hud), "ToastContainer appears above maximized chat")

	var inside_chat_click: InputEventMouseButton = InputEventMouseButton.new()
	inside_chat_click.pressed = true
	inside_chat_click.button_index = MOUSE_BUTTON_LEFT
	inside_chat_click.position = chat_panel.global_position + Vector2(8.0, 8.0)
	hud._input(inside_chat_click)
	await get_tree().process_frame
	_check(chat_input.has_focus(), "clicking inside chat keeps chat typing focus")

	var outside_chat_click: InputEventMouseButton = InputEventMouseButton.new()
	outside_chat_click.pressed = true
	outside_chat_click.button_index = MOUSE_BUTTON_LEFT
	outside_chat_click.position = Vector2(4.0, 4.0)
	hud._input(outside_chat_click)
	await get_tree().process_frame
	_check(not chat_input.has_focus(), "clicking outside chat exits chat typing focus")
	chat_input.release_focus()

	var text_focus_log: Array[bool] = []
	EventBus.ui_text_input_focus_changed.connect(func(focused: bool) -> void:
		text_focus_log.append(focused)
	)
	var left_dock_rail: Control = hud.get_node("HUDRoot/LeftDockRail") as Control
	var dock_button_q: Control = hud.get_node("HUDRoot/LeftDockRail/VBox/DockButton_Q") as Control
	var top_bar: Control = hud.get_node("HUDRoot/TopBar") as Control
	var political_button: Button = hud.get_node("HUDRoot/MapModeTabs/MapModeBar/BtnMapPolitical") as Button
	var terrain_button: Button = hud.get_node("HUDRoot/MapModeTabs/MapModeBar/BtnMapTerrain") as Button
	var cover_button: Button = hud.get_node("HUDRoot/MapModeTabs/MapModeBar/BtnMapCover") as Button
	_check(is_equal_approx(top_bar.size.y, 50.0), "TopBar uses compact 50 px height")
	_check(is_equal_approx(left_dock_rail.size.x, 58.0), "LeftDockRail uses compact 58 px width")
	_check(
		political_button.custom_minimum_size == Vector2(112.0, 38.0)
			and terrain_button.custom_minimum_size == Vector2(112.0, 38.0)
			and cover_button.custom_minimum_size == Vector2(112.0, 38.0),
		"map modes use three compact controls in one row"
	)
	_check(
		political_button.get_node("Content/Icon").material != null
			and terrain_button.get_node("Content/Icon").material != null
			and cover_button.get_node("Content/Icon").material != null,
		"map-mode controls use shader-tinted icons"
	)
	_check(
		political_button.custom_minimum_size == terrain_button.custom_minimum_size
			and terrain_button.custom_minimum_size == cover_button.custom_minimum_size,
		"map-mode controls use equal width and height"
	)
	_check(
		hud.get_node_or_null("HUDRoot/LeftDockRail/VBox/DockButton_U") == null
			and hud.get_node_or_null("HUDRoot/LeftDockRail/VBox/DockButton_I") == null,
		"unshipped reserved dock slots do not consume space"
	)
	var emitted_map_modes: Array[String] = []
	EventBus.map_mode_changed.connect(func(mode: String) -> void: emitted_map_modes.append(mode))
	terrain_button.pressed.emit()
	_check(emitted_map_modes == ["elevation"], "Terrain control selects elevation rendering")
	_check(terrain_button.button_pressed, "selected map-mode control tracks current mode")
	hud.call("_layout_persistent_hud", 900.0)
	_check(not hud.get_node("%NationLabel").visible, "narrow HUD hides nation name")
	_check(hud.get_node("%ManpowerLabel").text == "MP --", "narrow HUD abbreviates resource labels")
	_check(
		is_equal_approx(diplomacy_panel.custom_minimum_size.x, 324.0),
		"narrow HUD clamps drawer width relative to viewport"
	)
	hud.call("_layout_persistent_hud")
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(left_dock_rail))),
		"LeftDockRail rect blocks pointer-driven camera input"
	)
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(dock_button_q))),
		"nested active dock button rect blocks pointer-driven camera input"
	)
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(chat_panel))),
		"ChatPanel rect blocks pointer-driven camera input"
	)
	_check(
		not bool(hud.call("_is_position_over_registered_ui", viewport_size * 0.5)),
		"empty map area does not block pointer-driven camera input"
	)
	hud.call("_layout_bottom_hud")
	await get_tree().process_frame
	await get_tree().process_frame
	_check_bottom_panel_layout(hud, hud.get_node("FriendlyProvincePanel") as Control, "FriendlyProvincePanel")
	_check_bottom_panel_layout(hud, hud.get_node("EnemyDivisionPanel") as Control, "EnemyDivisionPanel")
	var land_popover: Control = hud.get_node("LandSelectionPopover") as Control
	_check(land_popover != null, "GameHUD includes contextual land selection popover")
	var land_surround: Control = hud.get_node("LandSelectionSurround") as Control
	_check(land_surround != null, "GameHUD includes single-selection surround")
	_check(land_surround.mouse_filter == Control.MOUSE_FILTER_IGNORE, "selection surround visual root ignores pointer input")
	var action_buttons: Array[Button] = land_surround.get_control_buttons()
	_check(action_buttons.size() == 2, "single-selection surround exposes two universal actions")
	_check(
		action_buttons[0].name == "Composition" and action_buttons[1].name == "CenterCamera",
		"universal actions keep Composition before Center Camera"
	)
	_check(
		not action_buttons[0].disabled and not action_buttons[1].disabled,
		"universal actions are enabled"
	)
	_check(
		action_buttons[0].icon != null and action_buttons[1].icon != null,
		"universal actions use approved icon assets"
	)
	_check(
		action_buttons[0].icon.resource_path == "res://assets/icons/table-cells-solid-full.svg",
		"Composition uses the approved table-cells icon"
	)
	_check(
		action_buttons[0].icon.get_width() == 24
			and action_buttons[0].get_theme_constant("icon_max_width") == 24,
		"Composition icon is rasterized and displayed at its legible 24-pixel size "
			+ "(texture=%d, display=%d)" % [
				action_buttons[0].icon.get_width(),
				action_buttons[0].get_theme_constant("icon_max_width"),
			]
	)
	_check(
		action_buttons[1].icon.resource_path == "res://assets/icons/arrows-to-dot-solid-full.svg",
		"Center Camera uses the approved arrows-to-dot icon"
	)
	_check(
		action_buttons[1].get_theme_constant("icon_max_width") == 22,
		"Composition sizing does not enlarge other surround actions"
	)
	var actual_reserved_rects: Array[Rect2] = hud.call("_get_land_surround_reserved_rects")
	_check(
		actual_reserved_rects.size() == 4
			and actual_reserved_rects.has(top_bar.get_global_rect())
			and actual_reserved_rects.has(left_dock_rail.get_global_rect())
			and actual_reserved_rects.has(
				(hud.get_node("HUDRoot/MapModeTabs") as Control).get_global_rect()
			)
			and actual_reserved_rects.has(chat_panel.get_global_rect()),
		"surround placement reserves the visible persistent HUD and chat"
	)
	_check(
		not actual_reserved_rects.has(notification_feed.get_global_rect()),
		"transient notifications do not destabilize surround placement"
	)
	for common_viewport_size: Vector2 in [
		Vector2(960.0, 540.0),
		Vector2(1280.0, 720.0),
		Vector2(1920.0, 1080.0),
	]:
		var common_viewport := Rect2(Vector2.ZERO, common_viewport_size)
		var common_anchor: Vector2 = common_viewport_size * 0.5
		var common_placement: Dictionary = hud.call(
			"_find_land_selection_surround_placement",
			common_anchor,
			common_viewport,
			[] as Array[Rect2]
		)
		var common_bounds: Rect2 = land_surround.get_placement_bounds(
			common_placement.get("placement", &"") as StringName,
			float(common_placement.get("tray_slide", 0.0))
		)
		_check(
			common_placement.get("placement", &"") == &"top_right"
				and common_viewport.grow(-8.0).encloses(
					Rect2(common_anchor + common_bounds.position, common_bounds.size)
				),
			"%dx%d centered surround prefers top-right within its viewport margin" % [
				int(common_viewport_size.x),
				int(common_viewport_size.y),
			]
		)
	var synthetic_viewport := Rect2(Vector2.ZERO, Vector2(1280.0, 720.0))
	var no_reserved_rects: Array[Rect2] = []
	var placement: Dictionary = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(640.0, 360.0),
		synthetic_viewport,
		no_reserved_rects
	)
	_check(
		placement.get("placement", &"") == &"top_right"
			and is_zero_approx(float(placement.get("tray_slide", -1.0))),
		"centered surround prefers the unshifted top-right tray"
	)
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(1170.0, 360.0),
		synthetic_viewport,
		no_reserved_rects
	)
	_check(
		placement.get("placement", &"") == &"top_right"
			and is_equal_approx(float(placement.get("tray_slide", -1.0)), 8.0),
		"small right-edge overflow slides the preferred tray inward"
	)
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(1190.0, 360.0),
		synthetic_viewport,
		no_reserved_rects
	)
	_check(
		placement.get("placement", &"") == &"top_left",
		"right-edge placement mirrors left after the slide limit"
	)
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(640.0, 70.0),
		synthetic_viewport,
		no_reserved_rects
	)
	_check(
		placement.get("placement", &"") == &"bottom_right",
		"top-edge placement falls back to the lower-right tray"
	)
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(1190.0, 70.0),
		synthetic_viewport,
		no_reserved_rects
	)
	_check(
		placement.get("placement", &"") == &"bottom_left",
		"top-right corner uses lower-left after the first three placements fail"
	)
	var synthetic_top_bar: Array[Rect2] = [Rect2(0.0, 0.0, 1280.0, 50.0)]
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(640.0, 110.0),
		synthetic_viewport,
		synthetic_top_bar
	)
	_check(
		placement.get("placement", &"") == &"bottom_right",
		"reserved top-bar space pushes the tray below the counter"
	)
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(640.0, 25.0),
		synthetic_viewport,
		synthetic_top_bar
	)
	_check(placement.is_empty(), "counter anchors behind reserved HUD hide the surround")
	var synthetic_chat: Array[Rect2] = [Rect2(900.0, 500.0, 360.0, 200.0)]
	placement = hud.call(
		"_find_land_selection_surround_placement",
		Vector2(850.0, 600.0),
		synthetic_viewport,
		synthetic_chat
	)
	_check(
		placement.get("placement", &"") == &"top_left",
		"visible chat reservation mirrors an otherwise overlapping tray"
	)
	var geometry_anchor := Vector2(500.0, 300.0)
	for placement_name: StringName in land_surround.get_placements():
		land_surround.set_placement(placement_name)
		land_surround.set_anchor_position(geometry_anchor)
		var relative_bounds: Rect2 = land_surround.get_placement_bounds(placement_name)
		_check(
			land_surround.get_anchor_position().is_equal_approx(geometry_anchor),
			"%s placement preserves the exact counter anchor" % placement_name
		)
		_check(
			Rect2(geometry_anchor + relative_bounds.position, relative_bounds.size).is_equal_approx(
				land_surround.get_global_rect()
			),
			"%s placement reports its complete surface bounds" % placement_name
		)
		_check(
			relative_bounds.position.x <= -40.0
				and relative_bounds.position.y <= -40.0
				and relative_bounds.end.x >= 40.0
				and relative_bounds.end.y >= 40.0,
			"%s placement bounds contain the full entrance expansion" % placement_name
		)
	land_surround.set_placement(&"top_right")
	mgr.show_panel("military")
	await get_tree().process_frame
	_check(bool(land_popover.get("_suspended")), "Opening side panel suspends land selection popover")
	GameState.divisions = {
		"test_div": {
			"nation_id": "germany",
			"division_type": "infantry",
			"hp": 100.0,
			"max_hp": 100.0,
			"suppression": 0.0,
			"combat_state": "idle",
			"move_order": [],
			"final_position_lng": -999.0,
			"final_position_lat": -999.0,
		},
		"test_div_2": {
			"nation_id": "germany",
			"division_type": "infantry",
			"hp": 100.0,
			"max_hp": 100.0,
			"suppression": 0.0,
			"combat_state": "idle",
			"move_order": [],
			"final_position_lng": -999.0,
			"final_position_lat": -999.0,
		},
	}
	_check(
		MilitarySystemScript.can_hold_division_data(
			{"combat_state": "idle", "move_order": ["wp"], "final_position_lng": -999.0},
			true
		),
		"Hold eligibility accepts ordinary waypoint movement"
	)
	_check(
		MilitarySystemScript.can_hold_division_data(
			{"combat_state": "idle", "move_order": [], "final_position_lng": 12.0},
			true
		),
		"Hold eligibility accepts final-target-only movement"
	)
	_check(
		MilitarySystemScript.can_hold_division_data(
			{"combat_state": "idle", "move_order": [], "final_position_lng": -999.0},
			true,
			true
		),
		"Hold eligibility accepts immediate local movement awaiting confirmation"
	)
	for ineligible_state: String in ["engaged", "suppressed", "retreating", "destroyed"]:
		_check(
			not MilitarySystemScript.can_hold_division_data(
				{
					"combat_state": ineligible_state,
					"move_order": ["wp"],
					"final_position_lng": 12.0,
				},
				true
			),
			"Hold eligibility rejects %s divisions" % ineligible_state
		)
	_check(
		not MilitarySystemScript.can_hold_division_data(
			{"combat_state": "idle", "move_order": [], "final_position_lng": -999.0},
			true
		),
		"Hold eligibility rejects stopped divisions"
	)
	_check(
		not MilitarySystemScript.can_hold_division_data(
			{"combat_state": "idle", "move_order": ["wp"], "final_position_lng": -999.0},
			false
		),
		"Hold eligibility rejects foreign divisions"
	)
	for eligible_retreat_state: String in ["engaged", "suppressed"]:
		_check(
			MilitarySystemScript.can_retreat_division_data(
				{"combat_state": eligible_retreat_state},
				true
			),
			"Retreat eligibility accepts owned %s divisions" % eligible_retreat_state
		)
	for ineligible_retreat_state: String in ["idle", "retreating", "destroyed"]:
		_check(
			not MilitarySystemScript.can_retreat_division_data(
				{"combat_state": ineligible_retreat_state},
				true
			),
			"Retreat eligibility rejects %s divisions" % ineligible_retreat_state
		)
	_check(
		not MilitarySystemScript.can_retreat_division_data(
			{"combat_state": "engaged"},
			false
		),
		"Retreat eligibility rejects foreign divisions"
	)
	EventBus.division_selected.emit("test_div")
	await get_tree().process_frame
	_check(not _any_bottom_panel_visible(hud), "Division selection does not reopen bottom panel while side panel is open")
	mgr.close_all()
	await get_tree().process_frame
	_check(not bool(land_popover.get("_suspended")), "Closing side panel restores land popover availability")
	var move_cancel_log: Array[bool] = []
	EventBus.move_mode_cancelled.connect(func() -> void: move_cancel_log.append(true))
	EventBus.move_mode_active_changed.emit(true)
	var move_escape := InputEventKey.new()
	move_escape.pressed = true
	move_escape.physical_keycode = KEY_ESCAPE
	mgr._input(move_escape)
	_check(move_cancel_log.size() == 1, "Escape cancels active land placement mode before opening menus")
	EventBus.division_selection_changed.emit(["test_div"] as Array[String])
	EventBus.division_active_changed.emit("test_div")
	EventBus.division_screen_position_updated.emit("test_div", Vector2(500.0, 300.0))
	hud._process(0.0)
	_check(land_surround.visible, "single selection shows connected surround")
	_check(land_surround.get_anchor_position().is_equal_approx(Vector2(500.0, 300.0)), "surround anchors to selected division screen position")
	_check(not land_popover.visible, "single selection does not open old inspector")
	var surround_surface: ColorRect = land_surround.get_node("Surface") as ColorRect
	var surround_material: ShaderMaterial = surround_surface.material as ShaderMaterial
	var first_selection_tween: Tween = land_surround.get("_selection_tween") as Tween
	_check(first_selection_tween != null, "new single selection starts the surround entrance animation")
	_check(
		is_equal_approx(float(surround_material.get_shader_parameter("selection_pop")), 8.0),
		"selection entrance starts with the old eight-pixel ring expansion"
	)
	_check(
		is_equal_approx(action_buttons[0].self_modulate.a, 0.6),
		"selection entrance starts controls partially faded without moving their hitboxes"
	)
	hud._process(0.0)
	_check(
		land_surround.get("_selection_tween") == first_selection_tween,
		"position refresh does not restart the selection entrance"
	)
	await get_tree().create_timer(0.14).timeout
	_check(
		is_zero_approx(float(surround_material.get_shader_parameter("selection_pop")))
			and is_zero_approx(float(surround_material.get_shader_parameter("selection_emphasis"))),
		"selection entrance settles its ring geometry and border emphasis"
	)
	_check(
		is_equal_approx(action_buttons[0].self_modulate.a, 1.0),
		"selection entrance settles controls at full opacity"
	)
	var placement_change_composition_requests: Array[String] = []
	EventBus.division_template_viewer_open_requested.connect(func(division_id: String) -> void:
		placement_change_composition_requests.append(division_id)
	)
	action_buttons[0].button_down.emit()
	EventBus.division_screen_position_updated.emit(
		"test_div",
		Vector2(viewport_size.x - 88.0, 300.0)
	)
	hud._process(0.0)
	action_buttons[0].pressed.emit()
	_check(
		placement_change_composition_requests.is_empty(),
		"placement mirroring during button-down cancels the armed action"
	)
	EventBus.division_screen_position_updated.emit("test_div", Vector2(500.0, 300.0))
	hud._process(0.0)
	mgr.show_panel("military")
	hud._process(0.0)
	_check(not land_surround.visible, "any managed side panel suspends the surround")
	mgr.hide_panel("military")
	hud._process(0.0)
	_check(land_surround.visible, "closing the managed panel restores the surround")
	_check(
		land_surround.get("_selection_tween") == first_selection_tween,
		"panel suspension does not replay the selection entrance"
	)
	var surround_visibility_changes: Array[bool] = []
	land_surround.visibility_changed.connect(func() -> void:
		surround_visibility_changes.append(land_surround.visible)
	)
	hud._process(0.0)
	_check(
		surround_visibility_changes.is_empty(),
		"position refresh preserves surround visibility so buttons remain interactive"
	)
	_check(
		bool(hud.call(
			"_is_position_over_registered_ui",
			action_buttons[0].get_global_rect().get_center()
		)),
		"surround actions block map input only inside their button bounds"
	)
	_check(
		not bool(hud.call("_is_position_over_registered_ui", land_surround.get_anchor_position())),
		"hollow counter center passes map input through"
	)
	_check(
		not bool(hud.call(
			"_is_position_over_registered_ui",
			action_buttons[0].get_global_rect().end + Vector2(2.0, -17.0)
		)),
		"tray gap and button-adjacent pixels pass map input through"
	)
	var idle_surround_width: float = land_surround.size.x
	var hold_requests: Array[String] = []
	EventBus.division_hold_requested.connect(func(division_id: String) -> void:
		hold_requests.append(division_id)
	)
	GameState.divisions["test_div"]["move_order"] = ["wp"]
	EventBus.division_hold_eligibility_changed.emit("test_div", true)
	_check(
		land_surround.get("_selection_tween") == first_selection_tween,
		"Hold eligibility refresh does not restart the selection entrance"
	)
	action_buttons = land_surround.get_control_buttons()
	_check(action_buttons.size() == 3, "moving single selection adds Hold as the third action")
	_check(
		action_buttons[0].name == "Composition"
			and action_buttons[1].name == "CenterCamera"
			and action_buttons[2].name == "Hold",
		"moving layout preserves universal order before Hold"
	)
	_check(
		action_buttons[2].icon != null
			and action_buttons[2].icon.resource_path == "res://assets/icons/hand-regular-full.svg",
		"Hold uses the approved hand icon"
	)
	_check(
		action_buttons[2].icon.get_width() == 22
			and action_buttons[2].theme_type_variation == &"TacticalHoldButton",
		"Hold uses legible sizing and its restrained semantic style"
	)
	_check(action_buttons[2].tooltip_text.begins_with("Hold ["), "Hold tooltip includes its remappable keybind")
	var original_hold_events: Array[InputEvent] = InputMap.action_get_events("unit_hold")
	InputMap.action_erase_events("unit_hold")
	var temporary_hold_key := InputEventKey.new()
	temporary_hold_key.physical_keycode = KEY_F10
	InputMap.action_add_event("unit_hold", temporary_hold_key)
	KeybindManager.bindings_changed.emit()
	_check(action_buttons[2].tooltip_text.contains("F10"), "Hold tooltip reacts to runtime key remapping")
	InputMap.action_erase_events("unit_hold")
	for original_hold_event: InputEvent in original_hold_events:
		InputMap.action_add_event("unit_hold", original_hold_event)
	KeybindManager.bindings_changed.emit()
	_check(land_surround.size.x > idle_surround_width, "moving layout expands the connected tray for Hold")
	_press_action_button(action_buttons[2])
	_check(hold_requests == ["test_div"], "Hold requests the selected moving division")

	action_buttons[2].button_down.emit()
	GameState.divisions["test_div"]["combat_state"] = "engaged"
	EventBus.division_retreat_eligibility_changed.emit("test_div", true)
	EventBus.division_hold_eligibility_changed.emit("test_div", false)
	action_buttons[2].pressed.emit()
	_check(hold_requests == ["test_div"], "combat starting during a Hold press cancels the stale action")
	action_buttons = land_surround.get_control_buttons()
	_check(action_buttons.size() == 3, "moving-to-engaged transition replaces Hold with Retreat")
	_check(
		action_buttons[0].name == "Composition"
			and action_buttons[1].name == "CenterCamera"
			and action_buttons[2].name == "Retreat",
		"combat layout preserves universal order before Retreat"
	)
	_check(
		action_buttons[2].icon != null
			and action_buttons[2].icon.resource_path == "res://assets/icons/person-running-solid-full.svg",
		"Retreat uses the approved running-person icon"
	)
	_check(
		action_buttons[2].icon.get_width() == 22
			and action_buttons[2].get_theme_constant("icon_max_width") == 22
			and action_buttons[2].theme_type_variation == &"TacticalRetreatButton",
		"Retreat uses legible sizing and its restrained semantic style"
	)
	_check(
		action_buttons[2].tooltip_text.begins_with("Retreat ["),
		"Retreat tooltip includes its remappable keybind"
	)
	_check(
		land_surround.get("_selection_tween") == first_selection_tween,
		"combat eligibility refresh does not restart the selection entrance"
	)
	var original_retreat_events: Array[InputEvent] = InputMap.action_get_events("unit_retreat")
	InputMap.action_erase_events("unit_retreat")
	var temporary_retreat_key := InputEventKey.new()
	temporary_retreat_key.physical_keycode = KEY_F11
	InputMap.action_add_event("unit_retreat", temporary_retreat_key)
	KeybindManager.bindings_changed.emit()
	_check(action_buttons[2].tooltip_text.contains("F11"), "Retreat tooltip reacts to runtime key remapping")
	InputMap.action_erase_events("unit_retreat")
	for original_retreat_event: InputEvent in original_retreat_events:
		InputMap.action_add_event("unit_retreat", original_retreat_event)
	KeybindManager.bindings_changed.emit()
	var retreat_requests: Array[String] = []
	EventBus.division_retreat_requested.connect(func(division_id: String) -> void:
		retreat_requests.append(division_id)
	)
	_press_action_button(action_buttons[2])
	_check(retreat_requests == ["test_div"], "Retreat requests the selected engaged division")
	GameState.divisions["test_div"]["combat_state"] = "suppressed"
	EventBus.division_retreat_eligibility_changed.emit("test_div", true)
	action_buttons = land_surround.get_control_buttons()
	_check(action_buttons.size() == 3 and action_buttons[2].name == "Retreat", "suppressed divisions retain Retreat")
	action_buttons[2].button_down.emit()
	GameState.divisions["test_div"]["combat_state"] = "retreating"
	EventBus.division_retreat_eligibility_changed.emit("test_div", false)
	action_buttons[2].pressed.emit()
	_check(retreat_requests == ["test_div"], "retreat starting during a press cancels the stale action")
	action_buttons = land_surround.get_control_buttons()
	_check(action_buttons.size() == 2, "Retreat disappears when withdrawal starts")
	_check(is_equal_approx(land_surround.size.x, idle_surround_width), "withdrawal restores two-action tray geometry")
	GameState.divisions["test_div"]["combat_state"] = "idle"
	var composition_requests: Array[String] = []
	EventBus.division_template_viewer_open_requested.connect(func(division_id: String) -> void:
		composition_requests.append(division_id)
	)
	_press_action_button(action_buttons[0])
	await get_tree().process_frame
	hud._process(0.0)
	_check(composition_requests == ["test_div"], "Composition requests the active division")
	_check(mgr.is_panel_open("division_template_viewer"), "Composition opens the template viewer")
	_check(not land_surround.visible, "Composition suspends the surround while its viewer is open")
	_check(
		hud.get("_selected_land_division_ids") == ["test_div"],
		"Composition preserves the selected division"
	)
	EventBus.division_template_viewer_closed.emit()
	await get_tree().process_frame
	hud._process(0.0)
	_check(land_surround.visible, "closing Composition restores the selected surround")
	var center_camera_requests: Array[String] = []
	EventBus.division_center_camera_requested.connect(func(division_id: String) -> void:
		center_camera_requests.append(division_id)
	)
	_press_action_button(action_buttons[1])
	_check(center_camera_requests == ["test_div"], "Center Camera requests the active division")
	_check(
		hud.get("_selected_land_division_ids") == ["test_div"],
		"Center Camera preserves the selected division"
	)
	_check(
		float(surround_material.get_shader_parameter("inner_radius")) > 0.0,
		"selection surround leaves a transparent cutout over the division counter"
	)
	GameState.divisions["test_div"]["combat_state"] = "destroyed"
	hud._process(0.0)
	_check(not land_surround.visible, "destroyed selected division hides its surround")
	_press_action_button(action_buttons[1])
	_check(
		center_camera_requests == ["test_div"],
		"destroyed divisions reject stale action-button activation"
	)
	GameState.divisions["test_div"]["combat_state"] = "idle"
	EventBus.division_screen_position_updated.emit("test_div", Vector2(-1.0, -1.0))
	hud._process(0.0)
	_check(not land_surround.visible, "off-screen selected land unit hides surround without clearing selection")
	EventBus.division_screen_position_updated.emit("test_div", Vector2(620.0, 340.0))
	hud._process(0.0)
	_check(land_surround.visible, "returning selected unit restores surround")
	_check(
		land_surround.get("_selection_tween") == first_selection_tween,
		"off-screen restoration does not replay the selection entrance"
	)
	_check(land_surround.get_anchor_position().is_equal_approx(Vector2(620.0, 340.0)), "selection anchor updates when projected position changes")
	var edge_slide_start: float = viewport_size.x - 118.0
	for interpolated_x: float in [
		edge_slide_start,
		edge_slide_start + 6.0,
		edge_slide_start + 12.0,
		edge_slide_start + 15.0,
	]:
		EventBus.division_screen_position_updated.emit("test_div", Vector2(interpolated_x, 340.0))
		hud._process(0.0)
		_check(
			land_surround.visible
				and land_surround.get_anchor_position().is_equal_approx(
					Vector2(interpolated_x, 340.0)
				),
			"surround remains attached during interpolated edge movement at x=%d" % int(interpolated_x)
		)
	_check(
		land_surround.get_placement() == &"top_right",
		"small interpolated edge corrections retain the current orientation"
	)
	EventBus.division_screen_position_updated.emit(
		"test_div",
		Vector2(edge_slide_start + 30.0, 340.0)
	)
	hud._process(0.0)
	_check(
		land_surround.visible and land_surround.get_placement() == &"top_left",
		"interpolation mirrors only after the preferred slide range is exhausted"
	)
	EventBus.division_screen_position_updated.emit("test_div", Vector2(900.0, 340.0))
	hud._process(0.0)
	_check(
		land_surround.get_placement() == &"top_right",
		"preferred placement returns after gaining hysteresis clearance"
	)
	EventBus.division_active_changed.emit("test_div_2")
	hud._process(0.0)
	_check(
		not land_surround.visible,
		"active division mismatches are rejected until the selected set catches up"
	)
	EventBus.division_selection_changed.emit(["test_div_2"] as Array[String])
	EventBus.division_active_changed.emit("test_div_2")
	EventBus.division_selection_changed.emit(["test_div"] as Array[String])
	EventBus.division_active_changed.emit("test_div")
	EventBus.division_selection_changed.emit(["test_div_2"] as Array[String])
	EventBus.division_active_changed.emit("test_div_2")
	EventBus.division_screen_position_updated.emit("test_div_2", Vector2(740.0, 420.0))
	hud._process(0.0)
	_check(
		land_surround.visible
			and land_surround.get_anchor_position().is_equal_approx(Vector2(740.0, 420.0)),
		"rapid A-B-A-B selection changes settle on the final projected anchor"
	)
	_check(
		land_surround.get("_selection_tween") != first_selection_tween
			and is_equal_approx(
				float(surround_material.get_shader_parameter("selection_pop")),
				8.0
			),
		"changing single selection starts a fresh entrance animation"
	)
	var changed_selection_buttons: Array[Button] = land_surround.get_control_buttons()
	changed_selection_buttons[1].button_down.emit()
	GameState.divisions.erase("test_div_2")
	EventBus.division_removed.emit("test_div_2")
	changed_selection_buttons[1].pressed.emit()
	_check(not land_surround.visible, "division removal immediately hides an armed surround")
	_check(
		not (hud.get("_division_screen_positions") as Dictionary).has("test_div_2"),
		"division removal clears its cached screen projection"
	)
	_check(
		center_camera_requests == ["test_div"],
		"division removal during button-down cancels the stale action"
	)
	EventBus.division_selection_changed.emit([] as Array[String])
	hud._process(0.0)
	_check(not land_surround.visible, "deselection hides connected surround")
	chat_input.grab_focus()
	await get_tree().process_frame
	_check(text_focus_log == [true], "Chat input focus blocks keyboard camera input")
	chat_input.release_focus()
	await get_tree().process_frame
	_check(text_focus_log == [true, false], "Chat input blur restores keyboard camera input")

	var opened_log: Array[String] = []
	var closed_log: Array[String] = []
	mgr.panel_opened.connect(func(n: String) -> void: opened_log.append(n))
	mgr.panel_closed.connect(func(n: String) -> void: closed_log.append(n))

	var mock_a := Control.new()
	var mock_b := Control.new()
	var mock_c := Control.new()

	mgr.register_panel("mock_a", mock_a, HUDManagerScript.PlacementMode.SIDE_DOCKED)
	mgr.register_panel("mock_b", mock_b, HUDManagerScript.PlacementMode.FULL_CENTER)
	mgr.register_panel("mock_c", mock_c, HUDManagerScript.PlacementMode.SIDE_DOCKED)
	mgr.set_panel_shortcut("mock_a", KEY_Z)

	# --- initial state ---
	_check(not mgr.is_panel_open("mock_a"), "mock_a initially closed")
	_check(not mgr.is_panel_open("mock_b"), "mock_b initially closed")
	_check(not mgr.is_panel_open("mock_c"), "mock_c initially closed")
	_check(mgr.get_open_panel() == "", "get_open_panel empty initially")

	# --- chat input blocks HUD shortcuts ---
	EventBus.chat_input_focus_changed.emit(true)
	var shortcut_key: InputEventKey = InputEventKey.new()
	shortcut_key.pressed = true
	shortcut_key.physical_keycode = KEY_Z
	mgr._input(shortcut_key)
	_check(not mgr.is_panel_open("mock_a"), "chat focus blocks HUD panel shortcut")
	EventBus.chat_input_focus_changed.emit(false)
	mgr._input(shortcut_key)
	_check(mgr.is_panel_open("mock_a"), "HUD panel shortcut works after chat blur")
	mgr.hide_panel("mock_a")
	opened_log.clear()
	closed_log.clear()

	# --- show_panel ---
	mgr.show_panel("mock_a")
	_check(mgr.is_panel_open("mock_a"), "show_panel opens mock_a")
	_check(mgr.get_open_panel() == "mock_a", "get_open_panel = mock_a")
	_check(opened_log == ["mock_a"], "panel_opened signal fired for mock_a")
	_check(mock_a.visible, "mock_a node visible")
	_check(hud.get_node("HUDRoot/SidePanelAnchor").visible, "SidePanelAnchor visible")

	# --- hide_panel ---
	mgr.hide_panel("mock_a")
	_check(not mgr.is_panel_open("mock_a"), "hide_panel closes mock_a")
	_check(closed_log == ["mock_a"], "panel_closed signal fired for mock_a")
	_check(not mock_a.visible, "mock_a node hidden")
	_check(mgr.get_open_panel() == "", "get_open_panel empty after hide")

	# --- toggle ---
	mgr.toggle_panel("mock_a")
	_check(mgr.is_panel_open("mock_a"), "toggle opens mock_a")
	mgr.toggle_panel("mock_a")
	_check(not mgr.is_panel_open("mock_a"), "toggle closes mock_a")

	# --- side-docked placement: mutually exclusive ---
	mgr.show_panel("mock_a")
	mgr.show_panel("mock_c")
	_check(not mgr.is_panel_open("mock_a"), "side panel switch closes previous side panel")
	_check(mgr.is_panel_open("mock_c"), "side panel switch opens requested side panel")
	_check(not mock_a.visible, "previous side panel node hidden")
	_check(mock_c.visible, "requested side panel node visible")

	# --- FULL_CENTER placement: overlay dim ---
	mgr.show_panel("mock_b")
	_check(mgr.is_panel_open("mock_b"), "show_panel opens mock_b")
	_check(hud.overlay_dim.visible, "OverlayDim shown for FULL_CENTER")
	_check(hud.get_node("HUDRoot/CenterPanelAnchor").visible, "CenterPanelAnchor visible")

	# --- close_all ---
	mgr.show_panel("mock_a")
	mgr.close_all()
	_check(not mgr.is_panel_open("mock_a"), "close_all closes mock_a")
	_check(not mgr.is_panel_open("mock_b"), "close_all closes mock_b")
	_check(mgr.get_open_panel() == "", "get_open_panel empty after close_all")
	_check(not hud.overlay_dim.visible, "OverlayDim hidden after close_all")

	# --- unregister ---
	mgr.unregister_panel("mock_a")
	_check(not mgr.is_panel_open("mock_a"), "unregistered panel reports closed")

	# --- unknown panel warning (no crash) ---
	mgr.show_panel("nonexistent")  # should push_warning, not crash
	_check(true, "unknown panel show_panel does not crash")

	_report()


func _check(cond: bool, label: String) -> void:
	if cond:
		_pass_count += 1
	else:
		_fail_count += 1
		print("FAIL: ", label)


## Emits the native button sequence needed to exercise action press arming in headless tests.
func _press_action_button(button: Button) -> void:
	button.button_down.emit()
	button.pressed.emit()


## Seeds GameState with a deterministic relation snapshot for HUD tests.
## Parameters: none.
## Returns: nothing.
func _setup_mock_diplomacy_state() -> void:
	AuthManager.user_id = "user-a"
	GameState.players = {
		"session-a": {"user_id": "user-a"},
	}
	GameState.nations = {
		"germany": {"player_id": "user-a", "is_ready": true},
		"france": {"player_id": "user-b", "is_ready": true},
		"spain": {"player_id": "user-c", "is_ready": true},
		"italy": {"player_id": "", "is_ready": false},
		"algeria": {"player_id": "", "is_ready": false},
		"united_kingdom": {"player_id": "", "is_ready": false},
	}
	GameState.relations = {
		"germany:france": {"stance": "alliance"},
		"france:germany": {"stance": "alliance"},
		"germany:spain": {"stance": "war"},
		"spain:germany": {"stance": "war"},
	}


## Returns true when any descendant Label has the given text.
## Parameters:
## - root: node subtree to inspect.
## - text: exact label text to find.
## Returns: whether the text exists in the subtree.
func _has_label_text(root: Node, text: String) -> bool:
	return _find_label_text(root, text) != null


## Finds the first descendant Label with matching text.
## Parameters:
## - root: node subtree to inspect.
## - text: exact label text to find.
## Returns: matching Label, or null.
func _find_label_text(root: Node, text: String) -> Label:
	if root == null:
		return null
	if root is Label and (root as Label).text == text:
		return root as Label
	for child: Node in root.get_children():
		var found: Label = _find_label_text(child, text)
		if found != null:
			return found
	return null


## Returns true when any descendant Button has the given text.
## Parameters:
## - root: node subtree to inspect.
## - text: exact button text to find.
## Returns: whether the button exists in the subtree.
func _has_button_text(root: Node, text: String) -> bool:
	return _find_button_text(root, text) != null


## Finds the first descendant Button with matching text.
## Parameters:
## - root: node subtree to inspect.
## - text: exact button text to find.
## Returns: matching Button, or null.
func _find_button_text(root: Node, text: String) -> Button:
	if root == null:
		return null
	if root is Button and (root as Button).text == text:
		return root as Button
	for child: Node in root.get_children():
		var found: Button = _find_button_text(child, text)
		if found != null:
			return found
	return null


## Counts vote indicator TextureRects under notification vote rows.
## Parameters:
## - root: node subtree to inspect.
## Returns: number of vote rectangles found.
func _count_vote_rectangles(root: Node) -> int:
	var count: int = 0
	if root != null and root.name == "VoteRectangles":
		for child: Node in root.get_children():
			if child is TextureRect:
				count += 1
	if root == null:
		return count
	for child: Node in root.get_children():
		count += _count_vote_rectangles(child)
	return count


## Returns whether any vote indicator TextureRect uses the expected color.
## Parameters:
## - root: node subtree to inspect.
## - expected_color: exact modulate color to find.
## Returns: whether a matching vote rectangle exists.
func _has_vote_rectangle_color(root: Node, expected_color: Color) -> bool:
	if root == null:
		return false
	if root.name == "VoteRectangles":
		for child: Node in root.get_children():
			if child is TextureRect:
				var actual_color: Color = (child as TextureRect).modulate
				if is_equal_approx(actual_color.r, expected_color.r) \
						and is_equal_approx(actual_color.g, expected_color.g) \
						and is_equal_approx(actual_color.b, expected_color.b) \
						and is_equal_approx(actual_color.a, expected_color.a):
					return true
	for child: Node in root.get_children():
		if _has_vote_rectangle_color(child, expected_color):
			return true
	return false


## Returns the center point of a Control in viewport coordinates.
## Parameters:
## - control: Control whose visible rect should be sampled.
## Returns: global center point for pointer-ownership checks.
func _center_of_control(control: Control) -> Vector2:
	var global_rect: Rect2 = control.get_global_rect()
	return global_rect.position + (global_rect.size * 0.5)


## Verifies a bottom selection panel stays inside the reserved HUD layout area.
## Parameters:
## - hud: GameHUD test instance.
## - panel: bottom selection panel to inspect.
## - label: display name for failure output.
## Returns: nothing.
func _check_bottom_panel_layout(hud: Node, panel: Control, label: String) -> void:
	var viewport_size: Vector2 = hud.get_viewport().get_visible_rect().size
	var left_dock: Control = hud.get_node("HUDRoot/LeftDockRail") as Control
	var chat_panel: Control = hud.get_node("ChatPanel") as Control
	var expected_left: float = left_dock.get_global_rect().end.x + 16.0
	var expected_right: float = chat_panel.global_position.x - 12.0
	var rect: Rect2 = panel.get_global_rect()
	_check(rect.position.x >= expected_left - 0.5, "%s stays right of left dock" % label)
	_check(rect.end.x <= expected_right + 0.5, "%s stays left of chat" % label)
	_check(is_equal_approx(rect.end.y, viewport_size.y - 28.0), "%s leaves bottom scroll gap" % label)


## Returns whether the toast stack sits above the current chat panel.
## Parameters:
## - hud: GameHUD test instance.
## Returns: true when the toast bottom is above the chat top.
func _toast_is_above_chat(hud: Node) -> bool:
	var toast_container: Control = hud.get_node("HUDRoot/ToastContainer") as Control
	var chat_panel: Control = hud.get_node("ChatPanel") as Control
	var toast_rect: Rect2 = toast_container.get_global_rect()
	var chat_rect: Rect2 = chat_panel.get_global_rect()
	return toast_rect.end.y <= chat_rect.position.y - 11.0


## Returns whether any bottom selection panel is visible.
## Parameters:
## - hud: GameHUD test instance.
## Returns: true when a bottom panel is visible.
func _any_bottom_panel_visible(hud: Node) -> bool:
	for panel_name: String in ["FriendlyProvincePanel", "EnemyDivisionPanel"]:
		var panel: Control = hud.get_node(panel_name) as Control
		if panel.visible:
			return true
	return false


func _report() -> void:
	var result: String
	var exit_code: int
	if _fail_count == 0:
		result = "ALL PASS (%d checks)" % _pass_count
		exit_code = 0
	else:
		result = "FAILED %d / %d checks" % [_fail_count, _pass_count + _fail_count]
		exit_code = 1
	print(result)
	var f := FileAccess.open("user://test_hud_manager_result.txt", FileAccess.WRITE)
	if f:
		f.store_string(result)
		f.close()
	get_tree().quit(exit_code)
