class_name GameHUD
extends CanvasLayer
## Persistent in-game HUD: war-room frame + panel orchestrator.
## Owns the TopBar, LeftDockRail, anchor zones, and toast area.
## Panel behaviour (hotkeys, swap rules, Tab/Escape) wired in p5b.

const _HUDManagerClass = preload("res://src/ui/hud/hud_manager.gd")

@onready var hud_manager: _HUDManagerClass = $HUDManager
@onready var overlay_dim: ColorRect = %OverlayDim

@onready var _top_bar: PanelContainer = $HUDRoot/TopBar
@onready var _left_dock_rail: PanelContainer = $HUDRoot/LeftDockRail
@onready var _map_mode_tabs: PanelContainer = $HUDRoot/MapModeTabs
@onready var _side_panel_anchor: MarginContainer  = %SidePanelAnchor
@onready var _center_panel_anchor: Control = %CenterPanelAnchor
@onready var _toast_container: VBoxContainer       = %ToastContainer
@onready var _nation_label: Label                  = %NationLabel
@onready var _session_timer: Label                 = %SessionTimer
@onready var _flag_texture: TextureRect            = %FlagTexture
@onready var _manpower_label: Label                = %ManpowerLabel
@onready var _money_label: Label                   = %MoneyLabel
@onready var _grain_label: Label                   = %GrainLabel
@onready var _oil_label: Label                     = %OilLabel
@onready var _more_button: Button                  = %MoreButton
@onready var _more_flyout: PanelContainer           = %MoreFlyout
@onready var _more_flyout_list: VBoxContainer       = %MoreFlyoutList
@onready var _market_button: Button                = %MarketButton

# Branch B — resources shown in the top bar's always-4 (RESOURCE_ECONOMY.md's roster order),
# everything else goes in the "[v N more]" hover flyout. Order matches
# plans/economy_production_ui_handoff.md §2: Money, Grain, Oil, Manpower (fixed regardless of
# nation), Manpower rendered separately below since it isn't one of the ten resources.
const _TOP_BAR_RESOURCES := ["money", "grain", "oil"]
const _ALL_RESOURCE_ORDER := ["money", "grain", "iron", "oil", "rubber",
	"nitrates", "tungsten", "chromium", "aluminium", "uranium"]

@onready var _btn_settings: Button = %SettingsButton
@onready var _btn_map_political: Button = %BtnMapPolitical
@onready var _btn_map_terrain: Button = %BtnMapTerrain
@onready var _btn_map_cover: Button = %BtnMapCover

@onready var _dock_btn_q: Button = $HUDRoot/LeftDockRail/VBox/DockButton_Q
@onready var _dock_btn_e: Button = $HUDRoot/LeftDockRail/VBox/DockButton_E
@onready var _dock_btn_t: Button = $HUDRoot/LeftDockRail/VBox/DockButton_T
@onready var _dock_btn_y: Button = $HUDRoot/LeftDockRail/VBox/DockButton_Y
@onready var _dock_btn_p: Button = $HUDRoot/LeftDockRail/VBox/DockButton_P
@onready var _research_progress_fill: ColorRect = $HUDRoot/LeftDockRail/VBox/DockButton_Q/ResearchProgressFill

@onready var _military_panel: Control = $MilitaryPanel
@onready var _economy_panel: Control = $EconomyPanel
@onready var _diplomacy_panel: Control = $DiplomacyPanel
@onready var _research_panel: Control = $ResearchPanel
@onready var _research_tree_panel: Control = $ResearchTreePanel
@onready var _production_panel: Control = $ProductionPanel

@onready var _land_selection_popover: Control = $LandSelectionPopover
@onready var _land_selection_surround: LandSelectionSurround = $LandSelectionSurround
@onready var _friendly_prov_panel: Control = $FriendlyProvincePanel
@onready var _enemy_div_panel: Control = $EnemyDivisionPanel
@onready var _friendly_air_wing_panel: Control = $FriendlyAirWingPanel
@onready var _chat_panel: Control = $ChatPanel

var _division_builder_panel: Control
var _division_template_viewer_panel: Control
var _province_detail_panel: Control

const _DOCK_BUTTON_STYLE_NORMAL := preload("res://assets/themes/hud_dark.tres")
const _DivisionBuilderScene := preload("res://scenes/game/panels/division_builder_panel.tscn")
const _ProvinceDetailScene := preload("res://scenes/game/panels/province_detail_panel.tscn")
const _DivisionTemplateViewerScene := preload("res://scenes/game/panels/division_template_viewer_panel.tscn")
var _active_dock_btn: Button = null
var _map_loader: Node = null
var _military_system: Node = null
var _map_interaction: Node = null
var _air_wing_system: Node = null
var _map_renderer: Node = null
var _ui_pointer_blocker_roots: Array[Control] = []
var _ui_text_focus_controls: Dictionary = {}
var _is_ui_pointer_blocking: bool = false
var _is_ui_text_input_focused: bool = false
var _session_elapsed_seconds: float = 0.0
var _last_displayed_session_seconds: int = -1
var _map_mode_index: int = 0
var _is_narrow_hud: bool = false
var _division_screen_positions: Dictionary = {}
var _selected_land_division_ids: Array[String] = []
var _active_land_division_id: String = ""
var _hold_eligibility_division_id: String = ""
var _hold_eligible: bool = false
var _retreat_eligibility_division_id: String = ""
var _retreat_eligible: bool = false
var _pending_land_selection_animation_id: String = ""
var _land_surround_placement: StringName = &""
var _land_surround_tray_slide: float = 0.0

const _BOTTOM_PANEL_CHAT_GAP: float = 12.0
const _BOTTOM_PANEL_MARGIN: float = 16.0
const _BOTTOM_SELECTION_PANEL_BOTTOM_GAP: float = 28.0
const _BOTTOM_SELECTION_PANEL_DOCK_GAP: float = 16.0
const _TOAST_CHAT_GAP: float = 12.0
const _TOAST_WIDTH: float = 328.0
const _TOAST_HEIGHT: float = 280.0
const _NARROW_HUD_BREAKPOINT: float = 1050.0
const _LAND_POPOVER_OFFSET: float = 18.0
const _LAND_POPOVER_MARGIN: float = 10.0
const _LAND_SURROUND_VIEWPORT_MARGIN: float = 8.0
const _LAND_SURROUND_RESERVED_GAP: float = 4.0
const _LAND_SURROUND_PLACEMENT_HYSTERESIS: float = 8.0
const _SIDE_DRAWER_WIDTH: float = 332.0
const _SIDE_DRAWER_MIN_WIDTH: float = 280.0
const _MAP_MODES: Array[String] = ["political", "elevation", "cover"]
const _MAP_MODE_ACTIVE_TEXT := Color("fff1d2")
const _MAP_MODE_INACTIVE_TEXT := Color("a99c87")


## Supplies the scene-owned map systems used by HUD panels and UI actions.
## Parameters: map, military, interaction, air, and renderer system nodes.
## Returns: nothing.
func setup_game_context(
		map_loader: Node,
		military_system: Node,
		map_interaction: Node,
		air_wing_system: Node,
		map_renderer: Node
) -> void:
	_map_loader = map_loader
	_military_system = military_system
	_map_interaction = map_interaction
	_air_wing_system = air_wing_system
	_map_renderer = map_renderer


