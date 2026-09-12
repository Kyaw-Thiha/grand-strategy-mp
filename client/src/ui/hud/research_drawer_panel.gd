extends PanelContainer
## Side-docked research drawer — restructured (Phase 11 Branch C) into IN PROGRESS / NEW /
## AVAILABLE sections with a search box + branch-filter dropdown, per
## plans/phase-11/RESEARCH_UI_HANDOFF.md §3. Every card click now opens the shared popup
## (EventBus.research_node_popup_requested) instead of submitting START_RESEARCH directly —
## Branch B's inline Cancel button is retired in favor of the popup's Researching-state Cancel
## flow (see phase-11-task-c-ui-interaction.md Step 6).

signal full_tree_requested()
signal close_requested()

const ResearchCardStyle = preload("res://src/systems/research/research_card_style.gd")

const COST_AFFORDABLE_COLOR: Color = Color(1, 1, 1, 1)
const COST_INSUFFICIENT_COLOR: Color = Color(0.85, 0.3, 0.3, 1.0)

# Client-side display-only mirror of research_stats.ts's RESEARCH_CONCURRENCY_COST_STEP — used
# purely to show the player what the price *will* be before they click. The server remains the
# source of truth on the actual charge; a mismatch here is a display bug, never an exploit.
const RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR: float = 0.25

const NEW_QUEUE_CAP: int = 5
const AVAILABLE_CARD_CAP: int = 8
const SEARCH_DEBOUNCE_SECONDS: float = 0.15
const BRANCH_ORDER: Array[String] = ["Infantry", "Ordnance", "Armour", "Air", "Naval", "Economy", "General"]

@onready var _full_tree_button: Button = %FullTreeButton
@onready var _close_button: Button = %CloseButton
@onready var _search_box: LineEdit = %SearchBox
@onready var _branch_filter: OptionButton = %BranchFilter
@onready var _sections_container: VBoxContainer = %EntryList
@onready var _empty_label: Label = %EmptyLabel

var _research_system: Node = null
var _search_debounce: Timer
var _pending_search_text: String = ""

# NEW-section recency tracking (client-side only, per RESEARCH_UI_HANDOFF.md §3.1 — "needs no
# seen/dismissed flag"). Oldest entries fall off automatically as newer ones push in.
var _new_recency_queue: Array[String] = []
var _known_available_ids: Dictionary = {}
var _has_baseline_available_snapshot: bool = false

# node_id -> ProgressBar, for the IN PROGRESS section's per-frame interpolated fill.
var _in_progress_bars: Dictionary = {}


func _ready() -> void:
	_full_tree_button.pressed.connect(func() -> void: full_tree_requested.emit())
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	EventBus.research_updated.connect(_on_research_updated_for_cancel_toast)
	EventBus.research_updated.connect(_refresh_entries)
	# Branch B — cost/affordability is computed inline in card building. Without this, a
	# passive money/science change would never re-tint an unaffordable card until some
	# unrelated research state change happened to rebuild the list.
	EventBus.resources_updated.connect(_refresh_entries)

	_search_debounce = Timer.new()
	_search_debounce.one_shot = true
	_search_debounce.wait_time = SEARCH_DEBOUNCE_SECONDS
	add_child(_search_debounce)
	_search_debounce.timeout.connect(_apply_filters)
	_search_box.text_changed.connect(func(text: String) -> void:
		_pending_search_text = text
		_search_debounce.start()
	)
	# Reuses chat_panel.gd's exact focus-blocking idiom (EventBus.chat_input_focus_changed →
	# HUDManager._player_input_blocked) — without this, typing a letter that also happens to be
	# a HUD hotkey (G/C/X/Q/etc.) fires that hotkey while the player is just typing a search term,
	# because HUDManager's _input() has no notion of which Control currently owns keyboard focus.
	_search_box.focus_entered.connect(func() -> void: EventBus.chat_input_focus_changed.emit(true))
	_search_box.focus_exited.connect(func() -> void: EventBus.chat_input_focus_changed.emit(false))
	_search_box.gui_input.connect(_on_search_box_gui_input)

	_branch_filter.clear()
	_branch_filter.add_item("All branches")
	for branch: String in BRANCH_ORDER:
		_branch_filter.add_item(branch)
	_branch_filter.item_selected.connect(func(_idx: int) -> void: _apply_filters())


