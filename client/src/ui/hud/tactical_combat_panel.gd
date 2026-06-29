extends PanelContainer

const GRID_CELL := preload("res://scenes/game/panels/grid_cell.tscn")

@onready var _title_label:  Label         = $PanelContent/HeaderRow/TitleLabel
@onready var _round_label:  Label         = $PanelContent/HeaderRow/RoundLabel
@onready var _atk_name:     Label         = $PanelContent/SubtitleRow/AttackerNameLabel
@onready var _def_name:     Label         = $PanelContent/SubtitleRow/DefenderNameLabel
@onready var _atk_grid:     GridContainer = $PanelContent/GridRow/AttackerGrid
@onready var _def_grid:     GridContainer = $PanelContent/GridRow/DefenderGrid
@onready var _esc_label:    Label         = $PanelContent/EscalationStrip/EscLabel
@onready var _close_btn:    Button        = $PanelContent/HeaderRow/CloseButton

const C_BG:     Color = Color(0.92, 0.88, 0.82, 1.0)
const C_BORDER: Color = Color(0.45, 0.35, 0.22, 1.0)
const C_TEXT:   Color = Color(0.20, 0.14, 0.06, 1.0)

var _engagement_id: String = ""


func _ready() -> void:
	hide()

	mouse_filter = MOUSE_FILTER_STOP

	theme = null
	_apply_cream_style()
	_tint_all_labels()

	_build_grid(_atk_grid)
	_build_grid(_def_grid)

	_close_btn.pressed.connect(func(): EventBus.tactical_combat_closed.emit())
	EventBus.tactical_combat_opened.connect(_on_opened)
	EventBus.tactical_combat_closed.connect(_on_closed)
	EventBus.round_resolved.connect(_on_round_resolved)


func setup_engagement(eng_id: String, atk_name: String, def_name: String) -> void:
	_engagement_id = eng_id
	_atk_name.text = atk_name
	_def_name.text = def_name


func _apply_cream_style() -> void:
	var s := StyleBoxFlat.new()
	s.bg_color = C_BG
	s.border_color = C_BORDER
	s.set_border_width_all(3)
	s.set_corner_radius_all(4)
	add_theme_stylebox_override("panel", s)

func _tint_all_labels() -> void:
	for lbl in [_title_label, _round_label, _atk_name, _def_name, _esc_label]:
		if lbl != null:
			lbl.add_theme_color_override("font_color", C_TEXT)

func _build_grid(grid: GridContainer) -> void:
	grid.columns = 5
	for _i in range(25):
		var cell = GRID_CELL.instantiate()
		grid.add_child(cell)
		cell.display({})

func _on_opened(eng_id: String) -> void:
	_engagement_id = eng_id
	_refresh_from_game_state()
	show()

func _on_closed() -> void:
	hide()

func _on_round_resolved(eng_id: String, rn: int, lp: bool,
						atk_delta: Array, def_delta: Array, _fb: bool) -> void:
	if eng_id != _engagement_id:
		return
	_round_label.text = "Round %d%s" % [rn, "  [LETHALITY]" if lp else ""]
	_apply_grid_deltas(_atk_grid, atk_delta)
	_apply_grid_deltas(_def_grid, def_delta)

func _apply_grid_deltas(grid: GridContainer, deltas: Array) -> void:
	for delta in deltas:
		var idx: int = int(delta.get("cell_index", -1))
		if idx < 0 or idx >= 25:
			continue
		var row: int    = idx / 5
		var col: int    = idx % 5
		var child_i:int = (4 - row) * 5 + col
		var cell_node   = grid.get_child(child_i)
		if cell_node and cell_node.has_method("display"):
			cell_node.display(delta)

func _refresh_from_game_state() -> void:
	var parts := _engagement_id.split("_vs_")
	if parts.size() < 2:
		return
	var div_a_id := parts[0]
	var div_b_id := parts[1].split("_")[0]

	var div_a = GameState.get_division(div_a_id)
	var div_b = GameState.get_division(div_b_id)
	if div_a:
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
		var cell_node   = grid.get_child(child_i)
		var cell_data   = cells[idx] if cells[idx] is Dictionary else {}
		if cell_node and cell_node.has_method("display"):
			cell_node.display(cell_data)
