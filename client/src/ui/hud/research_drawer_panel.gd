extends PanelContainer
## Side-docked research drawer listing currently runnable research entries.

signal full_tree_requested()
signal close_requested()

const CARD_BG: Color = Color(0.12, 0.08, 0.05, 0.96)
const CARD_BG_ACTIVE: Color = Color(0.16, 0.12, 0.06, 0.98)
const CARD_BORDER: Color = Color(0.42, 0.30, 0.16, 1.0)
const CARD_BORDER_ACTIVE: Color = Color(0.84, 0.68, 0.30, 1.0)
const COST_AFFORDABLE_COLOR: Color = Color(1, 1, 1, 1)
const COST_INSUFFICIENT_COLOR: Color = Color(0.85, 0.3, 0.3, 1.0)

# Client-side display-only mirror of research_stats.ts's RESEARCH_CONCURRENCY_COST_STEP — used
# purely to show the player what the price *will* be before they click. The server remains the
# source of truth on the actual charge; a mismatch here is a display bug, never an exploit.
const RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR: float = 0.25

@onready var _full_tree_button: Button = %FullTreeButton
@onready var _close_button: Button = %CloseButton
@onready var _entry_list: VBoxContainer = %EntryList
@onready var _empty_label: Label = %EmptyLabel

var _research_system: Node = null


func _ready() -> void:
	_full_tree_button.pressed.connect(func() -> void: full_tree_requested.emit())
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	EventBus.research_updated.connect(_on_research_updated_for_cancel_toast)
	# Branch B — cost/affordability is computed inline in _create_entry_card(), which only
	# runs from _refresh_entries(). Without this, a passive money/science change (extraction
	# income, another research action) would never re-tint an unaffordable card until some
	# unrelated research state change happened to rebuild the list.
	EventBus.resources_updated.connect(_refresh_entries)


## Reports CANCEL_RESEARCH's refund/forfeit numbers via a toast once the server confirms them.
## Parameters: none.
## Returns: nothing.
func _on_research_updated_for_cancel_toast() -> void:
	var cancelled: Dictionary = GameState.last_cancelled_research
	if cancelled.is_empty():
		return
	var node_id: String = cancelled.get("node_id", "")
	var node_name: String = node_id
	if _research_system != null and _research_system.has_method("get_entry"):
		var entry: Dictionary = _research_system.get_entry(node_id)
		node_name = entry.get("title", node_id)
	var refund: Dictionary = cancelled.get("refund", {})
	var forfeit: Dictionary = cancelled.get("forfeit", {})
	var refund_total: float = float(refund.get("money", 0.0)) + float(refund.get("science", 0.0))
	var forfeit_total: float = float(forfeit.get("money", 0.0)) + float(forfeit.get("science", 0.0))
	EventBus.notification_requested.emit(
		"Cancelled: %s — refunded %d, forfeited %d" % [node_name, int(refund_total), int(forfeit_total)],
		"research",
	)


## Injects the shared research system owned by the full tree scene.
## Parameters:
## - research_system: node exposing ResearchSystem methods and entries_changed.
## Returns: nothing.
func setup(research_system: Node) -> void:
	if _research_system != null and _research_system.has_signal("entries_changed"):
		var refresh_callable: Callable = Callable(self, "_refresh_entries")
		if _research_system.is_connected("entries_changed", refresh_callable):
			_research_system.disconnect("entries_changed", refresh_callable)

	_research_system = research_system
	if _research_system != null and _research_system.has_signal("entries_changed"):
		_research_system.connect("entries_changed", Callable(self, "_refresh_entries"))

	_refresh_entries()


## Rebuilds the clickable available-research list from shared research state.
## Parameters: none.
## Returns: nothing.
func _refresh_entries() -> void:
	for child: Node in _entry_list.get_children():
		child.queue_free()

	if _research_system == null:
		_empty_label.text = "Research system unavailable."
		_empty_label.show()
		return

	var entries: Array[Dictionary] = _get_available_entries()
	_empty_label.visible = entries.is_empty()
	if entries.is_empty():
		_empty_label.text = "No available research."
		return

	for entry: Dictionary in entries:
		_entry_list.add_child(_create_entry_card(entry))


