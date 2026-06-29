extends PanelContainer

const GLYPH_SCENE := preload("res://scenes/game/panels/unit_glyph_cell.tscn")
const StatusBarsScript := preload("res://src/ui/hud/status_bars.gd")
const PHASE_ORDER: Array = ["contact", "firefight", "intense", "decisive", "annihilation"]
const PHASE_COLORS: Dictionary = {
	"contact": Color(0.47, 0.53, 0.43), "firefight": Color(0.72, 0.57, 0.17),
	"intense": Color(0.80, 0.40, 0.10), "decisive": Color(0.60, 0.25, 0.10),
	"annihilation": Color(0.55, 0.10, 0.10),
}
const ROW_PERKS: Array = [
	["VANGUARD", "+supp dealt"], ["ASSAULT", "+HP dmg"], ["SUPPORT", "+supp res"],
	["RESERVE", "+recovery"], ["REAR", "+range/cmd"],
]
const NATION_COLORS: Dictionary = {
	"germany": Color(0.29, 0.29, 0.29), "france": Color(0.0, 0.14, 0.58),
	"united_kingdom": Color(0.0, 0.07, 0.41), "italy": Color(0.0, 0.57, 0.27),
	"spain": Color(0.78, 0.04, 0.12), "algeria": Color(0.0, 0.38, 0.20),
}

@onready var _title_label:     Label         = $InnerMargin/VBoxContent/HeaderRow/TitleLabel
@onready var _round_label:      Label        = $InnerMargin/VBoxContent/HeaderRow/RoundLabel
@onready var _atk_name:        Label         = $InnerMargin/VBoxContent/SubtitleRow/AttackerNameLabel
@onready var _def_name:        Label         = $InnerMargin/VBoxContent/SubtitleRow/DefenderNameLabel
@onready var _terrain_banner:   Label        = $InnerMargin/VBoxContent/TerrainMargin/TerrainFlankRow/TerrainBanner
@onready var _atk_grid:        GridContainer = $InnerMargin/VBoxContent/GridRow/AttackerGridArea/CenterContainer/CenterVBox/AttackerGrid
@onready var _def_grid:        GridContainer = $InnerMargin/VBoxContent/GridRow/DefenderGridArea/CenterContainer/CenterVBox/DefenderGrid
@onready var _close_btn:       Button        = $InnerMargin/VBoxContent/HeaderRow/CloseButton
@onready var _retreat_btn:     Button        = $InnerMargin/VBoxContent/EscalationStrip/RetreatButton
@onready var _phase_label:     Label         = $InnerMargin/VBoxContent/EscalationStrip/PhaseLabel

var _glyph_cells: Array = []  # UnitGlyphCell[]
var _bar_controls: Array = []  # StatusBars[]
var _attacker_cell_data: Array = []  # 25 cell dicts
var _defender_cell_data: Array = []  # 25 cell dicts
var _engagement_id: String = ""
var _current_round: int = 0
var _flank_chip: Label = null
var _nation_left: ColorRect = null
var _nation_right: ColorRect = null
var _context_label: Label = null
var _phase_pills: Array = []
var _active_phase: String = "contact"
var _timer_remaining: float = 0.0
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
	_add_subtitle_extras()
	_add_context_banner()
	_add_perk_labels()
	_build_phase_pills()
	_phase_label.visible = false
	_flank_chip = $InnerMargin/VBoxContent/TerrainMargin/TerrainFlankRow/FlankChip
	EventBus.flank_attack.connect(func(_a: String, _d: String) -> void:
		if _engagement_id.is_empty(): return
		_flank_chip.text = "FLANK"; _flank_chip.visible = true)
	EventBus.rear_attack.connect(func(_a: String, _d: String) -> void:
		if _engagement_id.is_empty(): return
		_flank_chip.text = "REAR ATTACK"; _flank_chip.visible = true)
	EventBus.combat_resolved.connect(func(_pid: String, _outcome: Dictionary) -> void:
		_flank_chip.visible = false)


