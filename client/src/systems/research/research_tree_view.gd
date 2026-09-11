extends Control
## Loads real research tree content from JSON (client/assets/data/research/*.json), builds
## cards dynamically, and delegates runtime state to ResearchSystem — which is itself now a
## display cache reflecting server-synced GameState.research, not the sole authority
## (see research_system.gd's doc comment and event_bus.gd's research_updated signal).

signal close_requested()

const ResearchEntryCardScene: PackedScene = preload("res://scenes/systems/research/research_entry_card.tscn")
const ResearchTreeDataLoader = preload("res://src/systems/research/research_tree_data_loader.gd")

# Client-side display-only mirror of research_stats.ts's RESEARCH_CONCURRENCY_COST_STEP — see
# research_drawer_panel.gd's identical constant for the same rationale (display only, server
# remains authoritative on the actual charge).
const RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR: float = 0.25

@onready var _research_system: Variant = %ResearchSystem
@onready var _status_label: Label = %StatusLabel
@onready var _close_button: Button = %CloseButton
@onready var _research_grid: GridContainer = %ResearchGrid

var _entry_cards: Array[Variant] = []


## Loads real research definitions from JSON and builds one card per node.
## Parameters: none.
## Returns: nothing.
func _ready() -> void:
	_research_system.entries_changed.connect(_refresh_tree)
	_close_button.pressed.connect(_request_close)

	var definitions: Array = ResearchTreeDataLoader.load_all_definitions()
	_build_cards(definitions)

	if not _research_system.load_from_definitions(definitions):
		_status_label.text = "No research entries are authored yet."
		return

	if has_node("/root/EventBus"):
		EventBus.research_updated.connect(_on_research_updated)
		# Branch B — live cost/affordability (set_live_cost/set_affordable) is only recomputed
		# inside _refresh_tree(). Without this, a passive money/science change would never
		# re-tint an unaffordable card until an unrelated research state change rebuilt it.
		EventBus.resources_updated.connect(_refresh_tree)

	_refresh_tree()


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


## Returns loaded research definitions.
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


func _build_cards(definitions: Array) -> void:
	for card: Variant in _entry_cards:
		card.queue_free()
	_entry_cards.clear()

	# Empty-stub branches (Naval this phase) simply contribute zero cards — no dedicated
	# "Coming Soon" panel yet (that presentation is Branch C's RESEARCH_UI_HANDOFF.md §4.5 scope).
	for definition: Dictionary in definitions:
		var card: Variant = ResearchEntryCardScene.instantiate()
		card.entry_id = definition.get("id", "")
		card.column_name = definition.get("column", "")
		card.row = int(definition.get("row", 0))
		card.title = definition.get("title", "")
		card.description = definition.get("description", "")
		card.science_value = int(definition.get("science_value", 0))
		card.money_cost = int(definition.get("cost", {}).get("money", 0))
		card.exclusive_group = definition.get("exclusive_group", "")
		card.effects = definition.get("effects", {})
		_research_grid.add_child(card)
		card.entry_pressed.connect(_on_entry_pressed)
		card.cancel_pressed.connect(_on_cancel_pressed)
		_entry_cards.append(card)


func _refresh_tree() -> void:
	for card: Variant in _entry_cards:
		var definition: Dictionary = card.get_definition()
		var entry_id: String = definition.get("id", "")
		if entry_id.is_empty():
			card.apply_runtime_state("full_dark", 0.0, false)
			continue

		var is_active: bool = _research_system.get_active_entry_id() == entry_id
		card.apply_runtime_state(
			_research_system.get_entry_state(entry_id),
			_research_system.get_progress_ratio(entry_id),
			is_active
		)

		# Live concurrency-adjusted cost + insufficient-funds display (Branch B) — recomputed
		# every refresh, distinct from the card's own base money_cost/science_value fields.
		var entry: Dictionary = _research_system.get_entry(entry_id)
		var base_cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
		var multiplier: float = 1.0 + float(GameState.active_research_count) * RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR
		var live_money_cost: int = int(ceil(float(base_cost.get("money", 0)) * multiplier))
		var live_science_cost: int = int(ceil(float(base_cost.get("science", 0)) * multiplier))
		card.set_live_cost(live_money_cost, live_science_cost)
		var affordable: bool = GameState.resources.get("money", 0.0) >= live_money_cost and GameState.science_points >= live_science_cost
		card.set_affordable(affordable or is_active)

	var active_entry_id: String = _research_system.get_active_entry_id()
	if active_entry_id.is_empty():
		_status_label.text = "Click an available entry to start or resume research."
	else:
		var active_entry: Dictionary = _research_system.get_entry(active_entry_id)
		_status_label.text = "Researching: " + active_entry.get("title", active_entry_id)


func _on_research_updated() -> void:
	_research_system.sync_from_server_state(GameState.research)
	_report_cancelled_research_if_any()


func _on_entry_pressed(entry_id: String) -> void:
	CommandQueue.submit("START_RESEARCH", {"node_id": entry_id})


func _on_cancel_pressed(entry_id: String) -> void:
	CommandQueue.submit("CANCEL_RESEARCH", {"node_id": entry_id})


## Reports CANCEL_RESEARCH's refund/forfeit numbers via a toast once the server confirms them.
## Parameters: none.
## Returns: nothing.
func _report_cancelled_research_if_any() -> void:
	var cancelled: Dictionary = GameState.last_cancelled_research
	if cancelled.is_empty():
		return
	var node_id: String = cancelled.get("node_id", "")
	var entry: Dictionary = _research_system.get_entry(node_id)
	var node_name: String = entry.get("title", node_id)
	var refund: Dictionary = cancelled.get("refund", {})
	var forfeit: Dictionary = cancelled.get("forfeit", {})
	var refund_total: float = float(refund.get("money", 0.0)) + float(refund.get("science", 0.0))
	var forfeit_total: float = float(forfeit.get("money", 0.0)) + float(forfeit.get("science", 0.0))
	EventBus.notification_requested.emit(
		"Cancelled: %s — refunded %d, forfeited %d" % [node_name, int(refund_total), int(forfeit_total)],
		"research",
	)
