extends Control
## Loads real research tree content from JSON (client/assets/data/research/*.json), builds
## cards dynamically, and delegates runtime state to ResearchSystem — which is itself now a
## display cache reflecting server-synced GameState.research, not the sole authority
## (see research_system.gd's doc comment and event_bus.gd's research_updated signal).
##
## Phase 11 Branch C — adds seven branch tabs (Infantry/Ordnance/Armour/Air/Naval/Economy/
## General, copying diplomacy_panel.gd's TabBar/TabButtons pattern verbatim), a left-rail unit
## list per branch, wraps the node grid in research_tree_canvas.gd's pan/zoom Control, and
## routes every card click through the shared popup (EventBus.research_node_popup_requested)
## instead of submitting START_RESEARCH/CANCEL_RESEARCH directly.

signal close_requested()

const ResearchEntryCardScene: PackedScene = preload("res://scenes/systems/research/research_entry_card.tscn")
const ResearchTreeDataLoader = preload("res://src/systems/research/research_tree_data_loader.gd")
const ResearchCardStyle = preload("res://src/systems/research/research_card_style.gd")
# Referenced by script path rather than the ResearchTreeCanvas class_name — a fresh headless
# single-scene load (as used by this repo's `godot --headless --path client <scene>` checks)
# doesn't always have the global class-name cache warmed, while a preloaded script constant
# resolves reliably either way.
const ResearchTreeCanvas = preload("res://src/systems/research/research_tree_canvas.gd")
const ResearchMutexBracketScript = preload("res://src/systems/research/research_mutex_bracket.gd")

# Client-side display-only mirror of research_stats.ts's RESEARCH_CONCURRENCY_COST_STEP — see
# research_drawer_panel.gd's identical constant for the same rationale (display only, server
# remains authoritative on the actual charge).
const RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR: float = 0.25

# Branch tab order — matches the JSON "branch" field values and RESEARCH_UI_HANDOFF.md §4.1's
# stated tab order. Naval has no authored content yet (Branch A left it genuinely empty) and
# renders the literal "Coming Soon" empty-state per §4.5; the others have small Branch-A
# sample content sets and render those plainly rather than faking Coming Soon (this branch's
# documented judgment call — see phase-11-task-c-ui-interaction.md's Critical Pre-Read).
const BRANCH_ORDER: Array[String] = ["Infantry", "Ordnance", "Armour", "Air", "Naval", "Economy", "General"]

# Node card layout constants for the pan/zoom canvas — paths run horizontally (columns), tiers
# run vertically top-to-bottom (rows), per RESEARCH_UI_HANDOFF.md §2.
const CARD_WIDTH: float = 200.0
const CARD_HEIGHT: float = 130.0
const CARD_H_GAP: float = 36.0
const CARD_V_GAP: float = 48.0

@onready var _research_system: Variant = %ResearchSystem
@onready var _status_label: Label = %StatusLabel
@onready var _close_button: Button = %CloseButton
@onready var _tab_buttons: HBoxContainer = %TabButtons
@onready var _tab_bar: TabContainer = %TabBar
@onready var _main_body: HBoxContainer = %MainBody
@onready var _left_rail: VBoxContainer = %LeftRail
@onready var _search_box: LineEdit = %SearchBox
@onready var _unit_list: VBoxContainer = %UnitList
@onready var _toolbar: HBoxContainer = %Toolbar
@onready var _btn_zoom_out: Button = %BtnZoomOut
@onready var _btn_fit: Button = %BtnFit
@onready var _btn_zoom_in: Button = %BtnZoomIn
@onready var _canvas_viewport: Control = %CanvasViewport
@onready var _tree_canvas: Control = %TreeCanvas
@onready var _coming_soon_label: Label = %ComingSoonLabel
@onready var _arrow_up: Label = %ArrowUp
@onready var _arrow_down: Label = %ArrowDown
@onready var _arrow_left: Label = %ArrowLeft
@onready var _arrow_right: Label = %ArrowRight

