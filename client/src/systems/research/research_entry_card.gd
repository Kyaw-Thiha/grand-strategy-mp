@tool
extends PanelContainer
## Inspector-authored research entry card.
## In the editor every card previews as locked; at runtime ResearchTreeView applies live state.

signal entry_pressed(entry_id: String)
signal cancel_pressed(entry_id: String)

const COST_AFFORDABLE_COLOR: Color = Color(1, 1, 1, 1)
const COST_INSUFFICIENT_COLOR: Color = Color(0.85, 0.3, 0.3, 1.0)

const STATE_UNAVAILABLE: String = "full_dark"
const STATE_AVAILABLE: String = "dark"
const STATE_RESEARCHED: String = "normal"

@export var entry_id: String = "":
	set(value):
		entry_id = value
		_refresh_editor_preview()
@export var column_name: String = "":
	set(value):
		column_name = value
		_refresh_editor_preview()
@export var row: int = 0:
	set(value):
		row = value
		_refresh_editor_preview()
@export var title: String = "":
	set(value):
		title = value
		_refresh_editor_preview()
@export_multiline var description: String = "":
	set(value):
		description = value
		_refresh_editor_preview()
@export var science_value: int = 1:
	set(value):
		science_value = maxi(value, 0)
		_refresh_editor_preview()
@export var money_cost: int = 0:
	set(value):
		money_cost = maxi(value, 0)
		_refresh_editor_preview()
@export var exclusive_group: String = "":
	set(value):
		exclusive_group = value
		_refresh_editor_preview()
@export var effects: Dictionary = {}

@onready var _title_label: Label = $Margin/Layout/TitleLabel
@onready var _description_label: Label = $Margin/Layout/DescriptionLabel
@onready var _science_label: Label = $Margin/Layout/ScienceLabel
@onready var _progress_bar: ProgressBar = $Margin/Layout/ProgressBar
@onready var _status_label: Label = $Margin/Layout/StatusLabel
@onready var _cancel_button: Button = $Margin/Layout/CancelButton


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(230, 148)
	_cancel_button.pressed.connect(func() -> void: cancel_pressed.emit(entry_id))
	if Engine.is_editor_hint():
		_refresh_editor_preview()


## Returns this card's research definition for ResearchSystem.
## Parameters: none.
## Returns: dictionary containing all authored fields needed by runtime state.
func get_definition() -> Dictionary:
	return {
		"id": entry_id,
		"column": column_name,
		"row": row,
		"title": title,
		"description": description,
		"science_value": science_value,
		"exclusive_group": exclusive_group,
		"effects": effects,
		"cost": {"money": money_cost, "science": science_value},
	}


## Overrides the cost label with the live concurrency-adjusted cost (recomputed by the owner
## every refresh from GameState.active_research_count, distinct from this card's own base
## money_cost/science_value export fields, which reflect the node's raw JSON cost).
## Parameters:
## - display_money: live money cost to show.
## - display_science: live science cost to show.
## Returns: nothing.
func set_live_cost(display_money: int, display_science: int) -> void:
	_science_label.text = "$%d · SCI %d" % [display_money, display_science]


## Applies live runtime state to the existing card controls.
## Parameters:
## - state: visual state string.
## - progress_ratio: 0.0 to 1.0 completion progress.
## - is_active: true when this entry is currently progressing.
## Returns: nothing.
func apply_runtime_state(state: String, progress_ratio: float, is_active: bool) -> void:
	_apply_text()
	_progress_bar.value = clampf(progress_ratio, 0.0, 1.0)
	_status_label.text = _get_status_text(state, progress_ratio, is_active)
	_apply_state_style(state, is_active)
	_cancel_button.visible = is_active


## Tints the cost label to flag an unaffordable node — the first insufficient-funds pattern
## in this codebase, kept deliberately simple (a color change, nothing fancier).
## Parameters:
## - affordable: whether the nation can currently pay this node's live cost.
## Returns: nothing.
func set_affordable(affordable: bool) -> void:
	_science_label.modulate = COST_AFFORDABLE_COLOR if affordable else COST_INSUFFICIENT_COLOR


func _gui_input(event: InputEvent) -> void:
	if Engine.is_editor_hint():
		return
	if not event is InputEventMouseButton:
		return
	var mouse_event: InputEventMouseButton = event
	if mouse_event.button_index != MOUSE_BUTTON_LEFT or not mouse_event.pressed:
		return
	entry_pressed.emit(entry_id)
	accept_event()


func _refresh_editor_preview() -> void:
	if not is_inside_tree() or not is_node_ready():
		return
	_apply_text()
	_progress_bar.value = 0.0
	_status_label.text = "Locked"
	_apply_state_style(STATE_UNAVAILABLE, false)


func _apply_text() -> void:
	var display_title: String = title
	if display_title.is_empty():
		display_title = entry_id if not entry_id.is_empty() else "Research Entry"
	_title_label.text = display_title
	_description_label.text = description
	_science_label.text = "$%d · SCI %d" % [money_cost, science_value]


func _get_status_text(state: String, progress_ratio: float, is_active: bool) -> String:
	if state == STATE_RESEARCHED:
		return "Researched"
	if state == STATE_UNAVAILABLE:
		return "Locked"
	if is_active:
		return "Researching %d%%" % int(roundf(progress_ratio * 100.0))
	if progress_ratio > 0.0:
		return "Paused %d%%" % int(roundf(progress_ratio * 100.0))
	return "Available"


func _apply_state_style(state: String, is_active: bool) -> void:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1

	if state == STATE_RESEARCHED:
		style.bg_color = Color(0.12, 0.16, 0.10, 0.96)
		style.border_color = Color(0.42, 0.62, 0.32)
		modulate = Color.WHITE
	elif state == STATE_AVAILABLE:
		style.bg_color = Color(0.12, 0.08, 0.05, 0.96)
		style.border_color = Color(0.84, 0.68, 0.30) if is_active else Color(0.42, 0.30, 0.16)
		modulate = Color.WHITE
	else:
		style.bg_color = Color(0.08, 0.06, 0.04, 0.72)
		style.border_color = Color(0.22, 0.16, 0.09, 0.65)
		modulate = Color(0.66, 0.60, 0.50, 1.0)

	add_theme_stylebox_override("panel", style)
