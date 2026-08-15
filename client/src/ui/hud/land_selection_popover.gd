extends PanelContainer
## Contextual, world-anchored inspector for owned land-division selections.

enum DisplayMode { HIDDEN, GROUP_COLLAPSED, INSPECTOR }

const MAX_INLINE_ROSTER := 3
const UNIT_CLASS_COLOR: Dictionary = {
	"infantry": Color(0.42, 0.49, 0.18, 1.0),
	"assault_infantry": Color(0.42, 0.49, 0.18, 1.0),
	"mg": Color(0.42, 0.49, 0.18, 1.0),
	"commando": Color(0.42, 0.49, 0.18, 1.0),
	"flamethrower": Color(0.42, 0.49, 0.18, 1.0),
	"at_infantry": Color(0.42, 0.49, 0.18, 1.0),
	"sniper": Color(0.42, 0.49, 0.18, 1.0),
	"light_tank": Color(0.29, 0.43, 0.65, 1.0),
	"medium_tank": Color(0.29, 0.43, 0.65, 1.0),
	"heavy_tank": Color(0.29, 0.43, 0.65, 1.0),
	"armoured_car": Color(0.29, 0.43, 0.65, 1.0),
	"at_gun_sp": Color(0.29, 0.43, 0.65, 1.0),
	"self_propelled_gun": Color(0.29, 0.43, 0.65, 1.0),
	"artillery": Color(0.55, 0.19, 0.19, 1.0),
	"howitzer": Color(0.55, 0.19, 0.19, 1.0),
	"at_gun": Color(0.55, 0.19, 0.19, 1.0),
	"aa_gun": Color(0.55, 0.19, 0.19, 1.0),
	"recon_infantry": Color(0.10, 0.55, 0.50, 1.0),
	"cavalry": Color(0.10, 0.55, 0.50, 1.0),
	"force_recon_sniper": Color(0.10, 0.55, 0.50, 1.0),
}
const EMPTY_CELL_COLOR := Color(0.10, 0.08, 0.07, 1.0)

@onready var _title: Label = $Margin/Content/Header/Title
@onready var _header: HBoxContainer = $Margin/Content/Header
@onready var _state: Label = $Margin/Content/Header/State
@onready var _close: Button = $Margin/Content/Header/Close
@onready var _meta: Label = $Margin/Content/Meta
@onready var _inspect_chip: Button = $Margin/Content/InspectChip
@onready var _roster: HBoxContainer = $Margin/Content/Roster
@onready var _body: HBoxContainer = $Margin/Content/Body
@onready var _composition: Button = $Margin/Content/Body/Composition
@onready var _comp_grid: GridContainer = $Margin/Content/Body/Composition/VBox/Grid
@onready var _template: Label = $Margin/Content/Body/Details/Template
@onready var _supply: Label = $Margin/Content/Body/Details/Supply
@onready var _selection_summary: Label = $Margin/Content/Body/Details/SelectionSummary
@onready var _actions: HBoxContainer = $Margin/Content/Actions
@onready var _retreat: Button = $Margin/Content/Actions/Retreat
@onready var _reposition: Button = $Margin/Content/Actions/Reposition
@onready var _more: MenuButton = $Margin/Content/Actions/More

var _display_mode: DisplayMode = DisplayMode.HIDDEN
var _selected_ids: Array[String] = []
var _active_id: String = ""
var _suspended: bool = false
var _anchor_available: bool = false
var _comp_cells: Array[ColorRect] = []
var _keep_expanded_on_next_selection: bool = false


func _ready() -> void:
	_build_comp_cells()
	_close.pressed.connect(_close_inspector)
	_inspect_chip.pressed.connect(_expand_group)
	_composition.pressed.connect(_open_composition)
	_retreat.pressed.connect(func() -> void: EventBus.division_retreat_selected_requested.emit())
	_reposition.pressed.connect(func() -> void:
		if not _active_id.is_empty():
			EventBus.reposition_mode_requested.emit(_active_id)
	)
	var popup: PopupMenu = _more.get_popup()
	popup.add_item("Hold selected [G]", 0)
	popup.id_pressed.connect(func(item_id: int) -> void:
		if item_id == 0:
			EventBus.division_hold_selected_requested.emit()
	)
	EventBus.division_selection_changed.connect(_on_selection_changed)
	EventBus.division_active_changed.connect(_on_active_changed)
	EventBus.division_inspector_requested.connect(_on_inspector_requested)
	EventBus.division_updated.connect(_on_division_updated)
	_apply_mode()


## Returns the division whose counter currently anchors this popover.
func get_anchor_division_id() -> String:
	return _active_id


## Temporarily suppresses the popover while another major HUD surface is open.
func set_suspended(suspended: bool) -> void:
	_suspended = suspended
	_sync_visibility()