var _entry_cards: Array[Variant] = []
# branch_name -> Array[node_id] (in JSON order), built once definitions load.
var _node_ids_by_branch: Dictionary = {}
# branch_name -> Dictionary[unit_id -> Array[node_id]]
var _node_ids_by_branch_unit: Dictionary = {}
# node_id -> Control card currently placed on the canvas (only the active branch's cards)
var _cards_by_node_id: Dictionary = {}
# Transient research_mutex_bracket.gd instances for the current branch — unlike cards these
# are recreated every _rebuild_branch_canvas() call and must be freed, not just reparented.
var _mutex_bracket_nodes: Array[Control] = []
var _current_branch: String = "Infantry"
var _current_unit_id: String = ""
var _has_done_initial_frontier_view: bool = false
# Monotonically incremented every time something schedules a (possibly deferred/polling) frontier
# -view application — _defer_frontier_view_after_layout() (branch switch, cold start) and
# _select_unit()'s own deferred call both bump this and capture their own value before awaiting.
# Whichever request is the LATEST when its await resolves is the only one allowed to actually
# apply a fit; an older, now-stale request (e.g. a branch-switch poll still in flight when the
# player has already switched to a different branch, or back again, before it settled) discards
# its late-arriving result instead of clobbering the current, correct view. Fixes an intermittent
# blank/near-empty canvas after rapid repeated branch-tab navigation (see this function's and
# _apply_default_frontier_view()'s call sites).
var _frontier_view_request_id: int = 0
# Ordered unit_id values matching %UnitList's current children ("" for the "All" button first,
# then each branch unit in the same order _rebuild_unit_list() built them) — lets Ctrl/Ctrl+Shift
# cycle the rail via the exact same _select_unit() path a click uses (see _cycle_rail_unit()'s
# doc comment).
var _rail_unit_order: Array[String] = []


## Loads real research definitions from JSON and builds one card per node.
## Parameters: none.
## Returns: nothing.
func _ready() -> void:
	_research_system.entries_changed.connect(_refresh_tree)
	_close_button.pressed.connect(_request_close)
	_setup_tab_buttons()

	var definitions: Array = ResearchTreeDataLoader.load_all_definitions()
	_index_definitions_by_branch(definitions)

	if not _research_system.load_from_definitions(definitions):
		_status_label.text = "No research entries are authored yet."

	_build_cards(definitions)

	if has_node("/root/EventBus"):
		EventBus.research_updated.connect(_on_research_updated)
		# Branch B — live cost/affordability (set_live_cost/set_affordable) is only recomputed
		# inside _refresh_tree(). Without this, a passive money/science change would never
		# re-tint an unaffordable card until an unrelated research state change rebuilt it.
		EventBus.resources_updated.connect(_refresh_tree)

	_search_box.text_changed.connect(_on_rail_search_changed)
	# Same fix as research_drawer_panel.gd's sidebar search box — without this, typing in the
	# left rail's unit search leaks keystrokes to HUDManager's global hotkey _input() handler.
	_search_box.focus_entered.connect(func() -> void: EventBus.chat_input_focus_changed.emit(true))
	_search_box.focus_exited.connect(func() -> void: EventBus.chat_input_focus_changed.emit(false))
	_btn_zoom_out.pressed.connect(func() -> void: _tree_canvas.step_zoom(-ResearchTreeCanvas.ZOOM_STEP, _canvas_viewport.size))
	_btn_zoom_in.pressed.connect(func() -> void: _tree_canvas.step_zoom(ResearchTreeCanvas.ZOOM_STEP, _canvas_viewport.size))
	_btn_fit.pressed.connect(_on_fit_pressed)
	_tree_canvas.viewport_changed.connect(_update_edge_fade_arrows)
	visibility_changed.connect(_on_visibility_changed)

	_select_branch("Infantry")
	_refresh_tree()


func _process(_delta: float) -> void:
	# Cheap per-frame progress-bar-only refresh so the interpolated fill (research_system.gd)
	# animates smoothly instead of stepping once per server broadcast — see phase-11-task-c-ui-
	# interaction.md's Context note on progress bar smoothing.
	if not visible:
		return
	for entry_id: String in _research_system.get_active_entry_ids():
		var card: Variant = _cards_by_node_id.get(entry_id, null)
		if card != null:
			card.set_progress_ratio(_research_system.get_progress_ratio(entry_id))


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey:
		var key_event: InputEventKey = event
		if key_event.pressed and not key_event.echo and key_event.physical_keycode == KEY_ESCAPE:
			_request_close()
			return
		# Ctrl cycles forward through the left-rail unit list; Ctrl+Shift (or Shift held first,
		# then Ctrl) cycles backward — the player's own proposal, replacing an earlier Up/Down
		# arrow-key attempt that didn't work reliably and was reverted. Scoped narrowly: only
		# handled here (no project-wide InputMap action), and only while this panel is visible
		# and the rail search box doesn't hold keyboard focus, mirroring the guard the reverted
		# arrow-key handler used.
		#
		# Fires on the bare Ctrl key-down edge (pressed, not echo) rather than on release. This
		# repo's global keybind table (docs/UI_UX_DESIGN.md §9) already uses Ctrl as a modifier
		# for several combos — Ctrl +/- (zoom), Ctrl+F1-F8 (camera bookmarks), Ctrl+0-9 (control
		# groups) — so a player holding Ctrl to reach one of those while this panel happens to be
		# open would also trigger a rail-cycle on the Ctrl-down edge, before the second key lands.
		# This is accepted rather than engineered around (e.g. by deferring to Ctrl-release and
		# detecting whether another key was pressed meanwhile): Full Tree is a decision-heavy
		# modal that dims the map (docs/UI_UX_DESIGN.md §5.3), so a player simultaneously reaching
		# for a camera-bookmark/control-group/zoom hotkey while it is open is already a low-
		# probability edge case in this codebase's existing design, and is not worth the added
		# state-tracking complexity here.
		if visible and not _search_box.has_focus() and key_event.pressed and not key_event.echo:
			if key_event.physical_keycode == KEY_CTRL:
				_cycle_rail_unit(-1 if key_event.shift_pressed else 1)
				get_viewport().set_input_as_handled()


