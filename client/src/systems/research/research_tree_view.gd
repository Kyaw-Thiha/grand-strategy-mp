extends Control
## Uses inspector-authored research cards and delegates runtime state to ResearchSystem.

signal close_requested()

const ResearchEntryCardScript: GDScript = preload("res://src/systems/research/research_entry_card.gd")

@onready var _research_system: Variant = %ResearchSystem
@onready var _status_label: Label = %StatusLabel
@onready var _close_button: Button = %CloseButton

var _entry_cards: Array[Variant] = []


## Registers static scene cards with the local research system.
## Parameters: none.
## Returns: nothing.
func _ready() -> void:
	_collect_entry_cards(self)
	_research_system.entries_changed.connect(_refresh_tree)
	_close_button.pressed.connect(_request_close)
	for card: Variant in _entry_cards:
		card.entry_pressed.connect(_on_entry_pressed)

	var definitions: Array = []
	for card: Variant in _entry_cards:
		var definition: Dictionary = card.get_definition()
		if not String(definition.get("id", "")).is_empty():
			definitions.append(definition)

	if not _research_system.load_from_definitions(definitions):
		_status_label.text = "No research entries are authored in this scene."
		return

	_refresh_tree()


func _process(delta: float) -> void:
	_research_system.advance(delta)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey:
		var key_event: InputEventKey = event
		if key_event.pressed and not key_event.echo and key_event.physical_keycode == KEY_ESCAPE:
			_request_close()


## Requests the owning HUD to close this tree through its panel manager.
## Parameters: none.
## Returns: nothing.
func _request_close() -> void:
	close_requested.emit()


## Returns the research system owned by this tree scene.
## Parameters: none.
## Returns: ResearchSystem node used by this tree.
func get_research_system() -> Node:
	return _research_system


## Returns authored research definitions collected from this tree scene.
## Parameters: none.
## Returns: array of research definition dictionaries.
func get_research_definitions() -> Array[Dictionary]:
	var definitions: Array[Dictionary] = []
	for card: Variant in _entry_cards:
		var definition: Dictionary = card.get_definition()
		if not String(definition.get("id", "")).is_empty():
			definitions.append(definition)
	return definitions


## Refreshes tree cards from the shared research system.
## Parameters: none.
## Returns: nothing.
func refresh_from_research_system() -> void:
	_refresh_tree()


func _collect_entry_cards(node: Node) -> void:
	for child: Node in node.get_children():
		if child.get_script() == ResearchEntryCardScript:
			_entry_cards.append(child)
		_collect_entry_cards(child)


func _refresh_tree() -> void:
	for card: Variant in _entry_cards:
		var definition: Dictionary = card.get_definition()
		var entry_id: String = definition.get("id", "")
		if entry_id.is_empty():
			card.apply_runtime_state("full_dark", 0.0, false)
			continue

		card.apply_runtime_state(
			_research_system.get_entry_state(entry_id),
			_research_system.get_progress_ratio(entry_id),
			_research_system.get_active_entry_id() == entry_id
		)

	var active_entry_id: String = _research_system.get_active_entry_id()
	if active_entry_id.is_empty():
		_status_label.text = "Click an available entry to start or resume research."
	else:
		var active_entry: Dictionary = _research_system.get_entry(active_entry_id)
		_status_label.text = "Researching: " + active_entry.get("title", active_entry_id)


func _on_entry_pressed(entry_id: String) -> void:
	_research_system.start_research(entry_id)
	_refresh_tree()