func _process(delta: float) -> void:
	if _timer_remaining > 0:
		_timer_remaining -= delta
		if _timer_remaining < 0:
			_timer_remaining = 0
		var secs: int = int(_timer_remaining)
		_round_label.text = "Round %d  ⏱ %d:%02d" % [_current_round, secs / 60, secs % 60]


func setup_engagement(eng_id: String, atk_name: String, def_name: String) -> void:
	_engagement_id = eng_id
	_atk_name.text = atk_name
	_def_name.text = def_name


func _add_subtitle_extras() -> void:
	var row: HBoxContainer = $InnerMargin/VBoxContent/SubtitleRow
	_nation_left = ColorRect.new()
	_nation_left.name = "NationSquareLeft"
	_nation_left.custom_minimum_size = Vector2(10, 10)
	_nation_left.color = Color(0.4, 0.4, 0.4)
	row.add_child(_nation_left)
	row.move_child(_nation_left, 0)
	# Flank chip is now in TerrainFlankRow (TerrainMargin), not in SubtitleRow
	_nation_right = ColorRect.new()
	_nation_right.name = "NationSquareRight"
	_nation_right.custom_minimum_size = Vector2(10, 10)
	_nation_right.color = Color(0.4, 0.4, 0.4)
	row.add_child(_nation_right)


func _add_context_banner() -> void:
	var content: VBoxContainer = $InnerMargin/VBoxContent
	var banner := PanelContainer.new()
	banner.name = "ContextBanner"
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.12, 0.10, 0.07, 0.9)
	s.border_color = Color(0.45, 0.35, 0.22, 1.0)
	s.set_border_width_all(1)
	s.content_margin_left = 10
	s.content_margin_top = 8
	s.content_margin_right = 10
	s.content_margin_bottom = 8
	banner.add_theme_stylebox_override("panel", s)
	var inner := HBoxContainer.new()
	var tag := Label.new()
	tag.text = "ENGAGEMENT"
	tag.add_theme_font_size_override("font_size", 8)
	tag.add_theme_color_override("font_color", Color(0.20, 0.55, 0.60))
	inner.add_child(tag)
	_context_label = Label.new()
	_context_label.name = "ContextLabel"
	_context_label.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_context_label.add_theme_font_size_override("font_size", 13)
	inner.add_child(_context_label)
	banner.add_child(inner)
	content.add_child(banner)
	var sub_idx: int = content.get_node("SubtitleRow").get_index()
	content.move_child(banner, sub_idx + 1)


func _add_perk_labels() -> void:
	var grid_row: HBoxContainer = $InnerMargin/VBoxContent/GridRow
	var col := VBoxContainer.new()
	col.name = "PerkLabels"
	col.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	grid_row.add_child(col)
	grid_row.move_child(col, 0)
	for entry in ROW_PERKS:
		var box := VBoxContainer.new()
		box.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
		box.custom_minimum_size = Vector2(56, 0)
		col.add_child(box)
		var name_lbl := Label.new()
		name_lbl.text = entry[0]
		name_lbl.add_theme_font_size_override("font_size", 8)
		box.add_child(name_lbl)
		var perk_lbl := Label.new()
		perk_lbl.text = entry[1]
		perk_lbl.add_theme_font_size_override("font_size", 7)
		perk_lbl.add_theme_color_override("font_color", Color(0.45, 0.35, 0.22))
		box.add_child(perk_lbl)


func _apply_formation_bonuses(bonuses: Array) -> void:
	var banner: Label = $InnerMargin/VBoxContent/FormationBonusBar
	if bonuses.is_empty():
		banner.visible = false
		return
	var text_parts: Array = []
	for b in bonuses:
		var bt: String = b.get("bonus_type", "")
		match bt:
			"at_mg": text_parts.append("AT+MG")
			"sniper_recon": text_parts.append("Sniper+Recon")
			"flm_assault": text_parts.append("FLM+Assault")
			"mg_mg": text_parts.append("MG+MG")
			"arty_recon": text_parts.append("Artillery+Recon")
	banner.text = "Formation bonuses: " + ", ".join(text_parts)
	banner.visible = true