func _exit_tree() -> void:
	# Safety net mirroring chat_panel.gd's _exit_tree — clears the global input-block flag if
	# this panel is torn down while the search box still holds focus, so a stray true never
	# permanently suppresses HUD hotkeys.
	if _search_box != null and _search_box.has_focus() and has_node("/root/EventBus"):
		EventBus.chat_input_focus_changed.emit(false)


func _process(_delta: float) -> void:
	if not visible or _research_system == null:
		return
	for entry_id: Variant in _in_progress_bars.keys():
		var bar: ProgressBar = _in_progress_bars[entry_id]
		if bar != null and is_instance_valid(bar):
			bar.value = _research_system.get_progress_ratio(String(entry_id))


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


func _apply_filters() -> void:
	_refresh_entries()


## Escape, while the sidebar's search box has focus, clears the search back to empty instead of
## closing the Research drawer — scoped to this drawer's search box only (Full Tree's rail search
## box is a separate LineEdit with its own Escape-closes-panel expectation and is not touched
## here). Consumes the event via accept_event() so it doesn't also bubble up to whatever normally
## handles Escape-closes-panel (in practice HUDManager._input() is already blocked while this box
## has focus — see the focus_entered/focus_exited wiring above emitting chat_input_focus_changed
## — but accept_event() keeps this box's own behavior self-contained regardless of that).
## Parameters:
## - event: the LineEdit's own gui_input event.
## Returns: nothing.
func _on_search_box_gui_input(event: InputEvent) -> void:
	if not event.is_action_pressed("ui_cancel"):
		return
	_search_box.text = ""
	_pending_search_text = ""
	_search_debounce.stop()
	_apply_filters()
	accept_event()


func _current_search_query() -> String:
	return _pending_search_text.strip_edges().to_lower()


func _current_branch_filter() -> String:
	var idx: int = _branch_filter.selected
	if idx <= 0:
		return ""
	return BRANCH_ORDER[idx - 1] if idx - 1 < BRANCH_ORDER.size() else ""


## Rebuilds the sectioned (IN PROGRESS / NEW / AVAILABLE) card list from shared research state.
## Parameters: none.
## Returns: nothing.
func _refresh_entries() -> void:
	for child: Node in _sections_container.get_children():
		child.queue_free()
	_in_progress_bars.clear()

	if _research_system == null:
		_empty_label.text = "Research system unavailable."
		_empty_label.show()
		return

	_update_new_recency_queue()

	var query: String = _current_search_query()
	var branch_filter: String = _current_branch_filter()

	var in_progress_ids: Array[String] = _research_system.get_active_entry_ids()
	var new_ids: Array[String] = _new_recency_queue.duplicate()
	var available_groups: Array[Dictionary] = _resolve_available_groups(new_ids)

	var any_shown: bool = false
	any_shown = _build_section(
		"IN PROGRESS", in_progress_ids, query, branch_filter, true
	) or any_shown
	any_shown = _build_section(
		"NEW  (latest %d)" % NEW_QUEUE_CAP, new_ids, query, branch_filter, false
	) or any_shown
	any_shown = _build_available_section(available_groups, query, branch_filter) or any_shown

	_empty_label.visible = not any_shown
	if not any_shown:
		_empty_label.text = "No research matches your filters." if (not query.is_empty() or not branch_filter.is_empty()) else "No available research."


func _matches_filters(entry: Dictionary, query: String, branch_filter: String) -> bool:
	if not branch_filter.is_empty() and entry.get("branch", "") != branch_filter:
		return false
	if query.is_empty():
		return true
	var haystack: String = (
		String(entry.get("title", "")) + " " + String(entry.get("short_description", ""))
	).to_lower()
	return haystack.contains(query)


## Builds one section (header + card list) for a flat id list (IN PROGRESS / NEW). Returns
## whether anything was actually shown, so the caller can collapse an empty header per
## RESEARCH_UI_HANDOFF.md §3.2's "don't render an empty header" rule.
func _build_section(header_text: String, ids: Array[String], query: String, branch_filter: String, is_in_progress: bool) -> bool:
	var visible_ids: Array[String] = []
	for id: String in ids:
		var entry: Dictionary = _research_system.get_entry(id)
		if entry.is_empty():
			continue
		if _matches_filters(entry, query, branch_filter):
			visible_ids.append(id)
	if visible_ids.is_empty():
		return false

	_sections_container.add_child(_make_header(header_text))
	for id: String in visible_ids:
		var entry: Dictionary = _research_system.get_entry(id)
		var is_new: bool = not is_in_progress
		var card: Control = _create_entry_card(entry, is_in_progress, is_new)
		_sections_container.add_child(card)
	return true