func _exit_tree() -> void:
	# Safety net mirroring chat_panel.gd's _exit_tree — clears the global input-block flag if
	# this view is torn down while the rail search box still holds focus.
	if _search_box != null and _search_box.has_focus() and has_node("/root/EventBus"):
		EventBus.chat_input_focus_changed.emit(false)


func _on_visibility_changed() -> void:
	if visible:
		if not _has_done_initial_frontier_view:
			_has_done_initial_frontier_view = true
			# Cold start (the very first ever open in a session) routes through here rather than
			# through _select_branch()'s _defer_frontier_view_after_layout() — _ready() already
			# ran once, hidden, back when HUDManager.register_panel() first parented this panel
			# (see hud_manager.gd's register_panel: add_child() then immediate hide()), so this is
			# the first time layout actually settles while visible. Cold-start settling involves
			# strictly more asynchronous work than a warm branch-tab switch (first-time card
			# instantiation already happened, but the left rail, TabBar and HUDManager's own
			# center-panel sizing are all being laid out live for the first time here), so it must
			# not assume a fixed frame count is enough — route through the same stability-polling
			# helper used for branch switches instead of a bespoke one-shot call_deferred.
			_defer_frontier_view_after_layout()
	else:
		# Issue D — reset so the NEXT open always starts fresh at the default frontier view
		# instead of resuming wherever the player last manually panned/zoomed to. This panel is a
		# persistent node toggled via HUDManager's visible flag (never re-instantiated), so
		# _tree_canvas's position/scale would otherwise carry over indefinitely across opens.
		# Deliberately scoped to camera state only — _current_branch/_current_unit_id are left
		# untouched, so which branch/unit tab is shown on reopen is unaffected by this reset.
		_has_done_initial_frontier_view = false


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


## Cycles between the seven branch tabs — routed here by HUDManager on Tab key press while
## this panel is open, per phase-11-task-c-ui-interaction.md's Critical Pre-Read.
## Parameters:
## - forward: true to move right, false to move left.
## Returns: nothing.
func cycle_sub_tab(forward: bool) -> void:
	var count: int = _tab_bar.get_tab_count()
	if count <= 1:
		return
	_tab_bar.current_tab = posmod(_tab_bar.current_tab + (1 if forward else -1), count)


## Wires the branch tab buttons to the hidden TabContainer — verbatim copy of diplomacy_panel.
## gd's _setup_tab_buttons()/cycle_sub_tab() idiom, per the Critical Pre-Read.
## Parameters: none.
## Returns: nothing.
func _setup_tab_buttons() -> void:
	if _tab_bar == null or _tab_buttons == null:
		return
	var button_group := ButtonGroup.new()
	for index: int in range(_tab_buttons.get_child_count()):
		var button: Button = _tab_buttons.get_child(index) as Button
		button.button_group = button_group
		button.pressed.connect(_on_tab_button_pressed.bind(index))
	_tab_bar.tab_changed.connect(_on_tab_changed)


func _on_tab_button_pressed(index: int) -> void:
	_tab_bar.current_tab = index


func _on_tab_changed(index: int) -> void:
	if index < 0 or index >= _tab_buttons.get_child_count():
		return
	var button: Button = _tab_buttons.get_child(index) as Button
	button.button_pressed = true
	if index >= 0 and index < BRANCH_ORDER.size():
		_select_branch(BRANCH_ORDER[index])


func _index_definitions_by_branch(definitions: Array) -> void:
	_node_ids_by_branch.clear()
	_node_ids_by_branch_unit.clear()
	for branch: String in BRANCH_ORDER:
		_node_ids_by_branch[branch] = []
		_node_ids_by_branch_unit[branch] = {}
	for raw_definition: Variant in definitions:
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		var branch: String = definition.get("branch", "")
		if not _node_ids_by_branch.has(branch):
			continue
		var node_id: String = definition.get("id", "")
		_node_ids_by_branch[branch].append(node_id)
		# Group by unit_id for the left rail; buildings (Economy) have no unit_id, so fall back
		# to path_id, then a flat "General" bucket, so the rail is never empty for those trees.
		var group_key: String = definition.get("unit_id", "")
		if group_key.is_empty():
			group_key = definition.get("path_id", "")
		if group_key.is_empty():
			group_key = "general"
		var unit_map: Dictionary = _node_ids_by_branch_unit[branch]
		if not unit_map.has(group_key):
			unit_map[group_key] = []
		unit_map[group_key].append(node_id)


