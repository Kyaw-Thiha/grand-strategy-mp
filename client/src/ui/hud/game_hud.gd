class_name GameHUD
extends CanvasLayer
## Persistent in-game HUD: war-room frame + panel orchestrator.
## Owns the TopBar, LeftDockRail, anchor zones, and toast area.
## Panel behaviour (hotkeys, swap rules, Tab/Escape) wired in p5b.

const _HUDManagerClass = preload("res://src/ui/hud/hud_manager.gd")

@onready var hud_manager: _HUDManagerClass = $HUDManager
@onready var overlay_dim: ColorRect = %OverlayDim

@onready var _side_panel_anchor: MarginContainer  = %SidePanelAnchor
@onready var _center_panel_anchor: Control = %CenterPanelAnchor
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
@onready var _dock_btn_u: Button = $HUDRoot/LeftDockRail/VBox/DockButton_U
@onready var _research_progress_fill: ColorRect = $HUDRoot/LeftDockRail/VBox/DockButton_Q/ResearchProgressFill

@onready var _military_panel: Control = $MilitaryPanel
@onready var _economy_panel: Control = $EconomyPanel
@onready var _diplomacy_panel: Control = $DiplomacyPanel
@onready var _research_panel: Control = $ResearchPanel
@onready var _research_tree_panel: Control = $ResearchTreePanel

@onready var _friendly_div_panel: Control = $FriendlyDivisionPanel
@onready var _friendly_prov_panel: Control = $FriendlyProvincePanel
@onready var _friendly_stack_panel: Control = $FriendlyStackPanel
@onready var _enemy_div_panel: Control = $EnemyDivisionPanel
@onready var _chat_panel: Control = $ChatPanel

var _division_builder_panel: Control
var _division_template_viewer_panel: Control

const _DOCK_BUTTON_STYLE_NORMAL := preload("res://assets/themes/hud_dark.tres")
const _DivisionBuilderScene := preload("res://scenes/game/panels/division_builder_panel.tscn")
const _DivisionTemplateViewerScene := preload("res://scenes/game/panels/division_template_viewer_panel.tscn")
var _active_dock_btn: Button = null
var _map_loader: Node = null
var _military_system: Node = null
var _map_interaction: Node = null
var _map_renderer: Node = null

const _BOTTOM_PANEL_CHAT_GAP: float = 12.0
const _BOTTOM_PANEL_MARGIN: float = 16.0