func _build_phase_pills() -> void:
	var strip: HBoxContainer = $InnerMargin/VBoxContent/EscalationStrip
	var box := HBoxContainer.new()
	box.name = "PhasePills"
	box.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	box.add_theme_constant_override("separation", 4)
	strip.add_child(box)
	strip.move_child(box, 0)
	for p in PHASE_ORDER:
		var pill := Label.new()
		pill.text = p
		pill.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		pill.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		pill.add_theme_font_size_override("font_size", 13)
		box.add_child(pill)
		_phase_pills.append(pill)
	_refresh_pills()


func _refresh_pills() -> void:
	var active_idx := PHASE_ORDER.find(_active_phase)
	for i in range(_phase_pills.size()):
		var pill: Label = _phase_pills[i]
		var col: Color = PHASE_COLORS.get(PHASE_ORDER[i], Color.WHITE)
		if i == active_idx:
			pill.text = "· %s ·" % PHASE_ORDER[i].to_upper()
			col.a = 1.0
		else:
			pill.text = PHASE_ORDER[i]
			col.a = 0.4
		pill.add_theme_color_override("font_color", col)


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
		bars.set("visible", false)
		container.add_child(bars)
		_bar_controls.append(bars)

		grid.add_child(container)


func _update_cell(index: int, data: Dictionary) -> void:
	var glyph: UnitGlyphCell = _glyph_cells[index] as UnitGlyphCell
	var bars = _bar_controls[index]
	var utype: String = data.get("unit_type", "")
	glyph.unit_type = utype
	glyph.incapacitated = data.get("incapacitated", false)
	glyph.set("xp_tier", data.get("xp_tier", "green"))
	glyph.set("stealthed", data.get("stealthed", false))
	bars.set("visible", utype != "")
	bars.hp_pct = 0.0 if data.get("incapacitated", false) else (data.get("hp", 100.0) / 100.0)
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
						atk_delta: Array, def_delta: Array, _fb: Array, tur: int) -> void:
	if not eng_id.begins_with(_engagement_id):
		return
	_current_round = rn
	_timer_remaining = float(tur)
	_update_phase_label(lp)
	_apply_grid_deltas(_atk_grid, atk_delta, 0, 1)
	_apply_grid_deltas(_def_grid, def_delta, 25, 2)
	_apply_deltas_to_data(_attacker_cell_data, atk_delta)
	_apply_deltas_to_data(_defender_cell_data, def_delta)
	_apply_formation_bonuses(_fb)


func _update_phase_label(lp: String) -> void:
	_active_phase = lp if lp in PHASE_ORDER else "contact"
	_refresh_pills()


func _apply_grid_deltas(grid: GridContainer, deltas: Array, cell_offset: int = 0, rotation: int = 0) -> void:
	for delta in deltas:
		var idx: int = int(delta.get("cell_index", -1))
		if idx < 0 or idx >= 25:
			continue
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i: int
		if rotation == 1:    # 90° CCW — attacker
			child_i = (4 - col) * 5 + row + cell_offset
		elif rotation == 2:  # 90° CW — defender
			child_i = col * 5 + (4 - row) + cell_offset
		else:
			child_i = (4 - row) * 5 + col + cell_offset
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
		_load_grid_from_division(_atk_grid, div_a, 0, 1)
		_nation_left.color = NATION_COLORS.get(div_a.get("nation_id", ""), Color(0.4, 0.4, 0.4))
		var is_meeting: bool = div_a.get("attacker_role", "") == "meeting"
		var atk_role: String = div_a.get("attacker_role", "")
		if is_meeting:
			_context_label.text = "Meeting battle: no terrain bonuses"
		elif atk_role == "attacker":
			_context_label.text = "Attacking: defender terrain bonuses active"
		elif atk_role == "defender":
			_context_label.text = "Defending: your terrain bonuses active"
		else:
			_context_label.text = ""
	if not div_b.is_empty():
		_def_name.text = div_b_id
		_defender_cell_data = div_b.get("grid", {}).get("cells", [])
		_load_grid_from_division(_def_grid, div_b, 25, 2)
		_nation_right.color = NATION_COLORS.get(div_b.get("nation_id", ""), Color(0.4, 0.4, 0.4))
	$InnerMargin/VBoxContent/FormationBonusBar.visible = false


