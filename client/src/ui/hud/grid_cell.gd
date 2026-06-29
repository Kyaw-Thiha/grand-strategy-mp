extends PanelContainer

@onready var _glyph_cell: Control = $VBoxContainer/UnitGlyphCell
@onready var _hp_bar:     ColorRect = $VBoxContainer/BarsBox/HpBar
@onready var _supp_bar:   ColorRect = $VBoxContainer/BarsBox/SuppBar

const C_BG:       Color = Color(0.0, 0.0, 0.0, 0.0)  # transparent — dark theme + UnitGlyphCell
const C_SUPP:     Color = Color(0.25, 0.18, 0.05, 0.6)  # amber tint
const C_INCAP:    Color = Color(0.12, 0.10, 0.08, 0.7)  # darker/grey
const C_STEALTH:  Color = Color(0.05, 0.15, 0.10, 0.6)  # green tint
const C_HP_BAR:   Color = Color(0.35, 0.75, 0.40, 1.0)
const C_SUPP_BAR: Color = Color(0.85, 0.55, 0.10, 1.0)
const MAX_BAR_W:  float = 60.0


func _ready() -> void:
	_glyph_cell.custom_minimum_size = Vector2(72, 52)
	_glyph_cell.mouse_filter = MOUSE_FILTER_IGNORE


func display(cell_data: Dictionary) -> void:
	var utype:    String = cell_data.get("unit_type", "")
	var hp_pct:   float  = cell_data.get("hp", 100.0) / 100.0
	var supp_pct: float  = cell_data.get("suppression", 0.0) / 100.0
	var incap:    bool   = cell_data.get("incapacitated", false)
	var stealth:  bool   = cell_data.get("stealthed", false)

	_glyph_cell.set("unit_type", utype)

	# Background tint for special states — otherwise transparent (dark theme + UnitGlyphCell)
	var bg_color := C_BG
	if incap:           bg_color = C_INCAP
	elif stealth:       bg_color = C_STEALTH
	elif supp_pct > 0.5: bg_color = C_SUPP

	var style := StyleBoxFlat.new()
	style.bg_color = bg_color
	add_theme_stylebox_override("panel", style)

	_hp_bar.color = C_HP_BAR
	_hp_bar.custom_minimum_size.x = max(2.0, hp_pct * MAX_BAR_W)

	_supp_bar.color = C_SUPP_BAR
	_supp_bar.custom_minimum_size.x = max(0.0, supp_pct * MAX_BAR_W)
	_supp_bar.visible = supp_pct > 0.02