func _ready() -> void:
	# MapLoader is a sibling of GameHUD in the MapDebug scene tree
	_map_loader = get_node_or_null("/root/MapDebug/MapLoader")
	_military_system = get_node_or_null("/root/MapDebug/MilitarySystem")
	_map_interaction = get_node_or_null("/root/MapDebug/MapInteraction")
	_map_renderer = get_node_or_null("/root/MapDebug/MapRenderer")
	hud_manager.setup(_side_panel_anchor, _center_panel_anchor, overlay_dim)
	_btn_settings.pressed.connect(func() -> void: EventBus.settings_requested.emit())
	_btn_map_pol.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("political"))
	_btn_map_cov.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("cover"))
	_btn_map_ele.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("elevation"))

	# Click outside center panel = close
	overlay_dim.gui_input.connect(_on_overlay_clicked)

	# Wire dock buttons to panel toggles
	_dock_btn_q.pressed.connect(_make_dock_toggle("research"))
	_dock_btn_e.pressed.connect(_make_dock_toggle("economy"))
	_dock_btn_t.pressed.connect(_make_dock_toggle("military"))
	_dock_btn_y.pressed.connect(_make_dock_toggle("diplomacy"))
	_connect_side_drawer_close("research", _research_panel)
	_connect_side_drawer_close("economy", _economy_panel)
	_connect_side_drawer_close("military", _military_panel)
	_connect_side_drawer_close("diplomacy", _diplomacy_panel)
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

	# Division Builder — full-center, opened from military panel template list
	_division_builder_panel = _DivisionBuilderScene.instantiate()
	add_child(_division_builder_panel)
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

	# Division Template Viewer — full-center, opened from mini-comp grid click
	_division_template_viewer_panel = _DivisionTemplateViewerScene.instantiate()
	add_child(_division_template_viewer_panel)
	hud_manager.register_panel("division_template_viewer", _division_template_viewer_panel,
		HUDManager.PlacementMode.FULL_CENTER
	)
	EventBus.division_template_viewer_open_requested.connect(func(div_id: String) -> void:
		if _military_system != null and _military_system.has_method("deselect"):
			_military_system.deselect()
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

	hud_manager.set_panel_shortcut("economy",   KEY_E)
	hud_manager.set_panel_shortcut("military",  KEY_R)
	hud_manager.set_panel_shortcut("diplomacy", KEY_T)
	hud_manager.set_panel_shortcut("research",  KEY_Q)

	# Bottom selection bar — reactive to EventBus selection signals
	EventBus.division_selected.connect(_on_division_selected)
	EventBus.province_selected.connect(_on_province_selected)
	EventBus.division_deselected.connect(_on_bottom_bar_deselected)
	EventBus.province_deselected.connect(_on_bottom_bar_deselected)
	EventBus.research_started.connect(_on_research_started)
	EventBus.research_progress_changed.connect(_on_research_progress_changed)
	EventBus.research_completed.connect(_on_research_completed)
	_set_research_progress_fill(0.0)

	# Center bottom panels horizontally and on resize
	get_viewport().size_changed.connect(_on_viewport_size_changed)
	if _chat_panel.has_signal("layout_changed"):
		_chat_panel.connect("layout_changed", _on_chat_panel_layout_changed)
	_layout_bottom_hud()


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


func _on_panel_closed(panel_name: String) -> void:
	if hud_manager.get_open_panel() == "":
		_set_dock_button_active(null)


func _get_dock_button_for_panel(panel_name: String) -> Button:
	match panel_name:
		"economy":   return _dock_btn_e
		"military":  return _dock_btn_t
		"diplomacy": return _dock_btn_y
		"research":  return _dock_btn_q
		"research_tree": return _dock_btn_q
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
		get_viewport().set_input_as_handled()


## Called by game session to update the persistent nation display.
func set_nation(nation_name: String, flag_texture: Texture2D) -> void:
	_nation_label.text = nation_name
	_flag_texture.texture = flag_texture


## ── Bottom selection bar ───────────────────────────────────────────────────

## Handles division selection — shows FriendlyDivisionPanel for own divisions,
## EnemyDivisionPanel for enemy divisions. Hides other bottom panels.
func _on_division_selected(div_id: String) -> void:
	var data: Dictionary = GameState.get_division(div_id)
	if data.is_empty():
		return
	_hide_all_bottom_panels()
	var my_nation: String = GameState.get_my_nation_id()
	if data.get("nation_id", "") == my_nation:
		_friendly_div_panel.populate(div_id, data)
		_friendly_div_panel.visible = true
	else:
		_enemy_div_panel.populate(div_id, data)
		_enemy_div_panel.visible = true
	_layout_bottom_hud()


## Recenter all bottom panels when the viewport is resized.
func _on_viewport_size_changed() -> void:
	_layout_bottom_hud()


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
	for panel: Control in [_friendly_div_panel, _friendly_prov_panel, _friendly_stack_panel, _enemy_div_panel]:
		_position_bottom_selection_panel(panel)


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


## Places a bottom selection panel in the space left of chat when needed.
## Parameters: panel — Control node.
## Returns: nothing.
func _position_bottom_selection_panel(panel: Control) -> void:
	if panel == null:
		return
	var panel_height: float = panel.size.y
	panel.size = Vector2.ZERO
	var natural_width: float = panel.get_combined_minimum_size().x
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	panel.size = Vector2(natural_width, panel_height)

	var chat_left: float = viewport_size.x - _BOTTOM_PANEL_MARGIN
	if _chat_panel != null:
		chat_left = _chat_panel.global_position.x
	var available_right: float = chat_left - _BOTTOM_PANEL_CHAT_GAP
	var available_left: float = _BOTTOM_PANEL_MARGIN
	var available_center_x: float = (available_left + available_right) / 2.0
	var target_center_x: float = viewport_size.x / 2.0
	var chat_width: float = _chat_panel.get_combined_minimum_size().x if _chat_panel != null else 0.0
	if natural_width + _BOTTOM_PANEL_CHAT_GAP + chat_width + (_BOTTOM_PANEL_MARGIN * 2.0) > viewport_size.x:
		target_center_x = available_center_x
	target_center_x = clampf(
		target_center_x,
		available_left + (natural_width / 2.0),
		maxf(available_left + (natural_width / 2.0), available_right - (natural_width / 2.0))
	)

	var current_pos: Vector2 = panel.global_position
	var panel_center_x: float = current_pos.x + (natural_width / 2.0)
	var delta_x: float = target_center_x - panel_center_x

	panel.global_position = Vector2(current_pos.x + delta_x, current_pos.y)


## Handles province selection — shows FriendlyProvincePanel in bottom bar.
func _on_province_selected(province_id: String) -> void:
	_hide_all_bottom_panels()

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
	_friendly_prov_panel.populate(province_id, data)
	_friendly_prov_panel.visible = true
	_layout_bottom_hud()


## Hides all bottom selection panels — triggered by division_deselected signal.
func _on_bottom_bar_deselected() -> void:
	_hide_all_bottom_panels()


## Hides all four bottom bar panels. Called by selection handlers and deselect.
func _hide_all_bottom_panels() -> void:
	_friendly_div_panel.visible = false
	_friendly_prov_panel.visible = false
	_friendly_stack_panel.visible = false
	_enemy_div_panel.visible = false


## Called each tick to update session timer display.
func set_session_time(seconds: int) -> void:
	var h := seconds / 3600
	var m := (seconds % 3600) / 60
	var s := seconds % 60
	_session_timer.text = "SESSION %02d:%02d:%02d" % [h, m, s]