## Returns available entries sorted by highest authored row first.
## Parameters: none.
## Returns: runnable research definitions.
func _get_available_entries() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if _research_system == null or not _research_system.has_method("get_entries"):
		return result

	var entries: Array = _research_system.get_entries()
	for raw_entry: Variant in entries:
		if not raw_entry is Dictionary:
			continue
		var entry: Dictionary = raw_entry
		var entry_id: String = entry.get("id", "")
		if entry_id.is_empty():
			continue
		if _research_system.is_available(entry_id):
			result.append(entry)

	result.sort_custom(Callable(self, "_sort_entries_highest_level_first"))
	return result


## Sort callback for drawer research entries.
## Parameters:
## - a: first entry dictionary.
## - b: second entry dictionary.
## Returns: true when a should appear before b.
func _sort_entries_highest_level_first(a: Dictionary, b: Dictionary) -> bool:
	var row_a: int = int(a.get("row", 0))
	var row_b: int = int(b.get("row", 0))
	if row_a != row_b:
		return row_a > row_b
	var title_a: String = a.get("title", a.get("id", ""))
	var title_b: String = b.get("title", b.get("id", ""))
	return title_a < title_b


## Creates one compact clickable card for a research entry.
## Parameters:
## - entry: research definition dictionary.
## Returns: configured card control.
func _create_entry_card(entry: Dictionary) -> Control:
	var entry_id: String = entry.get("id", "")
	var is_active: bool = _research_system.get_active_entry_id() == entry_id

	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size = Vector2(0, 118)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.add_theme_stylebox_override("panel", _make_card_style(is_active))
	card.gui_input.connect(_on_entry_card_input.bind(entry_id))

	var margin: MarginContainer = MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var layout: VBoxContainer = VBoxContainer.new()
	layout.add_theme_constant_override("separation", 4)
	margin.add_child(layout)

	var title: Label = Label.new()
	title.text = entry.get("title", entry_id)
	title.add_theme_font_size_override("font_size", 15)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	layout.add_child(title)

	var meta: Label = Label.new()
	var base_cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
	var multiplier: float = 1.0 + float(GameState.active_research_count) * RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR
	var money_cost: int = int(ceil(float(base_cost.get("money", 0)) * multiplier))
	var science_cost: int = int(ceil(float(base_cost.get("science", 0)) * multiplier))
	meta.text = "%s - $%d · SCI %d" % [entry.get("column", "Research"), money_cost, science_cost]
	var affordable: bool = GameState.resources.get("money", 0.0) >= money_cost and GameState.science_points >= science_cost
	meta.modulate = COST_AFFORDABLE_COLOR if (affordable or is_active) else COST_INSUFFICIENT_COLOR
	layout.add_child(meta)

	var description: Label = Label.new()
	description.text = entry.get("description", "")
	description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	description.size_flags_vertical = Control.SIZE_EXPAND_FILL
	layout.add_child(description)

	var progress_bar: ProgressBar = ProgressBar.new()
	progress_bar.max_value = 1.0
	progress_bar.step = 0.001
	progress_bar.show_percentage = false
	progress_bar.value = _research_system.get_progress_ratio(entry_id)
	layout.add_child(progress_bar)

	var status: Label = Label.new()
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	status.text = "Researching" if is_active else "Available"
	layout.add_child(status)

	if is_active:
		var btn_cancel: Button = Button.new()
		btn_cancel.text = "Cancel"
		btn_cancel.pressed.connect(func() -> void:
			CommandQueue.submit("CANCEL_RESEARCH", {"node_id": entry_id})
		)
		layout.add_child(btn_cancel)

	return card


## Returns a card style for available or currently active entries.
## Parameters:
## - active: whether this entry is the active research.
## Returns: StyleBoxFlat for the entry card.
func _make_card_style(active: bool) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = CARD_BG_ACTIVE if active else CARD_BG
	style.border_color = CARD_BORDER_ACTIVE if active else CARD_BORDER
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.corner_radius_top_left = 4
	style.corner_radius_top_right = 4
	style.corner_radius_bottom_left = 4
	style.corner_radius_bottom_right = 4
	return style


func _on_entry_card_input(event: InputEvent, entry_id: String) -> void:
	if not event is InputEventMouseButton:
		return
	var mouse_event: InputEventMouseButton = event
	if mouse_event.button_index != MOUSE_BUTTON_LEFT or not mouse_event.pressed:
		return
	CommandQueue.submit("START_RESEARCH", {"node_id": entry_id})
	accept_event()
