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
	var mgr: HUDManagerScript = hud.get_node("HUDManager")

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

	# --- initial state ---
	_check(not mgr.is_panel_open("mock_a"), "mock_a initially closed")
	_check(not mgr.is_panel_open("mock_b"), "mock_b initially closed")
	_check(not mgr.is_panel_open("mock_c"), "mock_c initially closed")
	_check(mgr.get_open_panel() == "", "get_open_panel empty initially")

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
