extends PanelContainer

const GRID_CELL := preload("res://scenes/game/panels/grid_cell.tscn")

@onready var _title_label:  Label         = $InnerMargin/VBoxContent/HeaderRow/TitleLabel
@onready var _round_label:  Label         = $InnerMargin/VBoxContent/HeaderRow/RoundLabel
@onready var _atk_name:     Label         = $InnerMargin/VBoxContent/SubtitleRow/AttackerNameLabel
@onready var _def_name:     Label         = $InnerMargin/VBoxContent/SubtitleRow/DefenderNameLabel
@onready var _atk_grid:     GridContainer = $InnerMargin/VBoxContent/GridRow/AttackerGrid
@onready var _def_grid:     GridContainer = $InnerMargin/VBoxContent/GridRow/DefenderGrid
@onready var _close_btn:    Button        = $InnerMargin/VBoxContent/HeaderRow/CloseButton

var _engagement_id: String = ""


func _ready() -> void:
	hide()
	mouse_filter = MOUSE_FILTER_STOP

	_build_grid(_atk_grid)
	_build_grid(_def_grid)

	_close_btn.pressed.connect(func(): EventBus.tactical_combat_closed.emit())
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
		var cell = GRID_CELL.instantiate()
		grid.add_child(cell)
		cell.display({})

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
	var lethality_suffix := "  [LETHALITY]" if lp in ["intense", "decisive", "annihilation"] else ""
	_round_label.text = "Round %d%s" % [rn, lethality_suffix]
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
	var div_b_id := parts[1]

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
