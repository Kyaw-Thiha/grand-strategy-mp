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
var _attacker_cell_data: Array = []  # 25 cell dicts
var _defender_cell_data: Array = []  # 25 cell dicts
var _engagement_id: String = ""
var _current_round: int = 0
var _hovered_visual_idx: int = -1


func _ready() -> void:
	hide()
	mouse_filter = MOUSE_FILTER_STOP

	_build_grid(_atk_grid, 0)
	_build_grid(_def_grid, 25)

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


func _build_grid(grid: GridContainer, grid_offset: int = 0) -> void:
	grid.columns = 5
	for i in range(25):
		var visual_idx := grid_offset + i
		var container := VBoxContainer.new()
		container.add_theme_constant_override("separation", 0)

		var glyph := GLYPH_SCENE.instantiate() as Control
		glyph.set("unit_type", "")
		glyph.set("size_flags_horizontal", Control.SIZE_FILL | Control.SIZE_EXPAND)
		glyph.set("size_flags_vertical", Control.SIZE_FILL | Control.SIZE_EXPAND)
		glyph.mouse_entered.connect(_on_cell_hovered.bind(visual_idx, true))
		glyph.mouse_exited.connect(_on_cell_hovered.bind(visual_idx, false))
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
	_apply_grid_deltas(_atk_grid, atk_delta, 0)
	_apply_grid_deltas(_def_grid, def_delta, 25)


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


func _apply_grid_deltas(grid: GridContainer, deltas: Array, cell_offset: int = 0) -> void:
	for delta in deltas:
		var idx: int = int(delta.get("cell_index", -1))
		if idx < 0 or idx >= 25:
			continue
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i:int = (4 - row) * 5 + col + cell_offset
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
		_attacker_cell_data = div_a.get("grid", {}).get("cells", [])
		_load_grid_from_division(_atk_grid, div_a, 0)
	if not div_b.is_empty():
		_def_name.text = div_b_id
		_defender_cell_data = div_b.get("grid", {}).get("cells", [])
		_load_grid_from_division(_def_grid, div_b, 25)


func _load_grid_from_division(grid: GridContainer, div_data: Dictionary, cell_offset: int = 0) -> void:
	var cells: Array = div_data.get("grid", {}).get("cells", [])
	for idx in range(min(cells.size(), 25)):
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i:int = (4 - row) * 5 + col + cell_offset
		var cell_data   = cells[idx] if cells[idx] is Dictionary else {}
		_update_cell(child_i, cell_data)


# ── Hover attack preview ─────────────────────────────────────────────

func _on_cell_hovered(visual_idx: int, is_hovering: bool) -> void:
	if not is_hovering:
		_clear_target_highlights()
		_hovered_visual_idx = -1
		return
	_hovered_visual_idx = visual_idx
	_show_target_preview(visual_idx)

func _show_target_preview(visual_idx: int) -> void:
	if visual_idx < 25:
		var logical_idx := _visual_to_logical(visual_idx)
		var result: Dictionary = AttackPatternRegistry.simulate_round(
			_attacker_cell_data, _defender_cell_data, _current_round
		)
		var targets: Array = result.get(logical_idx, []) as Array
		_highlight_targets(targets, 25)
	else:
		var def_logical := _visual_to_logical(visual_idx - 25)
		var result: Dictionary = AttackPatternRegistry.simulate_round(
			_attacker_cell_data, _defender_cell_data, _current_round
		)
		var attackers: Array = []
		for atk_idx_str: String in result:
			var atk_idx: int = int(atk_idx_str)
			var tgt_arr: Array = result[atk_idx_str] as Array
			if def_logical in tgt_arr:
				attackers.append(atk_idx)
		_highlight_targets(attackers, 0)

func _highlight_targets(targets: Array, offset: int) -> void:
	for logical_idx in targets:
		var visual_idx: int = _logical_to_visual(int(logical_idx)) + offset
		if visual_idx < _glyph_cells.size():
			var cell = _glyph_cells[visual_idx] as UnitGlyphCell
			if cell != null:
				cell.set("is_targeted", true)

func _clear_target_highlights() -> void:
	for cell in _glyph_cells:
		var glyph: UnitGlyphCell = cell as UnitGlyphCell
		if glyph != null:
			glyph.set("is_targeted", false)

func _visual_to_logical(visual_child_index: int) -> int:
	var row := visual_child_index / 5
	var col := visual_child_index % 5
	return (4 - row) * 5 + col

func _logical_to_visual(logical_index: int) -> int:
	var row := logical_index / 5
	var col := logical_index % 5
	return (4 - row) * 5 + col