func _load_grid_from_division(grid: GridContainer, div_data: Dictionary, cell_offset: int = 0, rotation: int = 0) -> void:
	var cells: Array = div_data.get("grid", {}).get("cells", [])
	for idx in range(min(cells.size(), 25)):
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i: int
		if rotation == 1:    # 90° CCW — attacker: R5 at RIGHT
			child_i = (4 - col) * 5 + row + cell_offset
		elif rotation == 2:  # 90° CW — defender: R5 at LEFT
			child_i = col * 5 + (4 - row) + cell_offset
		else:                # standard
			child_i = (4 - row) * 5 + col + cell_offset
		var cell_data   = cells[idx] if cells[idx] is Dictionary else {}
		_update_cell(child_i, cell_data)


func _apply_deltas_to_data(data_array: Array, deltas: Array) -> void:
	for delta in deltas:
		var idx: int = int(delta.get("cell_index", -1))
		if idx < 0 or idx >= data_array.size():
			continue
		var cell_data: Dictionary = data_array[idx] as Dictionary
		if cell_data.is_empty():
			continue
		for key in delta:
			cell_data[key] = delta[key]


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
		var logical_idx: int = _visual_to_logical(visual_idx, 0)
		var result: Dictionary = AttackPatternRegistry.simulate_round(
			_attacker_cell_data, _defender_cell_data, _current_round
		)
		var targets: Array = result.get(logical_idx, []) as Array
		print("TACTICAL_HOVER: atk=", _attacker_cell_data.size(), " def=", _defender_cell_data.size(),
			" round=", _current_round, " targets=", targets.size())
		_highlight_targets(targets, 25)
	else:
		var def_logical: int = _visual_to_logical(visual_idx - 25, 25)
		var result: Dictionary = AttackPatternRegistry.simulate_round(
			_defender_cell_data, _attacker_cell_data, _current_round
		)
		var targets: Array = result.get(def_logical, []) as Array
		_highlight_targets(targets, 0)

func _highlight_targets(targets: Array, offset: int) -> void:
	for logical_idx in targets:
		var visual_idx: int = _logical_to_visual(int(logical_idx), offset) + offset
		if visual_idx < _glyph_cells.size():
			var cell = _glyph_cells[visual_idx] as UnitGlyphCell
			if cell != null:
				cell.set("is_targeted", true)

func _clear_target_highlights() -> void:
	for cell in _glyph_cells:
		var glyph: UnitGlyphCell = cell as UnitGlyphCell
		if glyph != null:
			glyph.set("is_targeted", false)

func _visual_to_logical(visual_idx: int, grid_offset: int = 0) -> int:
	var d := visual_idx / 5
	var m := visual_idx % 5
	if grid_offset == 0:    # attacker — reverse 90° CCW
		return m * 5 + (4 - d)
	elif grid_offset == 25:  # defender — reverse 90° CW
		return (4 - m) * 5 + d
	else:                    # standard
		return (4 - d) * 5 + m

func _logical_to_visual(logical_idx: int, grid_offset: int = 0) -> int:
	var r := logical_idx / 5
	var c := logical_idx % 5
	if grid_offset == 0:    # attacker — 90° CCW
		return (4 - c) * 5 + r
	elif grid_offset == 25:  # defender — 90° CW
		return c * 5 + (4 - r)
	else:                    # standard
		return (4 - r) * 5 + c