## Reports whether the popover has content that should be positioned.
func is_display_requested() -> bool:
	return _display_mode != DisplayMode.HIDDEN and not _suspended


## Applies whether the current world anchor can be displayed in the usable viewport.
func set_anchor_available(available: bool) -> void:
	_anchor_available = available
	_sync_visibility()


## Supplies the anchor point in local coordinates for the leader line.
func set_leader_target(screen_position: Vector2) -> void:
	set_meta("leader_target", screen_position - global_position)
	queue_redraw()


func _draw() -> void:
	if not has_meta("leader_target"):
		return
	var target: Vector2 = get_meta("leader_target") as Vector2
	var origin := Vector2(clampf(target.x, 8.0, size.x - 8.0), clampf(target.y, 8.0, size.y - 8.0))
	draw_line(origin, target, Color(0.56, 0.38, 0.16, 0.9), 2.0)


func _on_selection_changed(division_ids: Array[String]) -> void:
	_selected_ids = division_ids.duplicate()
	if _selected_ids.is_empty():
		_active_id = ""
		_set_mode(DisplayMode.HIDDEN)
		return
	if not _selected_ids.has(_active_id):
		_active_id = _selected_ids[0]
	if _selected_ids.size() > 1:
		if not (_keep_expanded_on_next_selection and _display_mode == DisplayMode.INSPECTOR):
			_set_mode(DisplayMode.GROUP_COLLAPSED)
	elif _keep_expanded_on_next_selection:
		_set_mode(DisplayMode.INSPECTOR)
	elif _display_mode == DisplayMode.GROUP_COLLAPSED:
		_set_mode(DisplayMode.HIDDEN)
	_keep_expanded_on_next_selection = false
	_refresh_content()


func _on_active_changed(division_id: String) -> void:
	_active_id = division_id
	if _display_mode == DisplayMode.INSPECTOR:
		_refresh_content()


func _on_inspector_requested(division_id: String) -> void:
	if not _selected_ids.has(division_id):
		return
	_active_id = division_id
	_set_mode(DisplayMode.INSPECTOR)
	_refresh_content()


func _on_division_updated(division_id: String) -> void:
	if _selected_ids.has(division_id):
		_refresh_content()


func _refresh_content() -> void:
	if _active_id.is_empty():
		return
	var data: Dictionary = GameState.get_division(_active_id)
	if data.is_empty():
		return
	_title.text = "%d DIVISIONS" % _selected_ids.size() if _selected_ids.size() > 1 else _active_id
	_state.text = str(data.get("combat_state", "idle")).to_upper()
	_meta.text = "%s · %s" % [str(data.get("division_type", "infantry")).capitalize(), str(data.get("nation_id", "")).replace("_", " ").capitalize()]
	_template.text = str(data.get("division_type", "infantry")).capitalize()
	_supply.text = "Supply · %s" % str(data.get("supply_status", "normal")).replace("_", " ").capitalize()
	_selection_summary.text = _get_template_summary()
	_refresh_comp_grid(data)
	_refresh_roster()
	_refresh_actions()
	_inspect_chip.text = "%d divisions · Inspect" % _selected_ids.size()


## Summarizes whether the current land selection shares one template.
## Parameters: none.
## Returns: empty for a single division, otherwise a matching/mixed template summary.
func _get_template_summary() -> String:
	if _selected_ids.size() <= 1:
		return ""
	var template_ids: Dictionary = {}
	for division_id: String in _selected_ids:
		var data: Dictionary = GameState.get_division(division_id)
		template_ids[str(data.get("template_id", data.get("division_type", "unknown")))] = true
	if template_ids.size() == 1:
		return "Matching template ×%d" % _selected_ids.size()
	return "%d templates selected" % template_ids.size()