func _build_cards(definitions: Array) -> void:
	for card: Variant in _entry_cards:
		card.queue_free()
	_entry_cards.clear()
	_cards_by_node_id.clear()

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
		card.entry_pressed.connect(_on_entry_pressed)
		_entry_cards.append(card)
		_cards_by_node_id[card.entry_id] = card


## Rebuilds the canvas for one branch: removes the previous branch's cards from the tree,
## instantiates cards for the new branch's node set (positioned by path_id column / tier row),
## and shows/hides the "Coming Soon" empty-stub per RESEARCH_UI_HANDOFF.md §4.5.
## Parameters:
## - branch: one of BRANCH_ORDER's values.
## Returns: nothing.
func _select_branch(branch: String) -> void:
	_reset_unit_selection_state()
	_current_branch = branch
	var node_ids: Array = _node_ids_by_branch.get(branch, [])
	var is_empty_branch: bool = node_ids.is_empty()

	_coming_soon_label.visible = is_empty_branch
	_tree_canvas.visible = not is_empty_branch
	_left_rail.visible = not is_empty_branch
	_toolbar.visible = not is_empty_branch
	_arrow_up.visible = false
	_arrow_down.visible = false
	_arrow_left.visible = false
	_arrow_right.visible = false

	_rebuild_unit_list(branch)
	_rebuild_branch_canvas(branch, node_ids)
	if not is_empty_branch:
		_defer_frontier_view_after_layout()


func _rebuild_unit_list(branch: String) -> void:
	for child: Node in _unit_list.get_children():
		child.queue_free()
	_rail_unit_order = [""]
	var unit_map: Dictionary = _node_ids_by_branch_unit.get(branch, {})
	var unit_keys: Array = unit_map.keys()
	unit_keys.sort()
	for unit_key: Variant in unit_keys:
		_rail_unit_order.append(String(unit_key))
	var all_button := Button.new()
	all_button.text = "● All"
	all_button.toggle_mode = true
	# Issue C — the theme's Button/styles/focus is an OPAQUE StyleBoxFlat (hud_dark.tres's
	# SB_btn_normal, same resource used for the plain "normal" state). Godot draws that focus
	# stylebox as an overlay ON TOP of whatever state style is already drawn whenever a Button
	# has_focus() — so the button most recently clicked (which both becomes button_pressed=true
	# AND grabs keyboard focus as an ordinary side effect of the mouse click) has its true
	# SB_btn_pressed gold-bordered "checked" look immediately masked by that opaque normal-look
	# overlay, making the actually-selected row look unselected while an unrelated row's "●"
	# (which only ever means "this unit has ≥1 researched node" per RESEARCH_UI_HANDOFF.md §4 —
	# not selection) draws attention elsewhere. These buttons don't need keyboard focus/navigation,
	# so removing focus entirely lets the real button_pressed styling render unmasked.
	all_button.focus_mode = Control.FOCUS_NONE
	# Reflect the *actual current selection* (_current_unit_id), not an unconditional default —
	# this rebuild re-runs on every _refresh_tree() (research/resource updates), and previously
	# always forced "All" pressed=true regardless of what the player had selected, silently
	# reverting the visible checked state even though filtering itself stayed correct.
	all_button.button_pressed = _current_unit_id.is_empty()
	var group := ButtonGroup.new()
	all_button.button_group = group
	all_button.pressed.connect(func() -> void: _select_unit(""))
	_unit_list.add_child(all_button)
	for unit_key: String in unit_keys:
		var ids: Array = unit_map[unit_key]
		var researched_count: int = 0
		for id: Variant in ids:
			if _research_system.is_researched(String(id)):
				researched_count += 1
		var filled: bool = researched_count > 0
		var button := Button.new()
		button.text = "%s %s %d/%d" % ["●" if filled else "○", unit_key.capitalize(), researched_count, ids.size()]
		button.toggle_mode = true
		button.focus_mode = Control.FOCUS_NONE # see all_button's focus_mode comment above
		button.button_group = group
		button.button_pressed = unit_key == _current_unit_id
		button.pressed.connect(_select_unit.bind(unit_key))
		_unit_list.add_child(button)