## Resolves the AVAILABLE section's per-unit "continue chain or start here" cards
## (RESEARCH_UI_HANDOFF.md §3.1). Client-side approximation: no per-unit "most recently active"
## timestamp exists on the client, so every case (not just cold-start) falls back to branch
## order → tier ascending → cost ascending — documented simplification, flagged in this
## branch's report as a deviation from the literal "most-recently-active unit first" rule.
## Parameters:
## - excluded_ids: node ids already shown in the NEW section (never duplicated here).
## Returns: array of {representative_entry, group_entries, label} dictionaries, one per unit.
func _resolve_available_groups(excluded_ids: Array[String]) -> Array[Dictionary]:
	var groups: Array[Dictionary] = []
	if _research_system == null:
		return groups

	var entries_by_group: Dictionary = {}
	var group_order: Array[String] = []
	for raw_entry: Variant in _research_system.get_entries():
		var entry: Dictionary = raw_entry
		var entry_id: String = entry.get("id", "")
		if entry_id.is_empty() or excluded_ids.has(entry_id):
			continue
		if not _research_system.is_available(entry_id):
			continue
		var group_key: String = entry.get("unit_id", "")
		if group_key.is_empty():
			group_key = entry.get("path_id", "")
		if group_key.is_empty():
			group_key = entry_id
		if not entries_by_group.has(group_key):
			entries_by_group[group_key] = []
			group_order.append(group_key)
		entries_by_group[group_key].append(entry)

	for group_key: String in group_order:
		var group_entries: Array = entries_by_group[group_key]
		group_entries.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return int(a.get("tier", 0)) < int(b.get("tier", 0))
		)
		var best: Dictionary = group_entries[0]
		var has_prior_research: bool = false
		for raw_entry: Variant in _research_system.get_entries():
			var candidate: Dictionary = raw_entry
			var candidate_group: String = candidate.get("unit_id", "")
			if candidate_group.is_empty():
				candidate_group = candidate.get("path_id", "")
			if candidate_group == group_key and _research_system.is_researched(candidate.get("id", "")):
				has_prior_research = true
				break

		var mutex_group_id: String = best.get("mutex_group_id", "")
		var mutex_siblings: Array[Dictionary] = []
		if not mutex_group_id.is_empty():
			for raw_entry: Variant in group_entries:
				var candidate: Dictionary = raw_entry
				if candidate.get("mutex_group_id", "") == mutex_group_id:
					mutex_siblings.append(candidate)

		groups.append({
			"representative": best,
			"mutex_siblings": mutex_siblings,
			"is_continuing": has_prior_research,
		})

	groups.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var entry_a: Dictionary = a.get("representative", {})
		var entry_b: Dictionary = b.get("representative", {})
		var branch_a: int = BRANCH_ORDER.find(entry_a.get("branch", ""))
		var branch_b: int = BRANCH_ORDER.find(entry_b.get("branch", ""))
		if branch_a != branch_b:
			return branch_a < branch_b
		var tier_a: int = int(entry_a.get("tier", 0))
		var tier_b: int = int(entry_b.get("tier", 0))
		if tier_a != tier_b:
			return tier_a < tier_b
		var cost_a: Dictionary = entry_a.get("cost", {})
		var cost_b: Dictionary = entry_b.get("cost", {})
		return float(cost_a.get("money", 0)) < float(cost_b.get("money", 0))
	)
	return groups


