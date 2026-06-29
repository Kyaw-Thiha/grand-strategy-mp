extends PanelContainer

@onready var _unit_label: Label     = $VBoxContainer/UnitLabel
@onready var _hp_bar:     ColorRect = $VBoxContainer/BarsBox/HpBar
@onready var _supp_bar:   ColorRect = $VBoxContainer/BarsBox/SuppBar

const ABBREV: Dictionary = {
	"infantry": "IN", "commando": "CM", "recon_infantry": "RC", "sniper": "SN",
	"flamethrower": "FL", "mg": "MG", "at_gun": "AT", "at_gun_sp": "SP",
	"aa_gun": "AA", "artillery": "AR", "mortar": "MO",
	"light_tank": "LT", "medium_tank": "MT", "heavy_tank": "HT", "armoured_car": "AC",
}

const C_EMPTY:    Color = Color(0.88, 0.83, 0.76, 1.0)
const C_OCCUPY:   Color = Color(0.78, 0.73, 0.65, 1.0)
const C_SUPP_BG:  Color = Color(0.80, 0.72, 0.55, 1.0)
const C_INCAP:    Color = Color(0.68, 0.62, 0.58, 1.0)
const C_STEALTH:  Color = Color(0.55, 0.62, 0.55, 1.0)
const C_HP_BAR:   Color = Color(0.30, 0.65, 0.35, 1.0)
const C_SUPP_BAR: Color = Color(0.85, 0.55, 0.10, 1.0)
const C_BORDER:   Color = Color(0.45, 0.35, 0.22, 1.0)
const C_TEXT:     Color = Color(0.20, 0.14, 0.06, 1.0)
const MAX_BAR_W:  float = 60.0

func display(cell_data: Dictionary) -> void:
	var utype:    String = cell_data.get("unit_type", "")
	var hp_pct:   float  = cell_data.get("hp", 100.0) / 100.0
	var supp_pct: float  = cell_data.get("suppression", 0.0) / 100.0
	var incap:    bool   = cell_data.get("incapacitated", false)
	var stealth:  bool   = cell_data.get("stealthed", false)

	_unit_label.text = ABBREV.get(utype, utype.left(2).to_upper() if utype != "" else "")
	_unit_label.add_theme_color_override("font_color", C_TEXT)

	var bg_color: Color
	if utype == "":       bg_color = C_EMPTY
	elif incap:           bg_color = C_INCAP
	elif stealth:         bg_color = C_STEALTH
	elif supp_pct > 0.5:  bg_color = C_SUPP_BG
	else:                 bg_color = C_OCCUPY

	var style := StyleBoxFlat.new()
	style.bg_color = bg_color
	style.set_border_width_all(1)
	style.border_color = C_BORDER
	add_theme_stylebox_override("panel", style)

	_hp_bar.color = C_HP_BAR
	_hp_bar.custom_minimum_size.x = max(2.0, hp_pct * MAX_BAR_W)

	_supp_bar.color = C_SUPP_BAR
	_supp_bar.custom_minimum_size.x = max(0.0, supp_pct * MAX_BAR_W)
	_supp_bar.visible = supp_pct > 0.02