## Moves the left-rail unit selection to the previous/next entry in the currently-populated list
## (wrapping at the ends, matching cycle_sub_tab()'s posmod wrap behavior for consistency), then
## routes through _select_unit() — the exact same path a rail click uses — so it also correctly
## triggers the frontier-refit and checked-state styling already wired there instead of building
## a second parallel selection mechanism. Invoked by _unhandled_input()'s Ctrl/Ctrl+Shift handler.
## Parameters:
## - direction: -1 for previous (Ctrl+Shift), +1 for next (Ctrl).
## Returns: nothing.
func _cycle_rail_unit(direction: int) -> void:
	if _rail_unit_order.is_empty():
		return
	var current_index: int = _rail_unit_order.find(_current_unit_id)
	if current_index == -1:
		current_index = 0
	var new_index: int = posmod(current_index + direction, _rail_unit_order.size())
	_select_unit(_rail_unit_order[new_index])


func _select_unit(unit_id: String) -> void:
	_current_unit_id = unit_id
	# Scoped to the CURRENT branch's own node set only — not _cards_by_node_id.values(), which
	# holds every branch's cards for the whole session (see _build_cards()'s doc comment). Filtering
	# every branch's cards here left a stale visible=false on a DIFFERENT branch's cards once that
	# branch became active again (only its _rebuild_branch_canvas() reparents them, which never
	# resets Control.visible) — the exact cause of a blank "All" view after cycling to a specific
	# unit on one branch, then Tab-switching to another; see _reset_unit_selection_state()'s doc
	# comment for the belt-and-suspenders fix on the _select_branch() side.
	var branch_node_ids: Array = _node_ids_by_branch.get(_current_branch, [])
	for node_id: Variant in branch_node_ids:
		var card: Variant = _cards_by_node_id.get(String(node_id), null)
		var control: Control = card as Control
		if control == null:
			continue
		control.visible = unit_id.is_empty() or card.unit_id == unit_id or card.path_id == unit_id
	_apply_rail_selection_highlight()
	# Refocus the canvas to the newly selected unit's tree bounds — same "default frontier view"
	# used when Full Tree first opens, otherwise the camera position/zoom carries over from the
	# previously selected unit and the new unit's cards can land entirely off-screen. Deferred so
	# container/card visibility changes above have applied before bounds are measured, and routed
	# through the same request-id token as _defer_frontier_view_after_layout() so a stale deferred
	# call (e.g. this unit selection immediately followed by a branch switch) cannot overwrite a
	# newer, more current frontier fit — see _frontier_view_request_id's doc comment.
	_defer_frontier_view_after_unit_selection()


## One-frame-deferred counterpart of _defer_frontier_view_after_layout() for a unit-rail
## selection: unlike a branch switch, selecting a unit only toggles per-card visibility (no
## container resize to wait out), so a single deferred frame is enough for that visibility change
## to have applied before bounds are measured. Still shares _frontier_view_request_id with the
## branch-switch poller so whichever request is latest wins.
## Parameters: none.
## Returns: nothing.
func _defer_frontier_view_after_unit_selection() -> void:
	_frontier_view_request_id += 1
	var request_id: int = _frontier_view_request_id
	await get_tree().process_frame
	if is_instance_valid(self) and visible and request_id == _frontier_view_request_id:
		_apply_default_frontier_view()


## Applies _current_unit_id's checked state directly to the %UnitList buttons already in the
## tree, matching what a direct button click gets "for free" from Godot's own toggle_mode/
## ButtonGroup handling (clicking a toggle button flips its own button_pressed as an intrinsic
## side effect of the click, before the "pressed" signal handler — i.e. _select_unit() — ever
## runs). _cycle_rail_unit()'s Ctrl/Ctrl+Shift path calls _select_unit() directly with no real
## button click involved, so without this call the rail highlight only caught up whenever some
## unrelated _rebuild_unit_list() call (e.g. from _refresh_tree()) happened to re-run — visibly
## lagging behind the cycle instead of updating immediately. Relies on _rail_unit_order and
## %UnitList's children sharing the same order (both built together in _rebuild_unit_list()).
## Parameters: none.
## Returns: nothing.
func _apply_rail_selection_highlight() -> void:
	var children: Array = _unit_list.get_children()
	for index: int in range(mini(children.size(), _rail_unit_order.size())):
		var button: Button = children[index] as Button
		if button != null:
			button.button_pressed = _rail_unit_order[index] == _current_unit_id


