extends Node
## Automated test for HUDManager registry and signal contract.
## Run headless: --scene scenes/test/test_hud_manager.tscn
## Pass condition: prints "ALL PASS" and exits with code 0.

const HUDManagerScript = preload("res://src/ui/hud/hud_manager.gd")

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
	var political_button: Button = hud.get_node_or_null("%BtnMapPolitical") as Button
	var cover_button: Button = hud.get_node_or_null("%BtnMapCover") as Button
	var elevation_button: Button = hud.get_node_or_null("%BtnMapElevation") as Button
	_check(political_button != null, "Map mode bar includes Political button")
	_check(cover_button != null, "Map mode bar includes Cover button")
	_check(elevation_button != null, "Map mode bar keeps Elevation debug button")
	var map_mode_log: Array[String] = []
	EventBus.map_mode_changed.connect(func(mode: String) -> void:
		map_mode_log.append(mode)
	)
	if political_button != null:
		political_button.pressed.emit()
	if cover_button != null:
		cover_button.pressed.emit()
	if elevation_button != null:
		elevation_button.pressed.emit()
	_check(map_mode_log == ["political", "cover", "elevation"], "Map mode buttons emit Political, Cover, and Elevation")
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
	var dock_button_u: Control = hud.get_node("HUDRoot/LeftDockRail/VBox/DockButton_U") as Control
	var dock_button_i: Control = hud.get_node("HUDRoot/LeftDockRail/VBox/DockButton_I") as Control
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(left_dock_rail))),
		"LeftDockRail rect blocks pointer-driven camera input"
	)
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(dock_button_q))),
		"nested active dock button rect blocks pointer-driven camera input"
	)
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(dock_button_u))),
		"disabled U dock button rect blocks pointer-driven camera input"
	)
	_check(
		bool(hud.call("_is_position_over_registered_ui", _center_of_control(dock_button_i))),
		"disabled I dock button rect blocks pointer-driven camera input"
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
	_check_bottom_panel_layout(hud, hud.get_node("FriendlyDivisionPanel") as Control, "FriendlyDivisionPanel")
	_check_bottom_panel_layout(hud, hud.get_node("FriendlyProvincePanel") as Control, "FriendlyProvincePanel")
	_check_bottom_panel_layout(hud, hud.get_node("FriendlyStackPanel") as Control, "FriendlyStackPanel")
	_check_bottom_panel_layout(hud, hud.get_node("EnemyDivisionPanel") as Control, "EnemyDivisionPanel")
	var friendly_division_panel: Control = hud.get_node("FriendlyDivisionPanel") as Control
	friendly_division_panel.visible = true
	mgr.show_panel("military")
	await get_tree().process_frame
	_check(not friendly_division_panel.visible, "Opening side panel closes bottom selection panel")
	GameState.divisions = {
		"test_div": {
			"nation_id": "germany",
			"division_type": "infantry",
			"hp": 100.0,
			"max_hp": 100.0,
			"suppression": 0.0,
			"combat_state": "idle",
		},
	}
	EventBus.division_selected.emit("test_div")
	await get_tree().process_frame
	_check(not _any_bottom_panel_visible(hud), "Division selection does not reopen bottom panel while side panel is open")
	mgr.close_all()
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
	for panel_name: String in ["FriendlyDivisionPanel", "FriendlyProvincePanel", "FriendlyStackPanel", "EnemyDivisionPanel"]:
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