## Rebuilds the bounded active-selection roster and overflow menu.
## Parameters: none.
## Returns: nothing.
func _refresh_roster() -> void:
	for child: Node in _roster.get_children():
		_roster.remove_child(child)
		child.queue_free()
	if _selected_ids.size() <= 1:
		return
	for index: int in range(mini(_selected_ids.size(), MAX_INLINE_ROSTER)):
		var division_id: String = _selected_ids[index]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 1)
		var activate := Button.new()
		activate.text = _get_roster_chip_text(division_id)
		activate.tooltip_text = division_id
		activate.custom_minimum_size = Vector2(68.0, 44.0)
		activate.disabled = division_id == _active_id
		activate.pressed.connect(func() -> void: EventBus.division_active_requested.emit(division_id))
		row.add_child(activate)
		var remove := Button.new()
		remove.text = "×"
		remove.tooltip_text = "Remove from selection"
		remove.pressed.connect(func() -> void:
			_keep_expanded_on_next_selection = true
			EventBus.division_selection_remove_requested.emit(division_id)
		)
		row.add_child(remove)
		_roster.add_child(row)
	if _selected_ids.size() > MAX_INLINE_ROSTER:
		var remainder := MenuButton.new()
		remainder.text = "+%d" % (_selected_ids.size() - MAX_INLINE_ROSTER)
		remainder.tooltip_text = "Additional selected divisions"
		var popup: PopupMenu = remainder.get_popup()
		for index: int in range(MAX_INLINE_ROSTER, _selected_ids.size()):
			var division_id: String = _selected_ids[index]
			popup.add_item(division_id, index)
		popup.id_pressed.connect(func(index: int) -> void:
			if index >= 0 and index < _selected_ids.size():
				EventBus.division_active_requested.emit(_selected_ids[index])
		)
		_roster.add_child(remainder)


func _short_division_name(division_id: String) -> String:
	return division_id if division_id.length() <= 9 else division_id.left(8) + "…"


func _get_roster_chip_text(division_id: String) -> String:
	var data: Dictionary = GameState.get_division(division_id)
	var hp: float = float(data.get("hp", 100.0))
	var max_hp: float = float(data.get("max_hp", 100.0))
	var hp_percent: float = (hp / max_hp) * 100.0 if max_hp > 0.0 else 0.0
	var suppression: float = float(data.get("suppression", 0.0))
	return "%s\nHP %.0f · SP %.0f" % [_short_division_name(division_id), hp_percent, suppression]


## Applies contextual combat-action visibility for the active selection.
## Parameters: none.
## Returns: nothing.
func _refresh_actions() -> void:
	var can_retreat: bool = false
	for division_id: String in _selected_ids:
		var combat_state: String = GameState.get_division(division_id).get("combat_state", "idle")
		if combat_state in ["engaged", "suppressed"]:
			can_retreat = true
			break
	_retreat.visible = can_retreat
	_retreat.text = "Retreat selected [C]" if _selected_ids.size() > 1 else "Retreat [C]"
	var active_state: String = GameState.get_division(_active_id).get("combat_state", "idle")
	_reposition.visible = _selected_ids.size() == 1 and active_state in ["engaged", "suppressed"]


func _build_comp_cells() -> void:
	for _index: int in range(25):
		var cell := ColorRect.new()
		cell.custom_minimum_size = Vector2(8, 8)
		cell.color = EMPTY_CELL_COLOR
		cell.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_comp_grid.add_child(cell)
		_comp_cells.append(cell)


func _refresh_comp_grid(data: Dictionary) -> void:
	var cells: Array = []
	var template_id: String = data.get("template_id", "")
	if not template_id.is_empty():
		cells = DivisionTemplateStore.get_template(template_id).get("cells", [])
	for index: int in range(25):
		var unit_type: String = cells[index] if index < cells.size() else ""
		_comp_cells[index].color = UNIT_CLASS_COLOR.get(unit_type, EMPTY_CELL_COLOR)


## Changes presentation state and requires the HUD to validate a fresh world anchor.
## Parameters:
## - mode: collapsed group, inspector, or hidden presentation.
## Returns: nothing.
func _set_mode(mode: DisplayMode) -> void:
	_display_mode = mode
	_anchor_available = false
	_apply_mode()


func _apply_mode() -> void:
	var collapsed: bool = _display_mode == DisplayMode.GROUP_COLLAPSED
	_header.visible = not collapsed
	_close.visible = not collapsed
	_state.visible = not collapsed
	_meta.visible = not collapsed
	_inspect_chip.visible = collapsed
	_roster.visible = _display_mode == DisplayMode.INSPECTOR and _selected_ids.size() > 1
	_body.visible = _display_mode == DisplayMode.INSPECTOR
	_actions.visible = _display_mode == DisplayMode.INSPECTOR
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size.x = 180.0 if collapsed else (360.0 if _selected_ids.size() > 1 else 290.0)
	reset_size()
	_sync_visibility()


## Applies node visibility from display intent, HUD suspension, and anchor availability.
## Parameters: none.
## Returns: nothing.
func _sync_visibility() -> void:
	visible = _display_mode != DisplayMode.HIDDEN and not _suspended and _anchor_available


func _close_inspector() -> void:
	_set_mode(DisplayMode.GROUP_COLLAPSED if _selected_ids.size() > 1 else DisplayMode.HIDDEN)


func _expand_group() -> void:
	_set_mode(DisplayMode.INSPECTOR)
	_refresh_content()


func _open_composition() -> void:
	if not _active_id.is_empty():
		EventBus.division_template_viewer_open_requested.emit(_active_id)