## Resets all branch-local selection state to a known-good baseline before a branch switch does
## anything else — called at the very top of _select_branch(), before the rail rebuild, canvas
## rebuild, or frontier-view fit. Closes the whole bug class this "All view goes blank" symptom
## keeps recurring in (this is the third distinct cause in this area): rather than relying on
## every future code path that mutates per-card visibility to remember to scope itself correctly
## and to remember to undo its own effect on branch switch, this guarantees every card starts
## every branch selection fully visible and with no leftover unit filter, regardless of what the
## previously active branch/unit left behind.
## Parameters: none.
## Returns: nothing.
func _reset_unit_selection_state() -> void:
	_current_unit_id = ""
	for card: Variant in _cards_by_node_id.values():
		var control: Control = card as Control
		if control != null:
			control.visible = true


func _rebuild_branch_canvas(branch: String, node_ids: Array) -> void:
	# remove_child, not queue_free — cards are permanent instances owned by _cards_by_node_id/
	# _entry_cards (built once in _build_cards()); switching branches must not destroy them,
	# only reparent whichever set the canvas currently displays.
	for child: Node in _tree_canvas.get_children().duplicate():
		_tree_canvas.remove_child(child)
	for bracket: Control in _mutex_bracket_nodes:
		if is_instance_valid(bracket):
			bracket.queue_free()
	_mutex_bracket_nodes.clear()

	if node_ids.is_empty():
		return

	# Column (path) positions assigned in first-seen order among this branch's nodes.
	var path_columns: Dictionary = {}
	var next_column: int = 0
	var max_row: int = 0
	var content_rect := Rect2()
	var first := true
	# mutex_group_id -> Array[Control] — collected while placing cards, used below to draw one
	# research_mutex_bracket.gd bracket spanning each mutex tier's option columns.
	var mutex_groups: Dictionary = {}

	for node_id: Variant in node_ids:
		var id: String = String(node_id)
		var entry: Dictionary = _research_system.get_entry(id)
		var card: Variant = _cards_by_node_id.get(id, null)
		if card == null:
			continue

		var path_key: String = entry.get("path_id", id)
		if not path_columns.has(path_key):
			path_columns[path_key] = next_column
			next_column += 1
		var column: int = path_columns[path_key]
		var row: int = int(entry.get("tier", 0))
		max_row = maxi(max_row, row)

		var control: Control = card as Control
		control.position = Vector2(
			column * (CARD_WIDTH + CARD_H_GAP),
			row * (CARD_HEIGHT + CARD_V_GAP),
		)
		control.custom_minimum_size = Vector2(CARD_WIDTH, CARD_HEIGHT)
		control.size = Vector2(CARD_WIDTH, CARD_HEIGHT)
		# add_child first — apply_entry_metadata()/apply_runtime_state() below touch @onready
		# child controls that only resolve once this card is actually inside the scene tree.
		_tree_canvas.add_child(control)
		card.apply_entry_metadata(entry)

		var card_rect := Rect2(control.position, Vector2(CARD_WIDTH, CARD_HEIGHT))
		content_rect = card_rect if first else content_rect.merge(card_rect)
		first = false

		var mutex_id: String = entry.get("mutex_group_id", "")
		if not mutex_id.is_empty():
			if not mutex_groups.has(mutex_id):
				mutex_groups[mutex_id] = []
			mutex_groups[mutex_id].append(control)

	_draw_mutex_brackets(mutex_groups)
	_tree_canvas.set_meta("content_bounds", content_rect)
	_apply_runtime_state_to_visible_cards()


## Wraps each mutex tier's option cards in a gold double-border bracket container
## (research_mutex_bracket.gd), per RESEARCH_UI_HANDOFF.md §5.1 — the mutex tier's one true
## structural exception, not a badge or size variant.
func _draw_mutex_brackets(mutex_groups: Dictionary) -> void:
	const PAD: float = 8.0
	for group_id: Variant in mutex_groups.keys():
		var group: Array = mutex_groups[group_id]
		if group.size() < 2:
			continue
		var group_rect := Rect2((group[0] as Control).position, (group[0] as Control).size)
		for control: Variant in group.slice(1):
			group_rect = group_rect.merge(Rect2((control as Control).position, (control as Control).size))

		var bracket := ResearchMutexBracketScript.new()
		bracket.position = group_rect.position - Vector2(PAD, PAD)
		bracket.size = group_rect.size + Vector2(PAD * 2.0, PAD * 2.0)
		bracket.option_count = group.size()
		bracket.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_tree_canvas.add_child(bracket)
		_tree_canvas.move_child(bracket, 0) # draw behind the option cards
		_mutex_bracket_nodes.append(bracket)

		var tick_positions: Array[float] = []
		for control: Variant in group:
			var c: Control = control
			tick_positions.append(c.position.x + c.size.x * 0.5 - bracket.position.x)
		bracket.set_option_centers(tick_positions)


