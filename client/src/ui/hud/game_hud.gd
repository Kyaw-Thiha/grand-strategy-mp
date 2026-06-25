extends CanvasLayer
## Persistent in-game HUD: war-room frame + panel orchestrator.
## Owns the TopBar, LeftDockRail, anchor zones, and toast area.
## Panel behaviour (hotkeys, swap rules, Tab/Escape) wired in p5b.

# Explicit preload forces hud_manager.gd to compile before this script,
# ensuring HUDManager class_name is registered when type annotations are resolved.
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


func _ready() -> void:
	hud_manager.setup(_side_panel_anchor, _center_panel_anchor, overlay_dim)
	_btn_settings.pressed.connect(func() -> void: EventBus.settings_requested.emit())
	_btn_map_pol.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("political"))
	_btn_map_cov.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("cover"))
	_btn_map_ele.pressed.connect(func() -> void: EventBus.map_mode_changed.emit("elevation"))


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
