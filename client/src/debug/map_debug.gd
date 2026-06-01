extends Node
## Standalone debug scene — wires MapLoader, MapRenderer, MapInteraction,
## and CameraSystem without any auth, server, or SessionManager dependency.
## Launch by setting scenes/debug/map_debug.tscn as main scene, or via
## Scene → Run Specific Scene in the Godot editor.

const MAP_ID := "western_europe_6"

@onready var _map_loader: Node      = $MapLoader
@onready var _map_renderer: Node    = $MapRenderer
@onready var _map_interaction: Node = $MapInteraction
@onready var _camera_system: Node   = $CameraSystem
@onready var _camera: Camera2D      = $Camera2D

@onready var _hud_name:   Label = $HUD/Panel/VBox/ProvinceName
@onready var _hud_nation: Label = $HUD/Panel/VBox/NationId
@onready var _hud_elev:   Label = $HUD/Panel/VBox/Elevation
@onready var _hud_cover:  Label = $HUD/Panel/VBox/Cover
@onready var _hud_vp:     Label = $HUD/Panel/VBox/VP
@onready var _hud_count:  Label = $HUD/Panel/VBox/ProvinceCount


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.20, 0.50, 0.80))
	_camera_system.setup(_camera, _map_loader)
	_map_loader.map_loaded.connect(_on_map_loaded)
	_map_loader.map_load_failed.connect(_on_map_load_failed)
	_map_loader.load_map(MAP_ID)


func _on_map_loaded(province_count: int) -> void:
	_map_renderer.setup(_map_loader, _DebugDataSource.new(_map_loader))
	_map_renderer.on_map_loaded(province_count)

	_map_interaction.setup(_map_loader)
	_map_interaction.on_map_loaded(province_count)
	_map_interaction.province_hovered.connect(_on_province_hovered)
	_map_interaction.province_clicked.connect(_on_province_clicked)

	_hud_count.text = "Provinces: %d" % province_count
	_clear_info_panel()

	$HUD/Panel/VBox/OverlayButtons/BtnPolitical.pressed.connect(_on_overlay_political)
	$HUD/Panel/VBox/OverlayButtons/BtnElevation.pressed.connect(_on_overlay_elevation)
	$HUD/Panel/VBox/OverlayButtons/BtnCover.pressed.connect(_on_overlay_cover)


func _on_map_load_failed(error: String) -> void:
	push_error("MapDebug: map load failed — %s" % error)


func _on_province_hovered(province_id: String) -> void:
	var pdata: Dictionary = _map_loader.get_province_data(province_id)
	_hud_name.text   = pdata.get("name", "")
	_hud_nation.text = "Nation: %s" % pdata.get("nation_id", "")
	_hud_elev.text   = "Elevation: %s" % pdata.get("terrain_elevation", "")
	_hud_cover.text  = "Cover: %s" % pdata.get("terrain_cover", "")
	var vp: int      = pdata.get("vp_value", 0)
	_hud_vp.text     = "VP: %d" % vp


func _on_province_clicked(province_id: String) -> void:
	if _map_renderer.is_highlighted(province_id):
		_map_renderer.clear_highlights()
	else:
		_map_renderer.clear_highlights()
		_map_renderer.highlight_province(province_id)


func _on_overlay_political() -> void:
	_map_renderer.set_overlay_mode("political")


func _on_overlay_elevation() -> void:
	_map_renderer.set_overlay_mode("elevation")


func _on_overlay_cover() -> void:
	_map_renderer.set_overlay_mode("cover")


func _clear_info_panel() -> void:
	_hud_name.text   = "Hover a province"
	_hud_nation.text = ""
	_hud_elev.text   = ""
	_hud_cover.text  = ""
	_hud_vp.text     = ""


# ── thin data source wrapper ──────────────────────────────────────────────────

class _DebugDataSource:
	var _loader: Node

	func _init(loader: Node) -> void:
		_loader = loader

	func get_province(province_id: String) -> Dictionary:
		return _loader.get_province_data(province_id)