## Waits for pending sibling-container layout to settle before applying the default frontier
## view. Rebuilding the unit list (_rebuild_unit_list, called just before this) can change
## _left_rail's width — different branches have differently-lengthed unit labels — which resizes
## _canvas_viewport through the shared MainBody HBoxContainer, but that resize is itself queued
## through Godot's own container sort/notification queue and is NOT guaranteed to have flushed by
## the time a single call_deferred here would run.
##
## Originally this waited a fixed two idle frames (empirically sufficient for a warm branch-tab
## switch — client/test/_tmp_issue_b_repro.gd, deleted after use — since only the rail's own
## resize was in flight). That fixed count proved insufficient for a cold start (the very first
## ever open in a session, reached via _on_visibility_changed instead of _select_branch()): more
## systems are settling for the first time there — HUDManager's own _center_panel() sizing,
## TabBar/TabButtons layout, and the left rail's first-ever build — and they don't all finish
## within two frames. Rather than guess a bigger fixed number, poll _canvas_viewport's size once
## per frame and only proceed once it has stopped changing between two consecutive frames (i.e.
## whatever is resizing it has actually finished), with a safety cap so a genuinely-still-
## animating layout can't spin this forever.
##
## Rapidly switching branch tabs (or a unit selection sandwiched between two branch switches) can
## leave an OLDER call to this function still awaiting the poll above when a NEWER one starts —
## _select_branch()/_select_unit() are synchronous and don't cancel an in-flight poll from a
## previous call. Guarded via _frontier_view_request_id: this function captures the token before
## awaiting and only applies its fit if no newer request has started in the meantime, so a stale
## poll's late-arriving result is discarded rather than being applied against whatever branch/unit
## is now actually selected.
## Parameters: none.
## Returns: nothing.
func _defer_frontier_view_after_layout() -> void:
	_frontier_view_request_id += 1
	var request_id: int = _frontier_view_request_id
	await _wait_for_canvas_viewport_size_to_stabilize()
	if is_instance_valid(self) and visible and request_id == _frontier_view_request_id:
		_apply_default_frontier_view()


## Polls %CanvasViewport's size once per frame until it reports the same size on two consecutive
## frames (layout has settled), or MAX_STABILITY_FRAMES is reached (safety cap in case something
## is legitimately still animating/resizing indefinitely).
## Parameters: none.
## Returns: nothing (resolves once stable or the frame cap is hit).
func _wait_for_canvas_viewport_size_to_stabilize() -> void:
	const MAX_STABILITY_FRAMES: int = 10
	await get_tree().process_frame
	if not is_instance_valid(self) or _canvas_viewport == null:
		return
	var last_size: Vector2 = _canvas_viewport.size
	for _i: int in range(MAX_STABILITY_FRAMES):
		await get_tree().process_frame
		if not is_instance_valid(self) or _canvas_viewport == null:
			return
		var current_size: Vector2 = _canvas_viewport.size
		if current_size == last_size:
			return
		last_size = current_size


func _apply_default_frontier_view() -> void:
	if not is_inside_tree() or not visible:
		return
	var bounds: Rect2 = _tree_canvas.get_meta("content_bounds", Rect2())
	if bounds.size.x <= 0.0:
		return
	# Frontier = researched + directly adjacent-available nodes only, not the whole tree, per
	# RESEARCH_UI_HANDOFF.md §4.2. Approximated here as the bounding box of every researched
	# node plus every currently-available node (their direct unlock neighbors) — a reasonable
	# reading of "frontier" without needing a full graph-adjacency walk for a first cut.
	var frontier_rect := Rect2()
	var first := true
	# Scoped to the current branch's own node set (matching what _rebuild_branch_canvas() just
	# parented into _tree_canvas), NOT all of _cards_by_node_id — that dictionary holds every
	# branch's cards for the whole session (see _build_cards()'s doc comment), and a card
	# belonging to a different, currently-unselected branch is still Control.visible == true by
	# Godot's own default even though it was never added to the tree / laid out this branch.
	# "All units" (_current_unit_id == "") never runs _select_unit()'s per-card visibility
	# filter to hide those other-branch cards (only a specific-unit selection incidentally does,
	# via its unit_id/path_id mismatch — which is why the per-unit case worked while All did
	# not), so without this scope the merge here pulled in every other branch's stale/default
	# (often Vector2.ZERO) position and blew the bounds out to a huge, wrongly-centered rect.
	var branch_node_ids: Array = _node_ids_by_branch.get(_current_branch, [])
	for node_id: Variant in branch_node_ids:
		var id: String = String(node_id)
		var card: Variant = _cards_by_node_id.get(id, null)
		var control: Control = card as Control
		if control == null or not control.visible:
			continue
		if _research_system.is_researched(id) or _research_system.is_available(id):
			var rect := Rect2(control.position, control.size)
			frontier_rect = rect if first else frontier_rect.merge(rect)
			first = false
	if first:
		frontier_rect = _tree_canvas.get_meta("content_bounds", Rect2())
	_tree_canvas.default_frontier_view(frontier_rect, _canvas_viewport.size)
	_update_edge_fade_arrows()


