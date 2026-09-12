@tool
extends PanelContainer
## Inspector-authored research entry card.
## In the editor every card previews as locked; at runtime ResearchTreeView applies live state.
## Phase 11 Branch C — every click now opens the shared node popup (research_node_popup.gd)
## instead of submitting START_RESEARCH/CANCEL_RESEARCH directly; the inline Cancel button
## Branch B added is retired in favor of the popup's Researching-state Cancel flow.

signal entry_pressed(entry_id: String)

const ResearchCardStyle = preload("res://src/systems/research/research_card_style.gd")

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

# Branch C additions — carried through from research_system.gd's normalized entry so this
# card can render badges and the popup can read everything it needs without a second lookup.
var unit_id: String = ""
var path_id: String = ""
var branch: String = ""
var tier: int = 0
var mutex_group_id: String = ""
var badges: Array = []
var size_flag: String = "minor"
var short_description: String = ""
var full_description: String = ""
var image_asset: String = ""

@onready var _title_label: Label = $Margin/Layout/TitleLabel
@onready var _description_label: Label = $Margin/Layout/DescriptionLabel
@onready var _science_label: Label = $Margin/Layout/ScienceLabel
@onready var _progress_bar: ProgressBar = $Margin/Layout/ProgressBar
@onready var _status_label: Label = $Margin/Layout/StatusLabel
@onready var _badge_row: HBoxContainer = $Margin/Layout/BadgeRow


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(230, 148)
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


## Copies the richer Branch C fields (badges, size, unit/path ids, popup text/image) from a
## research_system.gd normalized entry dictionary onto this card. Distinct from get_definition
## — this is data flowing IN from the shared entry dict, not authored on the card itself.
## Parameters:
## - entry: normalized entry dictionary from research_system.gd.get_entry().
## Returns: nothing.
func apply_entry_metadata(entry: Dictionary) -> void:
	unit_id = entry.get("unit_id", "")
	path_id = entry.get("path_id", "")
	branch = entry.get("branch", "")
	tier = int(entry.get("tier", row))
	mutex_group_id = entry.get("mutex_group_id", "")
	badges = entry.get("badges", [])
	size_flag = entry.get("size", "minor")
	short_description = entry.get("short_description", "")
	full_description = entry.get("full_description", "")
	image_asset = entry.get("image_asset", "")
	_rebuild_badge_row()


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


## Cheap per-frame progress refresh (no style/text rebuild) — lets research_tree_view.gd drive
## a smooth interpolated fill every frame for active projects without the cost of a full
## apply_runtime_state() call. See research_system.gd's client-side progress interpolation.
## Parameters:
## - progress_ratio: 0.0 to 1.0 interpolated completion progress.
## Returns: nothing.
func set_progress_ratio(progress_ratio: float) -> void:
	_progress_bar.value = clampf(progress_ratio, 0.0, 1.0)


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
	# Card body shows the glance-friendly short_description when available (RESEARCH_UI_
	# HANDOFF.md §5/§7) — the fuller `description`/`full_description` is popup-only.
	var glance_text: String = short_description if not short_description.is_empty() else description
	_description_label.text = glance_text
	_science_label.text = "$%d · SCI %d" % [money_cost, science_value]
	# Hover tooltip (RESEARCH_UI_HANDOFF.md §6.1) — lightweight, no image/buttons, just enough
	# to scan while moving the cursor around the tree. Godot's native Control.tooltip_text
	# already delivers exactly that (small floating label near the cursor on hover) without
	# needing a hand-built floating PanelContainer — a deliberate simplification of the task
	# spec's illustrative mouse_entered/mouse_exited example, same UX outcome, far less code.
	tooltip_text = "%s\n%s\nTier %d" % [display_title, glance_text, tier]


func _rebuild_badge_row() -> void:
	if _badge_row == null:
		return
	for child: Node in _badge_row.get_children():
		child.queue_free()
	var built_row: HBoxContainer = ResearchCardStyle.build_badge_row(badges)
	for child: Node in built_row.get_children().duplicate():
		built_row.remove_child(child)
		_badge_row.add_child(child)
	_badge_row.visible = not badges.is_empty()


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


func _apply_state_style(legacy_state: String, is_active: bool) -> void:
	var state: String = ResearchCardStyle.resolve_state(legacy_state, is_active)
	add_theme_stylebox_override("panel", ResearchCardStyle.make_state_style(state))
	modulate = ResearchCardStyle.make_state_modulate(state)