func _build_available_section(groups: Array[Dictionary], query: String, branch_filter: String) -> bool:
	var visible_groups: Array[Dictionary] = []
	for group: Dictionary in groups:
		var entry: Dictionary = group.get("representative", {})
		if _matches_filters(entry, query, branch_filter):
			visible_groups.append(group)
	if visible_groups.is_empty():
		return false

	_sections_container.add_child(_make_header("AVAILABLE — your next step per unit"))
	var capped: Array[Dictionary] = visible_groups.slice(0, AVAILABLE_CARD_CAP)
	for group: Dictionary in capped:
		var mutex_siblings: Array = group.get("mutex_siblings", [])
		if mutex_siblings.size() > 1:
			_sections_container.add_child(_create_mutex_choice_card(group))
		else:
			var entry: Dictionary = group.get("representative", {})
			var card: Control = _create_entry_card(entry, false, false, group.get("is_continuing", false))
			_sections_container.add_child(card)
	if visible_groups.size() > AVAILABLE_CARD_CAP or capped.size() > 0:
		var link_button := Button.new()
		link_button.text = "View Full Tree →"
		link_button.flat = true
		link_button.pressed.connect(func() -> void: full_tree_requested.emit())
		_sections_container.add_child(link_button)
	return true


func _make_header(text: String) -> Label:
	var header := Label.new()
	header.text = text
	header.add_theme_font_size_override("font_size", 13)
	header.modulate = Color(0.82, 0.74, 0.58, 1)
	return header


## Creates one compact clickable card for a research entry. Every click opens the shared popup
## (Step 6) — nothing starts/cancels research directly from this card anymore.
## Parameters:
## - entry: normalized research entry dictionary from research_system.gd.
## - is_in_progress: true for IN PROGRESS section cards (shows live progress fill).
## - is_new: true for NEW section cards (adds a "🆕" marker).
## Returns: configured card control.
func _create_entry_card(entry: Dictionary, is_in_progress: bool, is_new: bool, is_continuing: bool = false) -> Control:
	var entry_id: String = entry.get("id", "")
	var legacy_state: String = _research_system.get_entry_state(entry_id)
	var state: String = ResearchCardStyle.resolve_state(legacy_state, is_in_progress)

	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size = Vector2(0, 96 if not is_in_progress else 76)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.add_theme_stylebox_override("panel", ResearchCardStyle.make_state_style(state))
	card.modulate = ResearchCardStyle.make_state_modulate(state)
	card.gui_input.connect(_on_entry_card_input.bind(entry_id))
	# Hover tooltip (RESEARCH_UI_HANDOFF.md §6.1) — see research_entry_card.gd's identical
	# native Control.tooltip_text choice for the same lightweight "orient before commit" layer.
	card.tooltip_text = "%s\n%s\nTier %d" % [
		entry.get("title", entry_id), entry.get("short_description", ""), int(entry.get("tier", 0)),
	]

	var margin: MarginContainer = MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var layout: VBoxContainer = VBoxContainer.new()
	layout.add_theme_constant_override("separation", 4)
	margin.add_child(layout)

	var title_row: HBoxContainer = HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 4)
	layout.add_child(title_row)

	if is_new:
		var new_marker := Label.new()
		new_marker.text = "🆕"
		title_row.add_child(new_marker)

	var badge_row: HBoxContainer = ResearchCardStyle.build_badge_row(entry.get("badges", []))
	title_row.add_child(badge_row)

	var title: Label = Label.new()
	title.text = entry.get("title", entry_id)
	title.add_theme_font_size_override("font_size", 15)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)

	var meta: Label = Label.new()
	var base_cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
	var multiplier: float = 1.0 + float(GameState.active_research_count) * RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR
	var money_cost: int = int(ceil(float(base_cost.get("money", 0)) * multiplier))
	var science_cost: int = int(ceil(float(base_cost.get("science", 0)) * multiplier))
	meta.text = "%s · Tier %d   $%d · SCI %d" % [entry.get("branch", "Research"), int(entry.get("tier", 0)), money_cost, science_cost]
	var affordable: bool = GameState.resources.get("money", 0.0) >= money_cost and GameState.science_points >= science_cost
	meta.modulate = COST_AFFORDABLE_COLOR if (affordable or is_in_progress) else COST_INSUFFICIENT_COLOR
	meta.add_theme_font_size_override("font_size", 11)
	layout.add_child(meta)

	if is_in_progress:
		var progress_bar: ProgressBar = ProgressBar.new()
		progress_bar.max_value = 1.0
		progress_bar.step = 0.001
		progress_bar.show_percentage = true
		progress_bar.value = _research_system.get_progress_ratio(entry_id)
		layout.add_child(progress_bar)
		_in_progress_bars[entry_id] = progress_bar
	elif not is_new:
		var status: Label = Label.new()
		status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		status.text = "continuing chain" if is_continuing else "start here"
		status.add_theme_font_size_override("font_size", 10)
		status.modulate = Color(0.7, 0.65, 0.55, 1.0)
		layout.add_child(status)

	return card