func _ready() -> void:
	set_session_time(0)

	EventBus.resources_updated.connect(_refresh_resource_bar)
	_refresh_resource_bar()
	_more_button.mouse_entered.connect(func() -> void: _more_flyout.visible = true; _position_more_flyout())
	_more_button.mouse_exited.connect(_on_more_button_mouse_exited)
	_more_flyout.mouse_entered.connect(func() -> void: _more_flyout.visible = true)
	_more_flyout.mouse_exited.connect(func() -> void: _more_flyout.visible = false)
	_market_button.pressed.connect(func() -> void: EventBus.market_panel_open_requested.emit())

	hud_manager.setup(_side_panel_anchor, _center_panel_anchor, overlay_dim)
	_register_initial_ui_input_ownership()
	_btn_settings.pressed.connect(func() -> void: EventBus.settings_requested.emit())
	_btn_map_political.pressed.connect(_set_map_mode.bind(0))
	_btn_map_terrain.pressed.connect(_set_map_mode.bind(1))
	_btn_map_cover.pressed.connect(_set_map_mode.bind(2))
	_refresh_map_mode_button_visuals()

	# Click outside center panel = close
	overlay_dim.mouse_filter = Control.MOUSE_FILTER_STOP
	overlay_dim.gui_input.connect(_on_overlay_clicked)

	# Wire dock buttons to panel toggles
	_dock_btn_q.pressed.connect(_make_dock_toggle("research"))
	_dock_btn_e.pressed.connect(_make_dock_toggle("economy"))
	_dock_btn_t.pressed.connect(_make_dock_toggle("military"))
	_dock_btn_y.pressed.connect(_make_dock_toggle("diplomacy"))
	_dock_btn_p.pressed.connect(_make_dock_toggle("production"))
	_connect_side_drawer_close("research", _research_panel)
	_connect_side_drawer_close("economy", _economy_panel)
	_connect_side_drawer_close("military", _military_panel)
	_connect_side_drawer_close("diplomacy", _diplomacy_panel)
	_connect_side_drawer_close("production", _production_panel)
	if _research_tree_panel.has_signal("close_requested"):
		_research_tree_panel.connect("close_requested", _on_research_tree_close_requested)
	if _research_panel.has_signal("full_tree_requested"):
		_research_panel.connect("full_tree_requested", _on_research_full_tree_requested)
	if _research_tree_panel.has_method("get_research_system") and _research_panel.has_method("setup"):
		_research_panel.setup(_research_tree_panel.get_research_system())

	# HUDManager signals for dock button visual state
	hud_manager.panel_opened.connect(_on_panel_opened)
	hud_manager.panel_closed.connect(_on_panel_closed)
	hud_manager.panel_closed.connect(func(panel_name: String) -> void:
		if panel_name == "division_builder":
			if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
				_map_interaction.set_player_input_enabled(true)
	)
	hud_manager.panel_sub_tab_cycle_requested.connect(_on_sub_tab_cycle_requested)

	# Register panels with HUDManager and set keyboard shortcuts
	hud_manager.register_panel("military", _military_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("economy", _economy_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("diplomacy", _diplomacy_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("research", _research_panel, HUDManager.PlacementMode.SIDE_DOCKED)
	hud_manager.register_panel("research_tree", _research_tree_panel, HUDManager.PlacementMode.FULL_CENTER)
	hud_manager.register_panel("production", _production_panel, HUDManager.PlacementMode.SIDE_DOCKED)

	# Province Detail — full-center, opened from FriendlyProvincePanel's Upgrade button
	_province_detail_panel = _ProvinceDetailScene.instantiate()
	add_child(_province_detail_panel)
	_register_ui_input_ownership_root(_province_detail_panel)
	hud_manager.register_panel("province_detail", _province_detail_panel, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.province_detail_open_requested.connect(func(_province_id: String) -> void:
		_hide_all_bottom_panels()
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(false)
		hud_manager.show_panel("province_detail")
	)
	EventBus.province_detail_closed.connect(func() -> void:
		hud_manager.hide_panel("province_detail")
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(true)
	)
	if _province_detail_panel.has_signal("close_requested"):
		_province_detail_panel.connect("close_requested", func() -> void:
			hud_manager.hide_panel("province_detail")
			if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
				_map_interaction.set_player_input_enabled(true)
		)

	EventBus.production_panel_open_requested.connect(func() -> void:
		hud_manager.show_panel("production")
	)

	# Division Builder — full-center, opened from military panel template list
	_division_builder_panel = _DivisionBuilderScene.instantiate()
	add_child(_division_builder_panel)
	_register_ui_input_ownership_root(_division_builder_panel)
	hud_manager.register_panel("division_builder", _division_builder_panel, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.division_builder_open_requested.connect(func(_template_id: String) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _map_renderer != null and _map_renderer.has_method("clear_highlights"):
			_map_renderer.clear_highlights()
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(false)
		hud_manager.show_panel("division_builder")
	)
	EventBus.division_builder_closed.connect(func() -> void:
		hud_manager.hide_panel("division_builder")
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(true)
	)
	if _division_builder_panel.has_signal("close_requested"):
		_division_builder_panel.connect("close_requested", func() -> void:
			hud_manager.hide_panel("division_builder")
			if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
				_map_interaction.set_player_input_enabled(true)
		)

	# Air Wing Escort Picker — popup, shown from friendly air wing panel
	var escort_picker := PanelContainer.new()
	escort_picker.set_script(load("res://src/ui/hud/air_wing_escort_picker_panel.gd"))
	escort_picker.anchors_preset = Control.PRESET_CENTER
	hud_manager.register_panel("air_wing_escort_picker", escort_picker, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.air_wing_escort_picker_open_requested.connect(func(wing_id: String) -> void:
		escort_picker.open_for_wing(wing_id)
		hud_manager.show_panel("air_wing_escort_picker")
	)
	if escort_picker.has_signal("close_requested"):
		escort_picker.connect("close_requested", func() -> void:
			hud_manager.hide_panel("air_wing_escort_picker")
		)

	# Air Wing Spawn Panel — popup, opened from military panel "+" button
	var spawn_panel := PanelContainer.new()
	spawn_panel.set_script(load("res://src/ui/hud/air_wing_spawn_panel.gd"))
	spawn_panel.anchors_preset = Control.PRESET_CENTER
	hud_manager.register_panel("air_wing_spawn", spawn_panel, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.air_wing_spawn_open_requested.connect(func(_province_id: String) -> void:
		spawn_panel.open_spawn_modal()
		hud_manager.show_panel("air_wing_spawn")
	)
	if spawn_panel.has_signal("close_requested"):
		spawn_panel.connect("close_requested", func() -> void:
			hud_manager.hide_panel("air_wing_spawn")
		)

	# Market — full-center, opened from the top bar or Economy → My Trade (Phase 9 Branch D)
	var market_wrapper: Control = _build_full_center_wrapper("res://src/ui/hud/market_panel.gd", Color(0.79, 0.60, 0.19, 1.0))
	var market_panel: Node = market_wrapper.get_node("OuterMargin/Center/Panel")
	hud_manager.register_panel("market", market_wrapper, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.market_panel_open_requested.connect(func() -> void:
		hud_manager.show_panel("market")
	)
	if market_panel.has_signal("close_requested"):
		market_panel.connect("close_requested", func() -> void:
			hud_manager.hide_panel("market")
		)

	# Propose Trade Route — full-center, opened from Diplomacy → Trade Routes (Phase 9 Branch D).
	# Small form content (well under viewport width) — HUDManager._center_panel() correctly
	# shrink-wraps and centers this via get_combined_minimum_size() without needing the
	# full-rect wrapper Market needs (see _build_full_center_wrapper's doc comment).
	var propose_route_panel := PanelContainer.new()
	propose_route_panel.set_script(load("res://src/ui/hud/propose_trade_route_panel.gd"))
	propose_route_panel.theme = _DOCK_BUTTON_STYLE_NORMAL
	var propose_route_sb := StyleBoxFlat.new()
	propose_route_sb.bg_color = Color(0.07, 0.05, 0.03, 0.96)
	propose_route_sb.border_width_left = 3
	propose_route_sb.border_color = Color(0.48, 0.31, 0.69, 1.0)
	propose_route_sb.corner_radius_top_left = 4
	propose_route_sb.corner_radius_top_right = 4
	propose_route_sb.corner_radius_bottom_right = 4
	propose_route_sb.corner_radius_bottom_left = 4
	propose_route_panel.add_theme_stylebox_override("panel", propose_route_sb)
	hud_manager.register_panel("propose_trade_route", propose_route_panel, HUDManager.PlacementMode.FULL_CENTER)
	EventBus.propose_trade_route_open_requested.connect(func() -> void:
		propose_route_panel.open_propose_modal()
		hud_manager.show_panel("propose_trade_route")
	)
	if propose_route_panel.has_signal("close_requested"):
		propose_route_panel.connect("close_requested", func() -> void:
			hud_manager.hide_panel("propose_trade_route")
		)

	# Division Template Viewer — full-center, opened from mini-comp grid click
	_division_template_viewer_panel = _DivisionTemplateViewerScene.instantiate()
	add_child(_division_template_viewer_panel)
	_register_ui_input_ownership_root(_division_template_viewer_panel)
	hud_manager.register_panel("division_template_viewer", _division_template_viewer_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.division_template_viewer_open_requested.connect(func(div_id: String) -> void:
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _map_renderer != null and _map_renderer.has_method("clear_highlights"):
			_map_renderer.clear_highlights()
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(false)
		hud_manager.show_panel("division_template_viewer")
	)
	EventBus.division_template_viewer_closed.connect(func() -> void:
		hud_manager.hide_panel("division_template_viewer")
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(true)
	)
	if _division_template_viewer_panel.has_signal("close_requested"):
		_division_template_viewer_panel.connect("close_requested", func() -> void:
			EventBus.division_template_viewer_closed.emit()
		)

	# TacticalCombatPanel — FULL_CENTER overlay, registered with HUDManager
	var _tcp_scene := preload("res://scenes/game/panels/tactical_combat_panel.tscn")
	var _tactical_combat_panel: Control = _tcp_scene.instantiate()
	add_child(_tactical_combat_panel)
	_register_ui_input_ownership_root(_tactical_combat_panel)
	hud_manager.register_panel("tactical_combat", _tactical_combat_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.tactical_combat_opened.connect(func(_eng_id: String) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _map_renderer != null and _map_renderer.has_method("clear_highlights"):
			_map_renderer.clear_highlights()
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(false)
		hud_manager.show_panel("tactical_combat")
	)
	EventBus.tactical_combat_closed.connect(func() -> void:
		hud_manager.hide_panel("tactical_combat")
		if _map_interaction != null and _map_interaction.has_method("set_player_input_enabled"):
			_map_interaction.set_player_input_enabled(true)
	)

	# BombingDetailPanel — full-center overlay for bombing run results
	const BombingDetailPanelScene := preload("res://src/ui/hud/bombing_detail_panel.tscn")
	var _bombing_detail_panel: Control = BombingDetailPanelScene.instantiate()
	add_child(_bombing_detail_panel)
	_register_ui_input_ownership_root(_bombing_detail_panel)
	hud_manager.register_panel("bombing_detail", _bombing_detail_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.bombing_detail_open_requested.connect(func(data: Dictionary) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _air_wing_system != null and _air_wing_system.has_method("deselect"):
			_air_wing_system.deselect()
		_bombing_detail_panel.populate(data)
		hud_manager.show_panel("bombing_detail")
	)
	EventBus.bombing_detail_closed.connect(func() -> void:
		hud_manager.hide_panel("bombing_detail")
	)

	# AirCombatDetailPanel — full-center overlay for air-to-air combat results
	const AirCombatDetailPanelScene := preload("res://src/ui/hud/air_combat_detail_panel.tscn")
	var _air_combat_detail_panel: Control = AirCombatDetailPanelScene.instantiate()
	add_child(_air_combat_detail_panel)
	_register_ui_input_ownership_root(_air_combat_detail_panel)
	hud_manager.register_panel("air_combat_detail", _air_combat_detail_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.air_combat_detail_open_requested.connect(func(data: Dictionary) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _air_wing_system != null and _air_wing_system.has_method("deselect"):
			_air_wing_system.deselect()
		_air_combat_detail_panel.populate(data)
		hud_manager.show_panel("air_combat_detail")
	)
	EventBus.air_combat_detail_closed.connect(func() -> void:
		hud_manager.hide_panel("air_combat_detail")
	)

	# StrategicBombingDetailPanel — full-center overlay for strategic bombing results
	const StrategicBombingDetailPanelScene := preload("res://src/ui/hud/strategic_bombing_detail_panel.tscn")
	var _strategic_bombing_detail_panel: Control = StrategicBombingDetailPanelScene.instantiate()
	add_child(_strategic_bombing_detail_panel)
	_register_ui_input_ownership_root(_strategic_bombing_detail_panel)
	hud_manager.register_panel("strategic_bombing_detail", _strategic_bombing_detail_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.strategic_bombing_detail_open_requested.connect(func(data: Dictionary) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
		if _map_interaction != null and _map_interaction.has_method("deselect"):
			_map_interaction.deselect()
		if _air_wing_system != null and _air_wing_system.has_method("deselect"):
			_air_wing_system.deselect()
		_strategic_bombing_detail_panel.populate(data)
		hud_manager.show_panel("strategic_bombing_detail")
	)
	EventBus.strategic_bombing_detail_closed.connect(func() -> void:
		hud_manager.hide_panel("strategic_bombing_detail")
	)

	hud_manager.set_panel_shortcut("economy",   KEY_E)
	hud_manager.set_panel_shortcut("military",  KEY_Y)
	hud_manager.set_panel_shortcut("diplomacy", KEY_T)
	hud_manager.set_panel_shortcut("research",  KEY_Q)
	hud_manager.set_panel_shortcut("production", KEY_R)

	# Bottom selection bar — reactive to EventBus selection signals
	EventBus.division_selected.connect(_on_division_selected)
	EventBus.province_selected.connect(_on_province_selected)
	EventBus.air_wing_selected.connect(_on_air_wing_selected)
	EventBus.division_deselected.connect(_on_bottom_bar_deselected)
	EventBus.division_selection_changed.connect(_on_land_selection_changed)
	EventBus.division_active_changed.connect(_on_land_active_changed)
	EventBus.division_hold_eligibility_changed.connect(_on_division_hold_eligibility_changed)
	EventBus.division_retreat_eligibility_changed.connect(_on_division_retreat_eligibility_changed)
	EventBus.division_screen_position_updated.connect(_on_division_screen_position_updated)
	EventBus.division_removed.connect(_on_land_division_removed)
	EventBus.move_mode_active_changed.connect(hud_manager.set_move_mode_active)
	EventBus.province_deselected.connect(_on_bottom_bar_deselected)
	EventBus.air_wing_deselected.connect(_on_bottom_bar_deselected)
	EventBus.research_started.connect(_on_research_started)
	EventBus.research_progress_changed.connect(_on_research_progress_changed)
	EventBus.research_completed.connect(_on_research_completed)
	_set_research_progress_fill(0.0)

	# Center bottom panels horizontally and on resize
	get_viewport().size_changed.connect(_on_viewport_size_changed)
	if _chat_panel.has_signal("layout_changed"):
		_chat_panel.connect("layout_changed", _on_chat_panel_layout_changed)
	_layout_persistent_hud()
	_layout_bottom_hud()
	_land_selection_surround.action_requested.connect(_on_land_selection_action_requested)
	for action_button: Button in _land_selection_surround.get_all_control_buttons():
		_register_ui_input_ownership_root(action_button)


func _process(delta: float) -> void:
	_session_elapsed_seconds += delta
	var display_seconds: int = int(_session_elapsed_seconds)
	if display_seconds != _last_displayed_session_seconds:
		set_session_time(display_seconds)
	_refresh_ui_pointer_blocking()
	_position_land_selection_popover()
	_position_land_selection_surround()


func _make_dock_toggle(panel_name: String) -> Callable:
	return func() -> void:
		hud_manager.toggle_panel(panel_name)


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		_close_chat_input_when_clicking_outside(event as InputEventMouseButton)
		return
	if not event is InputEventKey:
		return
	var key_event: InputEventKey = event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return
	if _chat_panel != null and _chat_panel.has_method("is_message_input_focused"):
		if _chat_panel.is_message_input_focused():
			return
	if event.is_action_pressed("map_mode_forward", false, true):
		_cycle_map_mode(1)
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("map_mode_backward", false, true):
		_cycle_map_mode(-1)
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("chat_team", false, true):
		if _chat_panel != null and _chat_panel.has_method("open_chat_input"):
			_chat_panel.open_chat_input()
			get_viewport().set_input_as_handled()


## Releases chat text focus when the player clicks outside the chat panel.
## Parameters:
## - mouse_event: viewport mouse button input.
## Returns: nothing.
func _close_chat_input_when_clicking_outside(mouse_event: InputEventMouseButton) -> void:
	if not mouse_event.pressed or mouse_event.button_index != MOUSE_BUTTON_LEFT:
		return
	if _chat_panel == null or not _chat_panel.has_method("is_message_input_focused"):
		return
	if not _chat_panel.is_message_input_focused():
		return
	if _chat_panel.get_global_rect().has_point(mouse_event.position):
		return
	if _chat_panel.has_method("close_chat_input"):
		_chat_panel.close_chat_input()


## Registers HUD controls that should own pointer or text input over the map.
## Parameters: none.
## Returns: nothing.
func _register_initial_ui_input_ownership() -> void:
	for root: Control in [
		_top_bar,
		_left_dock_rail,
		_map_mode_tabs,
		_side_panel_anchor,
		_center_panel_anchor,
		overlay_dim,
		_military_panel,
		_economy_panel,
		_diplomacy_panel,
		_research_panel,
		_research_tree_panel,
		_land_selection_popover,
		_friendly_prov_panel,
		_enemy_div_panel,
		_chat_panel,
	]:
		_register_ui_input_ownership_root(root)


## Builds a FULL_CENTER wrapper for a code-built popup that (a) needs its box shrink-wrapped
## to its own content and centered on both axes — like every other panel — rather than
## stretched to fill the screen, and (b) has some content wide/tall enough to need internal
## scrolling capped at a fixed size (e.g. Market's per-resource columns), which requires a
## bounded layout context to clip against.
##
## Structure: full-rect Control root > full-rect MarginContainer ("OuterMargin", generous edge
## margins so the box never touches screen edges even at max size) > CenterContainer (centers
## its child using the child's own natural minimum size, on both axes) > PanelContainer
## ("Panel", the actual visible bordered box, carrying the given script).
##
## Registering the ROOT (not the inner Panel) with HUDManager is required:
## HUDManager._center_panel() only takes its "just fill the available area" branch when the
## registered node's own anchors are already full-rect (checked via
## anchor_left/top/right/bottom == 0/0/1/1) — a plain PanelContainer sized only by its own
## content falls into the OTHER branch instead, which sizes/positions the panel using
## get_combined_minimum_size() computed with NO surrounding size constraint; for a
## multi-column panel like Market whose ScrollContainer only clips when something upstream
## actually bounds its size, that unconstrained minimum size can exceed the viewport,
## producing a huge, top-left-pinned, off-screen-clipped panel instead of a centered one. The
## CenterContainer here provides exactly that bound (screen size minus OuterMargin's margins)
## while still shrink-wrapping and centering the box like every other panel.
##
## Note: assigning a Control's `.anchors_preset` property from GDScript does nothing at
## runtime (it is an editor-only inspector convenience) — full-rect anchoring must be set via
## the real anchor_left/top/right/bottom + grow_horizontal/vertical properties, as done here.
func _build_full_center_wrapper(script_path: String, accent_color: Color) -> Control:
	var root := Control.new()
	root.anchor_left = 0.0
	root.anchor_top = 0.0
	root.anchor_right = 1.0
	root.anchor_bottom = 1.0
	root.grow_horizontal = Control.GROW_DIRECTION_BOTH
	root.grow_vertical = Control.GROW_DIRECTION_BOTH

	var outer_margin := MarginContainer.new()
	outer_margin.name = "OuterMargin"
	outer_margin.anchor_left = 0.0
	outer_margin.anchor_top = 0.0
	outer_margin.anchor_right = 1.0
	outer_margin.anchor_bottom = 1.0
	outer_margin.grow_horizontal = Control.GROW_DIRECTION_BOTH
	outer_margin.grow_vertical = Control.GROW_DIRECTION_BOTH
	outer_margin.add_theme_constant_override("margin_left", 48)
	outer_margin.add_theme_constant_override("margin_top", 42)
	outer_margin.add_theme_constant_override("margin_right", 48)
	outer_margin.add_theme_constant_override("margin_bottom", 42)
	root.add_child(outer_margin)

	var center := CenterContainer.new()
	center.name = "Center"
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	outer_margin.add_child(center)

	var panel := PanelContainer.new()
	panel.name = "Panel"
	panel.theme = _DOCK_BUTTON_STYLE_NORMAL
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.07, 0.05, 0.03, 0.96)
	sb.border_width_left = 3
	sb.border_color = accent_color
	sb.corner_radius_top_left = 4
	sb.corner_radius_top_right = 4
	sb.corner_radius_bottom_right = 4
	sb.corner_radius_bottom_left = 4
	panel.add_theme_stylebox_override("panel", sb)
	panel.set_script(load(script_path))
	center.add_child(panel)

	return root


## Registers one interactive UI root and its text descendants for map input ownership.
## Parameters:
## - root: Control whose visible rect should suppress pointer-driven map controls.
## Returns: nothing.
func _register_ui_input_ownership_root(root: Control) -> void:
	if root == null:
		return
	if not _ui_pointer_blocker_roots.has(root):
		_ui_pointer_blocker_roots.append(root)
	if root.mouse_filter == Control.MOUSE_FILTER_IGNORE:
		root.mouse_filter = Control.MOUSE_FILTER_STOP
	if not root.visibility_changed.is_connected(_on_ui_pointer_blocker_visibility_changed.bind(root)):
		root.visibility_changed.connect(_on_ui_pointer_blocker_visibility_changed.bind(root))
	_register_text_focus_descendants(root)


## Rechecks pointer ownership when a UI root visibility changes.
## Parameters:
## - _control: UI root whose visibility changed.
## Returns: nothing.
func _on_ui_pointer_blocker_visibility_changed(_control: Control) -> void:
	_refresh_ui_pointer_blocking()


## Emits pointer blocking only when the aggregate UI hover state changes.
## Parameters: none.
## Returns: nothing.
func _refresh_ui_pointer_blocking() -> void:
	var blocking: bool = _is_pointer_over_registered_ui()
	if _is_ui_pointer_blocking == blocking:
		return
	_is_ui_pointer_blocking = blocking
	EventBus.ui_pointer_blocking_changed.emit(blocking)


## Checks whether the viewport pointer is inside a visible registered HUD root.
## Parameters: none.
## Returns: true when pointer-driven map camera controls should be suppressed.
func _is_pointer_over_registered_ui() -> bool:
	var viewport_mouse_position: Vector2 = get_viewport().get_mouse_position()
	return _is_position_over_registered_ui(viewport_mouse_position)


## Checks whether a viewport position is inside a visible registered HUD root.
## Parameters:
## - viewport_position: pointer position in viewport coordinates.
## Returns: true when pointer-driven map camera controls should be suppressed.
func _is_position_over_registered_ui(viewport_position: Vector2) -> bool:
	for control: Control in _ui_pointer_blocker_roots:
		if control != null and control.is_visible_in_tree() and control.mouse_filter != Control.MOUSE_FILTER_IGNORE:
			if control.get_global_rect().has_point(viewport_position):
				return true
	return false


## Registers text controls below a UI root so keyboard camera movement pauses while typing.
## Parameters:
## - node: root node to scan.
## Returns: nothing.
func _register_text_focus_descendants(node: Node) -> void:
	if node is LineEdit or node is TextEdit:
		var control: Control = node as Control
		if not control.focus_entered.is_connected(_on_ui_text_focus_entered.bind(control)):
			control.focus_entered.connect(_on_ui_text_focus_entered.bind(control))
		if not control.focus_exited.is_connected(_on_ui_text_focus_exited.bind(control)):
			control.focus_exited.connect(_on_ui_text_focus_exited.bind(control))
	for child: Node in node.get_children():
		_register_text_focus_descendants(child)


## Marks a text control as owning keyboard input.
## Parameters:
## - control: text input that gained focus.
## Returns: nothing.
func _on_ui_text_focus_entered(control: Control) -> void:
	if control == null:
		return
	_ui_text_focus_controls[control] = true
	_refresh_ui_text_input_focus()


## Clears keyboard input ownership for a text control.
## Parameters:
## - control: text input that lost focus.
## Returns: nothing.
func _on_ui_text_focus_exited(control: Control) -> void:
	_ui_text_focus_controls.erase(control)
	_refresh_ui_text_input_focus()


## Emits text-input focus state only when the aggregate focus state changes.
## Parameters: none.
## Returns: nothing.
func _refresh_ui_text_input_focus() -> void:
	var focused: bool = false
	for key: Variant in _ui_text_focus_controls.keys():
		var control: Control = key as Control
		if control != null and control.has_focus() and control.is_visible_in_tree():
			focused = true
			break
	if _is_ui_text_input_focused == focused:
		return
	_is_ui_text_input_focused = focused
	EventBus.ui_text_input_focus_changed.emit(focused)


## Connects a side drawer close signal to HUDManager so drawer state stays centralized.
## Parameters:
## - panel_name: registered HUDManager panel name.
## - panel_node: side drawer control that may expose close_requested.
## Returns: nothing.
func _connect_side_drawer_close(panel_name: String, panel_node: Control) -> void:
	if panel_node == null or not panel_node.has_signal("close_requested"):
		return
	panel_node.connect("close_requested", func() -> void:
		hud_manager.hide_panel(panel_name)
	)


func _on_panel_opened(panel_name: String) -> void:
	var btn: Button = _get_dock_button_for_panel(panel_name)
	if btn != null:
		_set_dock_button_active(btn)
	var entry: Dictionary = hud_manager._registry.get(panel_name, {})
	_land_selection_popover.set_suspended(true)
	_land_selection_surround.set_displayed(false)
	if entry.get("placement", -1) == HUDManager.PlacementMode.SIDE_DOCKED:
		_hide_all_bottom_panels()


func _on_panel_closed(panel_name: String) -> void:
	if hud_manager.get_open_panel() == "":
		_set_dock_button_active(null)
		_land_selection_popover.set_suspended(false)
		_position_land_selection_surround()


func _get_dock_button_for_panel(panel_name: String) -> Button:
	match panel_name:
		"economy":   return _dock_btn_e
		"military":  return _dock_btn_t
		"diplomacy": return _dock_btn_y
		"research":  return _dock_btn_q
		"research_tree": return _dock_btn_q
		"production": return _dock_btn_p
	return null


## Closes the full research tree through HUDManager so overlay and dock state stay in sync.
## Parameters: none.
## Returns: nothing.
func _on_research_tree_close_requested() -> void:
	hud_manager.hide_panel("research_tree")


## Opens the full research tree from the side drawer.
## Parameters: none.
## Returns: nothing.
func _on_research_full_tree_requested() -> void:
	hud_manager.show_panel("research_tree")


## Resets the dock progress fill when a new research entry starts.
## Parameters:
## - _entry_id: active research entry identifier.
## Returns: nothing.
func _on_research_started(_entry_id: String) -> void:
	_set_research_progress_fill(0.0)


## Updates the dock progress fill from bottom to top.
## Parameters:
## - _entry_id: active research entry identifier.
## - progress_ratio: normalized research progress from 0.0 to 1.0.
## Returns: nothing.
func _on_research_progress_changed(_entry_id: String, progress_ratio: float) -> void:
	_set_research_progress_fill(progress_ratio)


## Clears the dock progress fill when there is no active research.
## Parameters:
## - _entry_id: completed research entry identifier.
## - _effects: completed research effects payload.
## Returns: nothing.
func _on_research_completed(_entry_id: String, _effects: Dictionary) -> void:
	_set_research_progress_fill(0.0)


## Sets the research dock button progress overlay height using a normalized ratio.
## Parameters:
## - progress_ratio: normalized progress from 0.0 to 1.0.
## Returns: nothing.
func _set_research_progress_fill(progress_ratio: float) -> void:
	if _research_progress_fill == null:
		return
	var normalized_progress: float = clampf(progress_ratio, 0.0, 1.0)
	var button_height: float = _dock_btn_q.size.y
	if button_height <= 0.0:
		button_height = _dock_btn_q.get_combined_minimum_size().y
	var fill_height: float = floor(button_height * normalized_progress)
	_research_progress_fill.visible = fill_height > 0.0
	_research_progress_fill.offset_left = 0.0
	_research_progress_fill.offset_right = 0.0
	_research_progress_fill.offset_bottom = 0.0
	_research_progress_fill.offset_top = -fill_height


func _set_dock_button_active(btn: Button) -> void:
	if _active_dock_btn != null:
		_active_dock_btn.remove_theme_stylebox_override("normal")
	_active_dock_btn = btn
	if btn != null:
		var style: StyleBoxFlat = StyleBoxFlat.new()
		style.bg_color = Color(0.18, 0.13, 0.08, 1.0)
		style.border_color = Color(0.6, 0.45, 0.25, 1.0)
		btn.add_theme_stylebox_override("normal", style)


## Cycles the shared map mode and keeps the compact HUD controls synchronized.
## Parameters:
## - direction: positive for forward and negative for backward.
## Returns: nothing.
func _cycle_map_mode(direction: int) -> void:
	_set_map_mode(posmod(_map_mode_index + direction, _MAP_MODES.size()))


## Selects a map mode directly and synchronizes the three compact buttons.
## Parameters:
## - mode_index: index in the canonical political, cover, elevation cycle order.
## Returns: nothing.
func _set_map_mode(mode_index: int) -> void:
	_map_mode_index = mode_index
	_btn_map_political.button_pressed = mode_index == 0
	_btn_map_terrain.button_pressed = mode_index == 1
	_btn_map_cover.button_pressed = mode_index == 2
	_refresh_map_mode_button_visuals()
	EventBus.map_mode_changed.emit(_MAP_MODES[mode_index])


## Gives the selected map-mode segment stronger text and icon emphasis.
## Parameters: none.
## Returns: nothing.
func _refresh_map_mode_button_visuals() -> void:
	var buttons: Array[Button] = [_btn_map_political, _btn_map_terrain, _btn_map_cover]
	for index: int in buttons.size():
		var button: Button = buttons[index]
		var is_active: bool = index == _map_mode_index
		var label: Label = button.get_node("Content/Label") as Label
		label.add_theme_color_override(
			"font_color", _MAP_MODE_ACTIVE_TEXT if is_active else _MAP_MODE_INACTIVE_TEXT
		)


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
	# Check if click landed outside the currently-open panel
	var panel_node: Control = entry.get("node") as Control
	if panel_node == null:
		return
	var panel_rect: Rect2 = Rect2(panel_node.position, panel_node.size)
	if not panel_rect.has_point(mb.position):
		hud_manager.hide_panel(open_name)
		get_viewport().set_input_as_handled()


## Called by game session to update the persistent nation display.
func set_nation(nation_name: String, flag_texture: Texture2D) -> void:
	_nation_label.text = nation_name
	_flag_texture.texture = flag_texture


## ── Bottom selection bar ───────────────────────────────────────────────────

## Handles owned land selection by clearing mutually-exclusive bottom details.
func _on_division_selected(div_id: String) -> void:
	var data: Dictionary = GameState.get_division(div_id)
	if data.is_empty():
		return
	_hide_all_bottom_panels()
	if _is_side_panel_open():
		_land_selection_popover.set_suspended(true)
		return
	var my_nation: String = GameState.get_my_nation_id()
	if not my_nation.is_empty() and data.get("nation_id", "") != my_nation:
		_enemy_div_panel.populate(div_id, data)
		_enemy_div_panel.visible = true
		_layout_bottom_hud()


## Tracks the selected owned-land set without mutating gameplay selection.
func _on_land_selection_changed(division_ids: Array[String]) -> void:
	var previous_single_id: String = _active_land_division_id \
			if _selected_land_division_ids.size() == 1 else ""
	_selected_land_division_ids = division_ids.duplicate()
	if not _selected_land_division_ids.has(_active_land_division_id):
		_active_land_division_id = _selected_land_division_ids[0] \
				if not _selected_land_division_ids.is_empty() else ""
	var next_single_id: String = _active_land_division_id \
			if _selected_land_division_ids.size() == 1 else ""
	if next_single_id != previous_single_id:
		_land_surround_placement = &""
		_land_surround_tray_slide = 0.0
	if next_single_id.is_empty():
		_pending_land_selection_animation_id = ""
	elif next_single_id != previous_single_id:
		_pending_land_selection_animation_id = next_single_id
	_refresh_land_selection_actions()
	_position_land_selection_surround()


func _on_land_active_changed(division_id: String) -> void:
	var previous_active_id: String = _active_land_division_id
	_active_land_division_id = division_id
	if _selected_land_division_ids.size() == 1 and division_id != previous_active_id:
		_pending_land_selection_animation_id = division_id
		_land_surround_placement = &""
		_land_surround_tray_slide = 0.0
	_refresh_land_selection_actions()
	_position_land_selection_surround()


## Applies MilitarySystem-owned Hold availability to the active single-selection tray.
## Parameters:
## - division_id: division whose eligibility was recomputed.
## - eligible: whether Hold is currently valid for that division.
## Returns: nothing.
func _on_division_hold_eligibility_changed(division_id: String, eligible: bool) -> void:
	_hold_eligibility_division_id = division_id
	_hold_eligible = eligible
	_refresh_land_selection_actions()
	_position_land_selection_surround()


## Applies MilitarySystem-owned Retreat availability to the active single-selection tray.
## Parameters:
## - division_id: division whose eligibility was recomputed.
## - eligible: whether Retreat is currently valid for that division.
## Returns: nothing.
func _on_division_retreat_eligibility_changed(division_id: String, eligible: bool) -> void:
	_retreat_eligibility_division_id = division_id
	_retreat_eligible = eligible
	_refresh_land_selection_actions()
	_position_land_selection_surround()


## Refreshes tray actions while retaining a stable division context for input dispatch.
## Parameters: none.
## Returns: nothing.
func _refresh_land_selection_actions() -> void:
	var has_single_context: bool = _selected_land_division_ids.size() == 1 \
			and not _active_land_division_id.is_empty() \
			and _selected_land_division_ids.has(_active_land_division_id)
	var context_division_id: String = _active_land_division_id if has_single_context else ""
	_land_selection_surround.set_action_context(
		context_division_id,
		has_single_context
			and _hold_eligibility_division_id == context_division_id
			and _hold_eligible,
		has_single_context
			and _retreat_eligibility_division_id == context_division_id
			and _retreat_eligible
	)


## Relays a validated single-division tray action without mutating gameplay state.
func _on_land_selection_action_requested(action_id: StringName, division_id: String) -> void:
	if _selected_land_division_ids.size() != 1 or _active_land_division_id.is_empty():
		return
	if division_id != _active_land_division_id or not _selected_land_division_ids.has(division_id):
		return
	var division_data: Dictionary = GameState.get_division(division_id)
	if division_data.is_empty() or division_data.get("combat_state", "idle") == "destroyed":
		return
	var my_nation: String = GameState.get_my_nation_id()
	if not my_nation.is_empty() and division_data.get("nation_id", "") != my_nation:
		return
	match action_id:
		&"composition":
			_land_selection_surround.set_displayed(false)
			EventBus.division_template_viewer_open_requested.emit(division_id)
		&"center_camera":
			EventBus.division_center_camera_requested.emit(division_id)
		&"hold":
			EventBus.division_hold_requested.emit(division_id)
		&"retreat":
			EventBus.division_retreat_requested.emit(division_id)


## Handles air wing selection — shows FriendlyAirWingPanel for own wings.
func _on_air_wing_selected(wing_id: String) -> void:
	var data: Dictionary = GameState.get_air_wing(wing_id)
	if data.is_empty():
		return
	_hide_all_bottom_panels()
	if _is_side_panel_open():
		return
	_friendly_air_wing_panel.populate(wing_id, data)
	_friendly_air_wing_panel.visible = true
	_layout_bottom_hud()


## Recenter all bottom panels when the viewport is resized.
func _on_viewport_size_changed() -> void:
	_layout_persistent_hud()
	_layout_bottom_hud()
	_position_land_selection_surround()


## Applies the single narrow-screen breakpoint and clamps side drawer width.
## Parameters:
## - width_override: optional logical viewport width used by deterministic layout tests.
## Returns: nothing.
func _layout_persistent_hud(width_override: float = -1.0) -> void:
	var viewport_width: float = width_override
	if viewport_width <= 0.0:
		viewport_width = get_viewport().get_visible_rect().size.x
	var drawer_width: float = minf(
		_SIDE_DRAWER_WIDTH,
		maxf(_SIDE_DRAWER_MIN_WIDTH, viewport_width * 0.36)
	)
	for panel: Control in [_military_panel, _economy_panel, _diplomacy_panel, _research_panel]:
		panel.custom_minimum_size.x = drawer_width

	var use_narrow_layout: bool = viewport_width < _NARROW_HUD_BREAKPOINT
	if use_narrow_layout == _is_narrow_hud:
		return
	_is_narrow_hud = use_narrow_layout
	_nation_label.visible = not use_narrow_layout
	_refresh_resource_bar()


## Branch B — refreshes the top bar's always-4 (Money/Grain/Oil/Manpower) and the "[v N more]"
## hover flyout's contents. Only resources this nation has meaningful access to appear in the
## flyout (a landlocked nation with zero aluminium access never shows an aluminium row) —
## approximated client-side via nonzero current stockpile or nonzero storage cap, since the
## client doesn't receive raw per-resource national deposit totals directly.
func _refresh_resource_bar() -> void:
	var narrow: bool = _is_narrow_hud
	var money_rate: float = GameState.resource_net_rates.get("money", 0.0)
	var grain_rate: float = GameState.resource_net_rates.get("grain", 0.0)
	var oil_rate: float = GameState.resource_net_rates.get("oil", 0.0)

	_money_label.text = "$%d (%s%d/t)" % [int(GameState.resources.get("money", 0.0)), "+" if money_rate >= 0 else "", int(money_rate)]
	_grain_label.text = "%s %d (%s%d/t)" % ["GR" if narrow else "GRAIN", int(GameState.resources.get("grain", 0.0)), "+" if grain_rate >= 0 else "", int(grain_rate)]

	var oil_text: String = "%s %d (%s%d/t)" % ["OIL", int(GameState.resources.get("oil", 0.0)), "+" if oil_rate >= 0 else "", int(oil_rate)]
	# Oil's "!" marker — only when the penalty is actively biting, never for low stock alone.
	if GameState.oil_penalty_active:
		oil_text += " !"
	_oil_label.text = oil_text

	_manpower_label.text = "%s %d/%d" % ["MP" if narrow else "MANPOWER", int(GameState.manpower_available), int(GameState.manpower_ceiling)]

	var flyout_resources: Array = []
	for res_type: String in _ALL_RESOURCE_ORDER:
		if _TOP_BAR_RESOURCES.has(res_type):
			continue
		var has_access: bool = GameState.resources.get(res_type, 0.0) > 0.0 or GameState.resource_storage_cap.get(res_type, 0.0) > 0.0
		if has_access:
			flyout_resources.append(res_type)

	_more_button.text = "v %d more" % flyout_resources.size()

	for child in _more_flyout_list.get_children():
		child.queue_free()
	for res_type: String in flyout_resources:
		var rate: float = GameState.resource_net_rates.get(res_type, 0.0)
		var row := Label.new()
		row.text = "%s   %d   %s%d/t" % [res_type.to_upper(), int(GameState.resources.get(res_type, 0.0)), "+" if rate >= 0 else "", int(rate)]
		_more_flyout_list.add_child(row)


func _position_more_flyout() -> void:
	# top_level = true makes `position` viewport-relative, not parent-relative — anchor to the
	# button's actual global position (bottom-left corner) instead of local (0, height).
	_more_flyout.global_position = _more_button.global_position + Vector2(0, _more_button.size.y)


func _on_more_button_mouse_exited() -> void:
	# Give the pointer a frame to land on the flyout itself before hiding — dismissed on
	# mouse-leave per the Hover Flyout pattern, but only once it's actually left BOTH controls.
	await get_tree().process_frame
	if not _more_button.get_global_rect().has_point(get_viewport().get_mouse_position()) \
			and not _more_flyout.get_global_rect().has_point(get_viewport().get_mouse_position()):
		_more_flyout.visible = false


## Relays chat size changes back into the bottom HUD layout.
## Parameters: none.
## Returns: nothing.
func _on_chat_panel_layout_changed() -> void:
	_layout_bottom_hud()


## Positions chat and selection panels along the bottom HUD edge.
## Call on ready, on viewport resize, and after showing a panel.
## Parameters: none.
## Returns: nothing.
func _layout_bottom_hud() -> void:
	_layout_bottom_hud_deferred()


## Waits one frame so scene-instanced minimum sizes are available before layout.
## Parameters: none.
## Returns: nothing.
func _layout_bottom_hud_deferred() -> void:
	await get_tree().process_frame
	_position_chat_panel()
	_position_toast_container()
	for panel: Control in [_friendly_prov_panel, _enemy_div_panel, _friendly_air_wing_panel]:
		_position_bottom_selection_panel(panel)
	_position_land_selection_popover()
	_position_land_selection_surround()


## Places the contextual land inspector beside its active world-space counter.
## Parameters: none.
## Returns: nothing.
func _position_land_selection_popover() -> void:
	if _land_selection_popover == null or not _land_selection_popover.is_display_requested():
		return
	var anchor_id: String = _land_selection_popover.get_anchor_division_id()
	var anchor: Vector2 = _division_screen_positions.get(anchor_id, Vector2(-1.0, -1.0))
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var usable_rect := Rect2(
		Vector2(_left_dock_rail.get_global_rect().end.x + _LAND_POPOVER_MARGIN, _map_mode_tabs.get_global_rect().end.y + _LAND_POPOVER_MARGIN),
		Vector2(
			viewport_size.x - _left_dock_rail.get_global_rect().end.x - (_LAND_POPOVER_MARGIN * 2.0),
			viewport_size.y - _map_mode_tabs.get_global_rect().end.y - (_LAND_POPOVER_MARGIN * 2.0)
		)
	)
	if anchor.x < usable_rect.position.x or anchor.y < usable_rect.position.y or anchor.x > usable_rect.end.x or anchor.y > usable_rect.end.y:
		_land_selection_popover.set_anchor_available(false)
		return
	var popover_size: Vector2 = _land_selection_popover.get_combined_minimum_size()
	_land_selection_popover.size = popover_size
	var candidates: Array[Vector2] = [
		anchor + Vector2(-popover_size.x - _LAND_POPOVER_OFFSET, -popover_size.y - _LAND_POPOVER_OFFSET),
		anchor + Vector2(_LAND_POPOVER_OFFSET, -popover_size.y - _LAND_POPOVER_OFFSET),
		anchor + Vector2(-popover_size.x - _LAND_POPOVER_OFFSET, _LAND_POPOVER_OFFSET),
		anchor + Vector2(_LAND_POPOVER_OFFSET, _LAND_POPOVER_OFFSET),
	]
	var chosen_position: Vector2 = candidates[0]
	for candidate: Vector2 in candidates:
		var candidate_rect := Rect2(candidate, popover_size)
		if usable_rect.encloses(candidate_rect) and not _land_popover_overlaps_chat(candidate_rect):
			chosen_position = candidate
			break
	chosen_position.x = clampf(chosen_position.x, usable_rect.position.x, usable_rect.end.x - popover_size.x)
	chosen_position.y = clampf(chosen_position.y, usable_rect.position.y, usable_rect.end.y - popover_size.y)
	var chosen_rect := Rect2(chosen_position, popover_size)
	if _land_popover_overlaps_chat(chosen_rect):
		chosen_position.y = minf(chosen_position.y, _chat_panel.get_global_rect().position.y - popover_size.y - _LAND_POPOVER_MARGIN)
		chosen_position.y = clampf(chosen_position.y, usable_rect.position.y, usable_rect.end.y - popover_size.y)
	_land_selection_popover.global_position = chosen_position
	_land_selection_popover.set_leader_target(anchor)
	_land_selection_popover.set_anchor_available(true)


func _land_popover_overlaps_chat(rect: Rect2) -> bool:
	return _chat_panel != null and _chat_panel.visible and rect.intersects(_chat_panel.get_global_rect())


func _on_division_screen_position_updated(division_id: String, screen_position: Vector2) -> void:
	_division_screen_positions[division_id] = screen_position
	if division_id == _active_land_division_id:
		_position_land_selection_surround()


## Drops stale projection data as soon as a division leaves GameState.
## Parameters:
## - division_id: removed division whose cached anchor is no longer valid.
## Returns: nothing.
func _on_land_division_removed(division_id: String) -> void:
	_division_screen_positions.erase(division_id)
	if division_id == _active_land_division_id:
		_land_selection_surround.set_displayed(false)
		_position_land_selection_surround()


## Attaches the single-selection surround to the projected counter position.
func _position_land_selection_surround() -> void:
	if _land_selection_surround == null:
		return
	if _selected_land_division_ids.size() != 1 or _active_land_division_id.is_empty() \
			or not _selected_land_division_ids.has(_active_land_division_id):
		_land_selection_surround.set_displayed(false)
		return
	if _is_land_selection_surface_suspended():
		_land_selection_surround.set_displayed(false)
		return
	var division_data: Dictionary = GameState.get_division(_active_land_division_id)
	if division_data.is_empty():
		_land_selection_surround.set_displayed(false)
		return
	if division_data.get("combat_state", "idle") == "destroyed":
		_land_selection_surround.set_displayed(false)
		return
	var my_nation: String = GameState.get_my_nation_id()
	if not my_nation.is_empty() and division_data.get("nation_id", "") != my_nation:
		_land_selection_surround.set_displayed(false)
		return
	var anchor: Vector2 = _division_screen_positions.get(
		_active_land_division_id, Vector2(-1.0, -1.0)
	)
	var viewport_rect: Rect2 = get_viewport().get_visible_rect()
	var reserved_rects: Array[Rect2] = _get_land_surround_reserved_rects()
	var placement: Dictionary = _choose_land_selection_surround_placement(
		anchor,
		viewport_rect,
		reserved_rects
	)
	if placement.is_empty():
		_land_selection_surround.set_displayed(false)
		return
	_land_surround_placement = placement.get("placement", &"") as StringName
	_land_surround_tray_slide = float(placement.get("tray_slide", 0.0))
	_land_selection_surround.set_placement(
		_land_surround_placement,
		_land_surround_tray_slide
	)
	_land_selection_surround.set_anchor_position(anchor)
	_land_selection_surround.set_displayed(true)
	if _pending_land_selection_animation_id == _active_land_division_id:
		_pending_land_selection_animation_id = ""
		_land_selection_surround.play_selection_enter()


## Returns whether any managed panel currently suspends the map-attached surface.
## Parameters: none.
## Returns: true while HUDManager owns an open panel.
func _is_land_selection_surface_suspended() -> bool:
	return hud_manager != null and not hud_manager.get_open_panel().is_empty()


## Returns stable HUD rectangles that the map-attached surface must not cover.
## Parameters: none.
## Returns: visible top bar, dock, map-mode, and chat rectangles.
func _get_land_surround_reserved_rects() -> Array[Rect2]:
	var reserved_rects: Array[Rect2] = []
	for control: Control in [_top_bar, _left_dock_rail, _map_mode_tabs, _chat_panel]:
		if control != null and control.is_visible_in_tree():
			reserved_rects.append(control.get_global_rect())
	return reserved_rects


## Chooses a stable placement, retaining the current valid layout until a preferred one
## has enough clearance to avoid edge oscillation during camera interpolation.
## Parameters:
## - anchor: projected division-counter center.
## - viewport_rect: current visible viewport bounds.
## - reserved_rects: stable HUD rectangles to avoid.
## Returns: selected placement and slide, or an empty dictionary when none fits.
func _choose_land_selection_surround_placement(
		anchor: Vector2,
		viewport_rect: Rect2,
		reserved_rects: Array[Rect2]
) -> Dictionary:
	if not _land_surround_placement.is_empty():
		var current := {
			"placement": _land_surround_placement,
			"tray_slide": _land_surround_tray_slide,
		}
		if _land_surround_candidate_fits(
				anchor,
				viewport_rect,
				reserved_rects,
				current,
				0.0
		):
			var preferred: Dictionary = _find_land_selection_surround_placement(
				anchor,
				viewport_rect,
				reserved_rects,
				_LAND_SURROUND_PLACEMENT_HYSTERESIS
			)
			if not preferred.is_empty() and _land_surround_candidate_rank(preferred) \
					< _land_surround_candidate_rank(current):
				return preferred
			return current
	return _find_land_selection_surround_placement(anchor, viewport_rect, reserved_rects)


## Finds the first fitting orientation and minimum inward tray correction.
## Parameters:
## - anchor: projected division-counter center.
## - viewport_rect: current visible viewport bounds.
## - reserved_rects: stable HUD rectangles to avoid.
## - extra_clearance: additional viewport and obstacle clearance for hysteresis.
## Returns: first valid placement and slide, or an empty dictionary.
func _find_land_selection_surround_placement(
		anchor: Vector2,
		viewport_rect: Rect2,
		reserved_rects: Array[Rect2],
		extra_clearance: float = 0.0
) -> Dictionary:
	var max_slide: int = int(floor(_land_selection_surround.get_max_tray_slide()))
	for placement: StringName in _land_selection_surround.get_placements():
		for slide_step: int in range(max_slide + 1):
			var candidate := {
				"placement": placement,
				"tray_slide": float(slide_step),
			}
			if _land_surround_candidate_fits(
					anchor,
					viewport_rect,
					reserved_rects,
					candidate,
					extra_clearance
			):
				return candidate
	return {}


## Tests complete surface bounds against the viewport and stable HUD reservations.
## Parameters:
## - anchor: projected division-counter center.
## - viewport_rect: current visible viewport bounds.
## - reserved_rects: stable HUD rectangles to avoid.
## - candidate: placement and slide under evaluation.
## - extra_clearance: additional viewport and obstacle clearance.
## Returns: true when the complete animated surface fits.
func _land_surround_candidate_fits(
		anchor: Vector2,
		viewport_rect: Rect2,
		reserved_rects: Array[Rect2],
		candidate: Dictionary,
		extra_clearance: float
) -> bool:
	var viewport_margin: float = _LAND_SURROUND_VIEWPORT_MARGIN + extra_clearance
	var usable_rect: Rect2 = viewport_rect.grow(-viewport_margin)
	if usable_rect.size.x <= 0.0 or usable_rect.size.y <= 0.0 \
			or not usable_rect.has_point(anchor):
		return false
	var reserved_gap: float = _LAND_SURROUND_RESERVED_GAP + extra_clearance
	for reserved_rect: Rect2 in reserved_rects:
		if reserved_rect.grow(reserved_gap).has_point(anchor):
			return false
	var placement: StringName = candidate.get("placement", &"") as StringName
	var tray_slide: float = float(candidate.get("tray_slide", 0.0))
	var relative_bounds: Rect2 = _land_selection_surround.get_placement_bounds(
		placement,
		tray_slide
	)
	var surface_rect := Rect2(anchor + relative_bounds.position, relative_bounds.size)
	if not usable_rect.encloses(surface_rect):
		return false
	for reserved_rect: Rect2 in reserved_rects:
		if surface_rect.intersects(reserved_rect.grow(reserved_gap)):
			return false
	return true


## Produces a sortable fallback rank for stable-placement comparisons.
## Parameters:
## - candidate: placement and slide to rank.
## Returns: lower values for more preferred orientations and smaller slides.
func _land_surround_candidate_rank(candidate: Dictionary) -> float:
	var placement: StringName = candidate.get("placement", &"") as StringName
	var placements: Array[StringName] = _land_selection_surround.get_placements()
	var placement_index: int = placements.find(placement)
	if placement_index < 0:
		return INF
	return float(placement_index * 100) + float(candidate.get("tray_slide", 0.0))


## Positions the persistent chat panel at the lower-right viewport corner.
## Parameters: none.
## Returns: nothing.
func _position_chat_panel() -> void:
	if _chat_panel == null:
		return
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var chat_size: Vector2 = _chat_panel.get_combined_minimum_size()
	_chat_panel.size = chat_size
	_chat_panel.global_position = Vector2(
		maxf(_BOTTOM_PANEL_MARGIN, viewport_size.x - chat_size.x - _BOTTOM_PANEL_MARGIN),
		maxf(0.0, viewport_size.y - chat_size.y - _BOTTOM_PANEL_MARGIN)
	)


## Places notifications above the chat panel so they never cover chat controls.
## Parameters: none.
## Returns: nothing.
func _position_toast_container() -> void:
	if _toast_container == null:
		return
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var chat_rect: Rect2 = Rect2(
		Vector2(viewport_size.x - _BOTTOM_PANEL_MARGIN - _TOAST_WIDTH, viewport_size.y - _BOTTOM_PANEL_MARGIN),
		Vector2(_TOAST_WIDTH, 0.0)
	)
	if _chat_panel != null:
		chat_rect = _chat_panel.get_global_rect()
	var toast_width: float = minf(_TOAST_WIDTH, maxf(160.0, viewport_size.x - (_BOTTOM_PANEL_MARGIN * 2.0)))
	var toast_height: float = minf(_TOAST_HEIGHT, maxf(80.0, chat_rect.position.y - _TOAST_CHAT_GAP - _BOTTOM_PANEL_MARGIN))
	_toast_container.size = Vector2(toast_width, toast_height)
	_toast_container.global_position = Vector2(
		clampf(chat_rect.end.x - toast_width, _BOTTOM_PANEL_MARGIN, maxf(_BOTTOM_PANEL_MARGIN, viewport_size.x - toast_width - _BOTTOM_PANEL_MARGIN)),
		maxf(_BOTTOM_PANEL_MARGIN, chat_rect.position.y - toast_height - _TOAST_CHAT_GAP)
	)


## Places a bottom selection panel in the space left of chat when needed.
## Parameters: panel — Control node.
## Returns: nothing.
func _position_bottom_selection_panel(panel: Control) -> void:
	if panel == null:
		return
	var panel_height: float = maxf(panel.size.y, panel.get_combined_minimum_size().y)
	panel.size = Vector2.ZERO
	var natural_width: float = panel.get_combined_minimum_size().x
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size

	var chat_left: float = viewport_size.x - _BOTTOM_PANEL_MARGIN
	if _chat_panel != null:
		chat_left = _chat_panel.global_position.x
	var available_right: float = chat_left - _BOTTOM_PANEL_CHAT_GAP
	var available_left: float = _get_bottom_panel_available_left()
	var available_width: float = maxf(0.0, available_right - available_left)
	var panel_width: float = minf(natural_width, available_width)
	panel.size = Vector2(panel_width, panel_height)

	var available_center_x: float = (available_left + available_right) / 2.0
	var target_center_x: float = viewport_size.x / 2.0
	if target_center_x + (panel_width / 2.0) > available_right or target_center_x - (panel_width / 2.0) < available_left:
		target_center_x = available_center_x
	target_center_x = clampf(
		target_center_x,
		available_left + (panel_width / 2.0),
		maxf(available_left + (panel_width / 2.0), available_right - (panel_width / 2.0))
	)

	panel.global_position = Vector2(
		target_center_x - (panel_width / 2.0),
		maxf(0.0, viewport_size.y - panel_height - _BOTTOM_SELECTION_PANEL_BOTTOM_GAP)
	)


## Returns the left edge available to bottom selection panels.
## Parameters: none.
## Returns: viewport x coordinate after the left dock plus reserved gap.
func _get_bottom_panel_available_left() -> float:
	if _left_dock_rail != null:
		return maxf(_BOTTOM_PANEL_MARGIN, _left_dock_rail.get_global_rect().end.x + _BOTTOM_SELECTION_PANEL_DOCK_GAP)
	return _BOTTOM_PANEL_MARGIN


## Handles province selection — shows FriendlyProvincePanel in bottom bar.
func _on_province_selected(province_id: String) -> void:
	_hide_all_bottom_panels()
	if _is_side_panel_open():
		return

	# Try MapLoader first (has name, nation_id), fall back to GameState
	var map_data: Dictionary = {}
	if _map_loader != null:
		map_data = _map_loader.get_province_data(province_id)
	var game_data: Dictionary = GameState.provinces.get(province_id, {})

	# Build the data dict: MapLoader gives us name + nation_id (which is owner_id)
	# GameState may override with authoritative server state
	var owner_id: String = game_data.get("owner_id", map_data.get("nation_id", "?"))
	var prov_name: String = map_data.get("name", province_id)
	var nation_display: String = owner_id.to_upper() if owner_id != "?" else "?"

	var data: Dictionary = {
		"name": prov_name,
		"owner_id": owner_id,
		"nation_display": nation_display,
	}
	var live: Dictionary = GameState.provinces.get(province_id, {})
	for key in ["industry", "population", "infrastructure", "oil_bombed_until_ms"]:
		if live.has(key):
			data[key] = live[key]
	_friendly_prov_panel.populate(province_id, data)
	_friendly_prov_panel.visible = true
	_layout_bottom_hud()


## Hides all bottom selection panels — triggered by division_deselected signal.
func _on_bottom_bar_deselected() -> void:
	_hide_all_bottom_panels()


## Hides all four bottom bar panels. Called by selection handlers and deselect.
func _hide_all_bottom_panels() -> void:
	_friendly_prov_panel.visible = false
	_enemy_div_panel.visible = false
	_friendly_air_wing_panel.visible = false


## Reports whether any side-docked panel is currently open.
## Parameters: none.
## Returns: true when a side drawer is visible.
func _is_side_panel_open() -> bool:
	var open_panel_name: String = hud_manager.get_open_panel()
	if open_panel_name.is_empty() or not hud_manager._registry.has(open_panel_name):
		return false
	var entry: Dictionary = hud_manager._registry.get(open_panel_name, {})
	return entry.get("placement", -1) == HUDManager.PlacementMode.SIDE_DOCKED


## Called each tick to update session timer display.
func set_session_time(seconds: int) -> void:
	var h: int = seconds / 3600
	var m: int = (seconds % 3600) / 60
	var s: int = seconds % 60
	_last_displayed_session_seconds = seconds
	_session_timer.text = "%02d:%02d:%02d" % [h, m, s]
