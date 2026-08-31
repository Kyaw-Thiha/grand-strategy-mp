extends PanelContainer
## Bottom selection bar panel — shows province info (resources, actions).

var _prov_name: Label
var _prov_meta: Label
var _stats_header: Label
var _steel_key: Label
var _steel_val: Label
var _manpower_key: Label
var _manpower_val: Label
var _buildings_key: Label
var _buildings_val: HBoxContainer
var _btn_upgrade: Button
var _btn_manage_prod: Button
var _industry_val:       Label
var _population_val:     Label
var _infrastructure_val: Label
var _oil_status_label:   Label

var _current_province_id: String = ""

# Short abbreviations for the compact on-map row — no per-building icon assets exist yet,
# so this uses text badges rather than icon textures.
const BUILDING_ABBREVIATIONS := {
	"fort": "FRT", "port": "PRT", "airbase": "AB", "supply_hub": "HUB", "factory": "FAC", "radar": "RAD",
	"barracks": "BRK", "tank_plant": "TNK", "ordnance_factory": "ORD", "aircraft_factory": "AIR",
	"school": "SCH", "hospital": "HOS", "warehouse": "WHS", "shipyard": "SHY", "town_hall": "TH",
	"res_grain": "GRN", "res_iron": "IRN", "res_oil": "OIL", "res_rubber": "RUB",
	"res_nitrates": "NIT", "res_tungsten": "TUN", "res_chromium": "CHR",
	"res_aluminium": "ALU", "res_uranium": "URA",
}


func _ready() -> void:
	_prov_name = get_node_or_null("Margin/HBox/IdentityBlock/ProvName")
	_prov_meta = get_node_or_null("Margin/HBox/IdentityBlock/ProvMeta")
	_stats_header = get_node_or_null("Margin/HBox/StatsBlock/StatsHeader")
	_steel_key = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/SteelKey")
	_steel_val = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/SteelVal")
	_manpower_key = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/ManpowerKey")
	_manpower_val = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/ManpowerVal")
	_buildings_key = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/BuildingsKey")
	_buildings_val = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/BuildingsVal")
	_btn_upgrade = get_node_or_null("Margin/HBox/ActionsBlock/BtnUpgrade")
	_btn_manage_prod = get_node_or_null("Margin/HBox/ActionsBlock/BtnManageProd")
	_industry_val       = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/IndustryVal")
	_population_val     = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/PopulationVal")
	_infrastructure_val = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/InfrastructureVal")
	_oil_status_label   = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/OilStatus")

	if _btn_upgrade != null:
		_btn_upgrade.pressed.connect(func() -> void:
			if not _current_province_id.is_empty():
				EventBus.province_detail_open_requested.emit(_current_province_id)
		)
	if _btn_manage_prod != null:
		_btn_manage_prod.pressed.connect(func() -> void:
			EventBus.production_panel_open_requested.emit()
		)
	EventBus.province_economy_updated.connect(_on_province_economy_updated)


func populate(province_id: String, data: Dictionary) -> void:
	if _prov_name == null:
		push_warning("FriendlyProvincePanel: node refs not found — tscn may be broken")
		return

	_current_province_id = province_id
	_prov_name.text = data.get("name", province_id)
	var nation_display: String = data.get("nation_display", "?")
	if _prov_meta != null:
		_prov_meta.text = "PROVINCE · %s" % nation_display

	# Hide action buttons for neutral/enemy provinces — only owner can manage
	var owner: String = data.get("owner_id", "?")
	var my_nation: String = GameState.get_my_nation_id()
	var is_friendly: bool = (owner == my_nation)
	if _btn_upgrade != null:
		_btn_upgrade.visible = is_friendly
	if _btn_manage_prod != null:
		_btn_manage_prod.visible = is_friendly

	# Bombing-affected scalars (live from Colyseus schema, 0–100)
	var industry: Variant   = data.get("industry",       null)
	var pop: Variant        = data.get("population",     null)
	var infra: Variant      = data.get("infrastructure", null)
	var oil_until: float    = float(data.get("oil_bombed_until_ms", 0))

	if industry != null and is_instance_valid(_industry_val):
		_industry_val.text = str(int(industry))
	if pop != null and is_instance_valid(_population_val):
		_population_val.text = str(int(pop))
	if infra != null and is_instance_valid(_infrastructure_val):
		_infrastructure_val.text = str(int(infra))

	var now_ms := Time.get_unix_time_from_system() * 1000.0
	var oil_disrupted := oil_until > 0.0 and now_ms < oil_until
	if is_instance_valid(_oil_status_label):
		_oil_status_label.text     = "OIL DISRUPTED" if oil_disrupted else ""
		_oil_status_label.modulate = Color(1.0, 0.4, 0.4) if oil_disrupted else Color.WHITE

	# Steel/Manpower stay placeholder dashes — real values need Branch B's resource
	# production and population/manpower mechanics, not yet implemented.
	if _steel_val != null:
		_steel_val.text = "--"
	if _manpower_val != null:
		_manpower_val.text = "--"
	_refresh_buildings_row()


func _on_province_economy_updated(province_id: String) -> void:
	# Empty province_id = bulk PROVINCE_ECONOMY_INIT update; refresh regardless of which
	# province triggered it, since we don't track which provinces were touched in a bulk update.
	if province_id.is_empty() or province_id == _current_province_id:
		_refresh_buildings_row()


func _refresh_buildings_row() -> void:
	if _buildings_val == null or _current_province_id.is_empty():
		return
	for child in _buildings_val.get_children():
		child.queue_free()

	var econ: Dictionary = GameState.province_economy.get(_current_province_id, {})
	var buildings: Dictionary = econ.get("buildings", {})
	var construction_queue: Array = econ.get("construction_queue", [])
	var under_construction: Dictionary = {}
	for project: Dictionary in construction_queue:
		under_construction[project.get("building_type", "")] = true

	for building_type: String in buildings:
		var level: int = int(buildings[building_type])
		if level < 1:
			continue
		var badge := Label.new()
		var abbrev: String = BUILDING_ABBREVIATIONS.get(building_type, building_type.left(3).to_upper())
		badge.text = "%s%d" % [abbrev, level]
		badge.add_theme_font_size_override("font_size", 10)
		if under_construction.get(building_type, false):
			badge.modulate = Color(0.96, 0.78, 0.38, 1.0)  # gold accent — currently upgrading
			badge.tooltip_text = "%s Lv%d (upgrading)" % [building_type.capitalize(), level]
		else:
			badge.tooltip_text = "%s Lv%d" % [building_type.capitalize(), level]
		_buildings_val.add_child(badge)