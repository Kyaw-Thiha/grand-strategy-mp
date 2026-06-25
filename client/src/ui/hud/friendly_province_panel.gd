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

	# Resources show placeholder dashes until Phase 9 economy data feeds in
	if _steel_val != null:
		_steel_val.text = "--"
	if _manpower_val != null:
		_manpower_val.text = "--"
	if _buildings_val != null:
		_buildings_val.text = "--"