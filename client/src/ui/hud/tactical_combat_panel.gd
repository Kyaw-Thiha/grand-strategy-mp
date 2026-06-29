extends PanelContainer

const GLYPH_SCENE := preload("res://scenes/game/panels/unit_glyph_cell.tscn")
const StatusBarsScript := preload("res://src/ui/hud/status_bars.gd")

@onready var _title_label:     Label         = $InnerMargin/VBoxContent/HeaderRow/TitleLabel
@onready var _round_label:      Label        = $InnerMargin/VBoxContent/HeaderRow/RoundLabel
@onready var _atk_name:        Label         = $InnerMargin/VBoxContent/SubtitleRow/AttackerNameLabel
@onready var _def_name:        Label         = $InnerMargin/VBoxContent/SubtitleRow/DefenderNameLabel
@onready var _terrain_banner:   Label        = $InnerMargin/VBoxContent/TerrainBanner
@onready var _atk_grid:        GridContainer = $InnerMargin/VBoxContent/GridRow/AttackerGridArea/AttackerGridBody/AttackerGrid
@onready var _def_grid:        GridContainer = $InnerMargin/VBoxContent/GridRow/DefenderGridArea/DefenderGridBody/DefenderGrid
@onready var _close_btn:       Button        = $InnerMargin/VBoxContent/HeaderRow/CloseButton
@onready var _retreat_btn:     Button        = $InnerMargin/VBoxContent/EscalationStrip/RetreatButton
@onready var _phase_label:     Label         = $InnerMargin/VBoxContent/EscalationStrip/PhaseLabel

var _glyph_cells: Array = []  # UnitGlyphCell[]
var _bar_controls: Array = []  # StatusBars[]
var _engagement_id: String = ""
var _current_round: int = 0


func _ready() -> void:
	hide()
	mouse_filter = MOUSE_FILTER_STOP

	_build_grid(_atk_grid)
	_build_grid(_def_grid)

	_close_btn.pressed.connect(func(): EventBus.tactical_combat_closed.emit())
	_retreat_btn.pressed.connect(_on_retreat_pressed)
	EventBus.tactical_combat_opened.connect(_on_opened)
	EventBus.tactical_combat_closed.connect(_on_closed)
	EventBus.round_resolved.connect(_on_round_resolved)

	$InnerMargin/VBoxContent/GridRow.add_theme_constant_override("separation", 8)


func setup_engagement(eng_id: String, atk_name: String, def_name: String) -> void:
	_engagement_id = eng_id
	_atk_name.text = atk_name
	_def_name.text = def_name


func _build_grid(grid: GridContainer) -> void:
	grid.columns = 5
	for _i in range(25):
		var container := VBoxContainer.new()
		container.add_theme_constant_override("separation", 0)

		var glyph := GLYPH_SCENE.instantiate() as Control
		glyph.set("unit_type", "")
		glyph.set("size_flags_horizontal", Control.SIZE_FILL | Control.SIZE_EXPAND)
		glyph.set("size_flags_vertical", Control.SIZE_FILL | Control.SIZE_EXPAND)
		container.add_child(glyph)
		_glyph_cells.append(glyph)

		var bars := StatusBarsScript.new() as Control
		bars.set("custom_minimum_size", Vector2(0, 10))
		bars.set("size_flags_horizontal", Control.SIZE_FILL | Control.SIZE_EXPAND)
		container.add_child(bars)
		_bar_controls.append(bars)

		grid.add_child(container)


func _update_cell(index: int, data: Dictionary) -> void:
	var glyph: UnitGlyphCell = _glyph_cells[index] as UnitGlyphCell
	var bars = _bar_controls[index]
	glyph.unit_type = data.get("unit_type", glyph.unit_type)
	glyph.incapacitated = data.get("incapacitated", false)
	bars.hp_pct = data.get("hp", 100.0) / 100.0
	bars.supp_pct = data.get("suppression", 0.0) / 100.0


func _on_retreat_pressed() -> void:
	var parts := _engagement_id.split("_vs_")
	if parts.size() < 2:
		return
	CommandQueue.submit("RETREAT", { "division_id": parts[0] })
	EventBus.tactical_combat_closed.emit()


func _on_opened(eng_id: String) -> void:
	_engagement_id = eng_id
	show()
	_refresh_from_game_state()

func _on_closed() -> void:
	hide()

func _on_round_resolved(eng_id: String, rn: int, lp: String,
						atk_delta: Array, def_delta: Array, _fb: Array) -> void:
	if not eng_id.begins_with(_engagement_id):
		return
	_current_round = rn
	var lethality_suffix := "  [LETHALITY]" if lp in ["intense", "decisive", "annihilation"] else ""
	_round_label.text = "Round %d%s" % [rn, lethality_suffix]
	_update_phase_label(lp)
	_apply_grid_deltas(_atk_grid, atk_delta)
	_apply_grid_deltas(_def_grid, def_delta)


func _update_phase_label(lp: String) -> void:
	var phase_names := {
		"contact": "Contact",
		"firefight": "Firefight",
		"intense": "Intense",
		"decisive": "Decisive",
		"annihilation": "Annihilation",
	}
	var dots := {
		"contact": "●○○○○",
		"firefight": "●●○○○",
		"intense": "●●●○○",
		"decisive": "●●●●○",
		"annihilation": "●●●●●",
	}
	var name: String = phase_names.get(lp, "Contact")
	var dot_str: String = dots.get(lp, "●○○○○")
	_phase_label.text = "Phase: %s %s" % [dot_str, name]


func _apply_grid_deltas(grid: GridContainer, deltas: Array) -> void:
	for delta in deltas:
		var idx: int = int(delta.get("cell_index", -1))
		if idx < 0 or idx >= 25:
			continue
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i:int = (4 - row) * 5 + col
		_update_cell(child_i, delta)


func _refresh_from_game_state() -> void:
	var parts := _engagement_id.split("_vs_")
	if parts.size() < 2:
		return
	var div_a_id := parts[0]
	var div_b_id := parts[1]

	var div_a: Dictionary = GameState.get_division(div_a_id)
	var div_b: Dictionary = GameState.get_division(div_b_id)
	if not div_a.is_empty():
		_atk_name.text = div_a_id
		_load_grid_from_division(_atk_grid, div_a)
	if div_b:
		_def_name.text = div_b_id
		_load_grid_from_division(_def_grid, div_b)


func _load_grid_from_division(grid: GridContainer, div_data: Dictionary) -> void:
	var cells: Array = div_data.get("grid", {}).get("cells", [])
	for idx in range(min(cells.size(), 25)):
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i:int = (4 - row) * 5 + col
		var cell_data   = cells[idx] if cells[idx] is Dictionary else {}
		_update_cell(child_i, cell_data)
