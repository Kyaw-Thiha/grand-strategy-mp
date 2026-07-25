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
var _buildings_val: Label
var _btn_upgrade: Button
var _btn_build_radar: Button
var _btn_manage_prod: Button
var _industry_val:       Label
var _population_val:     Label
var _infrastructure_val: Label
var _oil_status_label:   Label


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
	_btn_build_radar = get_node_or_null("Margin/HBox/ActionsBlock/BtnBuildRadar")
	_btn_manage_prod = get_node_or_null("Margin/HBox/ActionsBlock/BtnManageProd")
	_industry_val       = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/IndustryVal")
	_population_val     = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/PopulationVal")
	_infrastructure_val = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/InfrastructureVal")
	_oil_status_label   = get_node_or_null("Margin/HBox/StatsBlock/StatsGrid/OilStatus")


func populate(province_id: String, data: Dictionary) -> void:
	if _prov_name == null:
		push_warning("FriendlyProvincePanel: node refs not found — tscn may be broken")
		return

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
	if _btn_build_radar != null:
		_btn_build_radar.visible = is_friendly
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

	# Resources show placeholder dashes until Phase 9 economy data feeds in
	if _steel_val != null:
		_steel_val.text = "--"
	if _manpower_val != null:
		_manpower_val.text = "--"
	if _buildings_val != null:
		_buildings_val.text = "--"