## Renders a mutex tier's whole choice-point as one bracketed card (RESEARCH_UI_HANDOFF.md
## §3.2 — "opens the multi-option popup on click"). Simplification: since research_node_popup.
## gd opens per-node (not a multi-option chooser), clicking opens the popup for the first
## listed option; the popup itself still shows that option's own mutex-conflict/description
## body, and Full Tree's mutex bracket (research_mutex_bracket.gd) is where every option is
## independently clickable. Documented as a deviation in this branch's report.
func _create_mutex_choice_card(group: Dictionary) -> Control:
	var siblings: Array = group.get("mutex_siblings", [])
	var first_entry: Dictionary = siblings[0]
	var names: Array[String] = []
	for sibling: Dictionary in siblings:
		names.append(sibling.get("title", sibling.get("id", "")))

	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size = Vector2(0, 84)
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	var mutex_style := StyleBoxFlat.new()
	mutex_style.bg_color = Color(0.12, 0.08, 0.05, 0.96)
	mutex_style.border_width_left = 3
	mutex_style.border_width_top = 3
	mutex_style.border_width_right = 3
	mutex_style.border_width_bottom = 3
	mutex_style.border_color = Color(0.84, 0.68, 0.30)
	mutex_style.corner_radius_top_left = 6
	mutex_style.corner_radius_top_right = 6
	mutex_style.corner_radius_bottom_left = 6
	mutex_style.corner_radius_bottom_right = 6
	card.add_theme_stylebox_override("panel", mutex_style)
	card.gui_input.connect(_on_entry_card_input.bind(String(first_entry.get("id", ""))))

	var margin: MarginContainer = MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var layout: VBoxContainer = VBoxContainer.new()
	margin.add_child(layout)

	var title := Label.new()
	title.text = "⚥ CHOOSE: %s" % " / ".join(names)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.add_theme_font_size_override("font_size", 14)
	layout.add_child(title)

	var meta := Label.new()
	meta.text = "%s · Tier %d — this tier only" % [first_entry.get("branch", ""), int(first_entry.get("tier", 0))]
	meta.add_theme_font_size_override("font_size", 11)
	meta.modulate = Color(0.7, 0.65, 0.55, 1.0)
	layout.add_child(meta)

	return card


## Diffs the current available-node set against the last known snapshot, pushing newly-
## available ids to the front of a capped 5-entry recency queue (RESEARCH_UI_HANDOFF.md §3.1).
## The very first call establishes a baseline without populating the queue, so match-start
## tier-1 nodes don't all falsely appear as "NEW".
func _update_new_recency_queue() -> void:
	var available_ids: Dictionary = {}
	for raw_entry: Variant in _research_system.get_entries():
		var entry: Dictionary = raw_entry
		var entry_id: String = entry.get("id", "")
		if not entry_id.is_empty() and _research_system.is_available(entry_id):
			available_ids[entry_id] = true

	if not _has_baseline_available_snapshot:
		_known_available_ids = available_ids.duplicate()
		_has_baseline_available_snapshot = true
		return

	for entry_id: Variant in available_ids.keys():
		if not _known_available_ids.has(entry_id):
			_new_recency_queue.erase(entry_id)
			_new_recency_queue.push_front(String(entry_id))

	# Age out anything no longer available (researched/locked again) and cap at 5.
	var still_valid: Array[String] = []
	for id: String in _new_recency_queue:
		if available_ids.has(id):
			still_valid.append(id)
	if still_valid.size() > NEW_QUEUE_CAP:
		still_valid.resize(NEW_QUEUE_CAP)
	_new_recency_queue = still_valid
	_known_available_ids = available_ids.duplicate()


func _on_entry_card_input(event: InputEvent, entry_id: String) -> void:
	if not event is InputEventMouseButton:
		return
	var mouse_event: InputEventMouseButton = event
	if mouse_event.button_index != MOUSE_BUTTON_LEFT or not mouse_event.pressed:
		return
	# Branch C — every click opens the shared popup; nothing starts/cancels research directly
	# from this card anymore (RESEARCH_UI_HANDOFF.md §6's governing rule).
	EventBus.research_node_popup_requested.emit(entry_id)
	accept_event()
