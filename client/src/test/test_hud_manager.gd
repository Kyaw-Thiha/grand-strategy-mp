extends Node
## Automated test for HUDManager registry and signal contract.
## Run headless: --scene scenes/test/test_hud_manager.tscn
## Pass condition: prints "ALL PASS" and exits with code 0.

const HUDManagerScript = preload("res://src/ui/hud/hud_manager.gd")

var _pass_count := 0
var _fail_count := 0


func _ready() -> void:
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
