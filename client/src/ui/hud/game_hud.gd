extends CanvasLayer
## Persistent in-game HUD: war-room frame + panel orchestrator.
## Owns the TopBar, LeftDockRail, anchor zones, and toast area.
## Panel behaviour (hotkeys, swap rules, Tab/Escape) wired in p5b.

const _HUDManagerClass = preload("res://src/ui/hud/hud_manager.gd")

@onready var hud_manager: _HUDManagerClass = $HUDManager
@onready var overlay_dim: ColorRect = %OverlayDim

@onready var _side_panel_anchor: MarginContainer  = %SidePanelAnchor
@onready var _center_panel_anchor: CenterContainer = %CenterPanelAnchor
@onready var _toast_container: VBoxContainer       = %ToastContainer
@onready var _nation_label: Label                  = %NationLabel
@onready var _session_timer: Label                 = %SessionTimer
@onready var _flag_texture: TextureRect            = %FlagTexture

@onready var _btn_settings: Button = %SettingsButton
@onready var _btn_map_pol:  Button = %BtnMapPolitical
@onready var _btn_map_cov:  Button = %BtnMapCover
@onready var _btn_map_ele:  Button = %BtnMapElevation

@onready var _dock_btn_q: Button = $HUDRoot/LeftDockRail/VBox/DockButton_Q
@onready var _dock_btn_e: Button = $HUDRoot/LeftDockRail/VBox/DockButton_E
@onready var _dock_btn_t: Button = $HUDRoot/LeftDockRail/VBox/DockButton_T
@onready var _dock_btn_y: Button = $HUDRoot/LeftDockRail/VBox/DockButton_Y

@onready var _military_panel: Control = $MilitaryPanel
@onready var _economy_panel: Control = $EconomyPanel
@onready var _diplomacy_panel: Control = $DiplomacyPanel
@onready var _research_panel: Control = $ResearchPanel

const _DOCK_BUTTON_STYLE_NORMAL := preload("res://assets/themes/hud_dark.tres")
var _active_dock_btn: Button = null


func _ready() -> void:
	hud_manager.setup(_side_panel_anchor, _center_panel_anchor, overlay_dim)
	_btn_settings.pressed.connect(func() -> void: EventBus.settings_requested.emit())
	_btn_map_pol.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("political"))
	_btn_map_cov.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("cover"))
	_btn_map_ele.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("elevation"))

	# Click outside center panel = close
	overlay_dim.gui_input.connect(_on_overlay_clicked)

	# Wire dock buttons to panel toggles
	_dock_btn_q.pressed.connect(_make_dock_toggle("military"))
	_dock_btn_e.pressed.connect(_make_dock_toggle("economy"))
	_dock_btn_t.pressed.connect(_make_dock_toggle("diplomacy"))
	_dock_btn_y.pressed.connect(_make_dock_toggle("research"))

	# HUDManager signals for dock button visual state
	hud_manager.panel_opened.connect(_on_panel_opened)
	hud_manager.panel_closed.connect(_on_panel_closed)
	hud_manager.panel_sub_tab_cycle_requested.connect(_on_sub_tab_cycle_requested)

	# Register panels with HUDManager and set keyboard shortcuts
	hud_manager.register_panel("military", _military_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("economy", _economy_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("diplomacy", _diplomacy_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("research", _research_panel, HUDManager.PlacementMode.FULL_CENTER)

	hud_manager.set_panel_shortcut("military", KEY_Q)
	hud_manager.set_panel_shortcut("economy", KEY_E)
	hud_manager.set_panel_shortcut("diplomacy", KEY_T)
	hud_manager.set_panel_shortcut("research", KEY_Y)


func _make_dock_toggle(panel_name: String) -> Callable:
	return func() -> void:
		hud_manager.toggle_panel(panel_name)


func _on_panel_opened(panel_name: String) -> void:
	var btn: Button = _get_dock_button_for_panel(panel_name)
	if btn != null:
		_set_dock_button_active(btn)


func _on_panel_closed(panel_name: String) -> void:
	if hud_manager.get_open_panel() == "":
		_set_dock_button_active(null)


func _get_dock_button_for_panel(panel_name: String) -> Button:
	match panel_name:
		"military":   return _dock_btn_q
		"economy":    return _dock_btn_e
		"diplomacy":  return _dock_btn_t
		"research":   return _dock_btn_y
	return null


func _set_dock_button_active(btn: Button) -> void:
	if _active_dock_btn != null:
		_active_dock_btn.remove_theme_stylebox_override("normal")
	_active_dock_btn = btn
	if btn != null:
		var style: StyleBoxFlat = StyleBoxFlat.new()
		style.bg_color = Color(0.18, 0.13, 0.08, 1.0)
		style.border_color = Color(0.6, 0.45, 0.25, 1.0)
		btn.add_theme_stylebox_override("normal", style)


func _on_sub_tab_cycle_requested(panel_name: String, forward: bool) -> void:
	if not hud_manager.is_panel_open(panel_name):
		return
	var entry: Dictionary = hud_manager._registry.get(panel_name, {})
	var node: Node = entry.get("node", null)
	if node != null and node.has_method("cycle_sub_tab"):
		node.cycle_sub_tab(forward)


func _on_overlay_clicked(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb: InputEventMouseButton = event as InputEventMouseButton
	if not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	# Only applies to center (FULL_CENTER) panels
	var open_name: String = hud_manager.get_open_panel()
	if open_name == "":
		return
	var entry: Dictionary = hud_manager._registry.get(open_name, {})
	if entry.get("placement", -1) != HUDManager.PlacementMode.FULL_CENTER:
		return
	# Check if click landed outside the center panel
	var center_child: Node = _center_panel_anchor.get_child(0) if _center_panel_anchor.get_child_count() > 0 else null
	if center_child == null:
		return
	var panel_rect: Rect2 = center_child.get_global_rect()
	if not panel_rect.has_point(mb.position):
		hud_manager.hide_panel(open_name)


## Called by game session to update the persistent nation display.
func set_nation(nation_name: String, flag_texture: Texture2D) -> void:
	_nation_label.text = nation_name
	_flag_texture.texture = flag_texture


## Called each tick to update session timer display.
func set_session_time(seconds: int) -> void:
	var h := seconds / 3600
	var m := (seconds % 3600) / 60
	var s := seconds % 60
	_session_timer.text = "SESSION %02d:%02d:%02d" % [h, m, s]