func _on_fit_pressed() -> void:
	var bounds: Rect2 = _tree_canvas.get_meta("content_bounds", Rect2())
	_tree_canvas.snap_to_fit(bounds, _canvas_viewport.size)


## Pure bounds comparison, no rendering pipeline — toggles the four edge-fade arrows based on
## whether content extends past the currently-visible canvas viewport, per RESEARCH_UI_HANDOFF.
## md §4.3.
## Parameters: none.
## Returns: nothing.
func _update_edge_fade_arrows() -> void:
	if _tree_canvas == null or not _tree_canvas.visible:
		return
	var content_bounds: Rect2 = _tree_canvas.get_meta("content_bounds", Rect2())
	if content_bounds.size.x <= 0.0:
		return
	var scale_factor: float = maxf(_tree_canvas.scale.x, 0.0001)
	var visible_bounds := Rect2(
		-_tree_canvas.position / scale_factor,
		_canvas_viewport.size / scale_factor,
	)
	_arrow_up.visible = content_bounds.position.y < visible_bounds.position.y
	_arrow_down.visible = content_bounds.end.y > visible_bounds.end.y
	_arrow_left.visible = content_bounds.position.x < visible_bounds.position.x
	_arrow_right.visible = content_bounds.end.x > visible_bounds.end.x


func _on_rail_search_changed(query: String) -> void:
	var q: String = query.to_lower()
	for card: Variant in _cards_by_node_id.values():
		var control: Control = card as Control
		if control == null or not control.visible:
			continue
		if q.is_empty():
			control.modulate = ResearchCardStyle.make_state_modulate(
				ResearchCardStyle.resolve_state(_research_system.get_entry_state(card.entry_id), false)
			)
			continue
		var haystack: String = (String(card.title) + " " + String(card.short_description)).to_lower()
		control.modulate = Color(1, 1, 1, 1) if haystack.contains(q) else Color(1, 1, 1, 0.35)


func _refresh_tree() -> void:
	_apply_runtime_state_to_visible_cards()

	var active_ids: Array[String] = _research_system.get_active_entry_ids()
	if active_ids.is_empty():
		_status_label.text = "Click an available entry to start or resume research."
	else:
		var names: Array[String] = []
		for id: String in active_ids:
			names.append(_research_system.get_entry(id).get("title", id))
		_status_label.text = "Researching: " + ", ".join(names)

	_rebuild_unit_list(_current_branch)


func _apply_runtime_state_to_visible_cards() -> void:
	var active_ids: Array = _research_system.get_active_entry_ids()
	for card: Variant in _entry_cards:
		var control: Control = card as Control
		# Cards not belonging to the currently-selected branch are instantiated (they live in
		# _entry_cards/_cards_by_node_id for the whole session) but never parented into the
		# tree, so their @onready child controls stay unset until they are. Skip those here —
		# they get a fresh apply_runtime_state() call from _rebuild_branch_canvas() the moment
		# their branch is selected.
		if control == null or not control.is_node_ready():
			continue
		var entry_id: String = card.entry_id
		if entry_id.is_empty():
			card.apply_runtime_state("full_dark", 0.0, false)
			continue

		var is_active: bool = active_ids.has(entry_id)
		card.apply_runtime_state(
			_research_system.get_entry_state(entry_id),
			_research_system.get_progress_ratio(entry_id),
			is_active
		)

		var entry: Dictionary = _research_system.get_entry(entry_id)
		var base_cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
		var multiplier: float = 1.0 + float(GameState.active_research_count) * RESEARCH_CONCURRENCY_COST_STEP_CLIENT_MIRROR
		var live_money_cost: int = int(ceil(float(base_cost.get("money", 0)) * multiplier))
		var live_science_cost: int = int(ceil(float(base_cost.get("science", 0)) * multiplier))
		card.set_live_cost(live_money_cost, live_science_cost)
		var affordable: bool = GameState.resources.get("money", 0.0) >= live_money_cost and GameState.science_points >= live_science_cost
		card.set_affordable(affordable or is_active)


func _on_research_updated() -> void:
	_research_system.sync_from_server_state(GameState.research)


func _on_entry_pressed(entry_id: String) -> void:
	# Branch C — every click opens the shared popup; nothing starts/cancels research directly
	# from a card anymore (RESEARCH_UI_HANDOFF.md §6's governing rule).
	EventBus.research_node_popup_requested.emit(entry_id)
