extends Node
## Owns local prototype research state for the research tree.
## This is client-local until server-side research authority is implemented.
##
## Phase 11 Branch A update: `start_research()`/`advance()` below remain for the offline/
## preview test harness (client/test/research_system_test.gd), but the live click path no
## longer calls them — CommandQueue routes START_RESEARCH to the server, and
## `sync_from_server_state()` overwrites this node's display dictionaries from
## GameState.research on every RESEARCH_INIT/RESEARCH_UPDATES broadcast. This node is now a
## display cache reflecting server truth, not the authority, for the real gameplay flow.

signal entries_changed()

const STATE_UNAVAILABLE: String = "full_dark"
const STATE_AVAILABLE: String = "dark"
const STATE_RESEARCHED: String = "normal"
const SCIENCE_VALUE_PER_SECOND: float = 1.0

var _entries_by_id: Dictionary = {}
var _entry_order: Array[String] = []
var _columns: Array[String] = []
var _rows: Array[int] = []
var _progress_by_id: Dictionary = {}
var _completed_entries: Dictionary = {}
var _started_entries: Dictionary = {}
var _active_entry_id: String = ""
# Every concurrently-active project's node_id (RESEARCH.md — no hard slot limit), distinct
# from _active_entry_id which Branch A kept as "the first one found" for its single-card
# highlight. Branch C's IN PROGRESS sidebar section needs the full set.
var _active_entry_ids: Array[String] = []

# ── Branch C: client-side progress interpolation ───────────────────────────────────────────
# The server ticks/broadcasts research progress once per second (game-server's research
# system TICK_MS = 1000), which produces a visibly stepped bar if rendered directly. These
# dictionaries let get_progress_ratio() interpolate between the last two known samples using
# frame delta, driven by a rate *estimated from consecutive samples* rather than a hardcoded
# client constant — see phase-11-task-c-ui-interaction.md's Context section.
var _active_points_total: Dictionary = {}       # node_id -> float
var _active_remaining_interp: Dictionary = {}   # node_id -> float, decays every _process()
var _active_remaining_rate: Dictionary = {}     # node_id -> estimated points/sec
var _active_remaining_last_raw: Dictionary = {} # node_id -> last raw server points_remaining
var _active_remaining_last_time: Dictionary = {}# node_id -> Time.get_ticks_msec()/1000.0 at last sample


## Loads research definitions from dictionaries.
## Parameters:
## - definitions: array of dictionaries with id, column, row, title, description, and science_value.
## Returns: true when at least one valid entry was loaded.
func load_from_definitions(definitions: Array) -> bool:
	_entries_by_id.clear()
	_entry_order.clear()
	_columns.clear()
	_rows.clear()
	_progress_by_id.clear()
	_completed_entries.clear()
	_started_entries.clear()
	_active_entry_id = ""

	for raw_definition: Variant in definitions:
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		var entry_id: String = definition.get("id", "")
		var column_name: String = definition.get("column", "")
		if entry_id.is_empty() or column_name.is_empty():
			continue

		var normalized_entry: Dictionary = {
			"id": entry_id,
			"column": column_name,
			"row": int(definition.get("row", 0)),
			"title": definition.get("title", entry_id),
			"description": definition.get("description", ""),
			"science_value": maxi(int(definition.get("science_value", 1)), 0),
			"exclusive_group": definition.get("exclusive_group", ""),
			"effects": definition.get("effects", {}),
			# Real per-node prerequisite ids (RESEARCH.md's adjacency-web rule — OR semantics,
			# available once ANY listed id is researched), when the source data provides them.
			# Distinct from "has_requires: false" (key absent entirely) so content that never
			# specifies requires falls back to the legacy row-adjacency heuristic below, rather
			# than being treated as prereq-free tier-1 content.
			"has_requires": definition.has("requires"),
			"requires": definition.get("requires", []),
			# Branch B — real {money, science} base cost, for the drawer/full-tree cards' live
			# concurrency-adjusted cost display and insufficient-funds check.
			"cost": definition.get("cost", {"money": 0, "science": 0}),
			# Branch C additions — carried through from research_tree_data_loader.gd's remapped
			# definitions (see its own doc comment) so the popup/badges/mutex bracket/Full Tree
			# left rail can read them without a second data pass. Not in Branch A's original
			# normalized_entry shape, which only needed enough for a flat card grid.
			"branch": definition.get("branch", ""),
			"unit_id": definition.get("unit_id", ""),
			"path_id": definition.get("path_id", ""),
			"tier": int(definition.get("tier", int(definition.get("row", 0)))),
			"mutex_group_id": definition.get("mutex_group_id", ""),
			"badges": definition.get("badges", []),
			"size": definition.get("size", "minor"),
			"short_description": definition.get("short_description", ""),
			"full_description": definition.get("full_description", ""),
			"image_asset": definition.get("image_asset", ""),
		}

		_entries_by_id[entry_id] = normalized_entry
		_entry_order.append(entry_id)
		_append_unique_column(column_name)
		_append_unique_row(int(normalized_entry["row"]))
		_progress_by_id[entry_id] = 0.0

	_sort_layout_axes()
	entries_changed.emit()
	return not _entry_order.is_empty()


## Advances the active research entry by generated science.
## Parameters:
## - delta_seconds: elapsed real time in seconds; currently converted at 1 science per second.
## Returns: nothing.
func advance(delta_seconds: float) -> void:
	if _active_entry_id.is_empty():
		return

	var entry: Dictionary = get_entry(_active_entry_id)
	var science_value: int = int(entry.get("science_value", 0))
	var current_progress: float = float(_progress_by_id.get(_active_entry_id, 0.0))
	var science_progress: float = maxf(delta_seconds, 0.0) * SCIENCE_VALUE_PER_SECOND
	var next_progress: float = current_progress + science_progress
	_progress_by_id[_active_entry_id] = minf(next_progress, float(science_value))

	_emit_research_progress(_active_entry_id)

	if science_value <= 0 or next_progress >= float(science_value):
		_complete_active_entry()

	entries_changed.emit()


## Overwrites this node's display dictionaries from server-authoritative research state
## (GameState.research), replacing whatever the local prototype simulation last computed.
## A sync, not a re-simulation — progress values come from the server's own tick, never
## recomputed locally.
## Parameters:
## - research_data: GameState.research's contents ({researched_node_ids, active_projects}).
## Returns: nothing.
func sync_from_server_state(research_data: Dictionary) -> void:
	_completed_entries.clear()
	for entry_id: Variant in research_data.get("researched_node_ids", []):
		var id: String = String(entry_id)
		if not _entries_by_id.has(id):
			continue
		_completed_entries[id] = true
		_progress_by_id[id] = float(get_entry(id).get("science_value", 0))

	_active_entry_id = ""
	_active_entry_ids.clear()
	var now: float = Time.get_ticks_msec() / 1000.0
	var seen_node_ids: Dictionary = {}
	for raw_project: Variant in research_data.get("active_projects", []):
		if not raw_project is Dictionary:
			continue
		var project: Dictionary = raw_project
		var node_id: String = project.get("node_id", "")
		if not _entries_by_id.has(node_id):
			continue
		seen_node_ids[node_id] = true
		var points_total: float = float(project.get("points_total", 1.0))
		var points_remaining: float = float(project.get("points_remaining", 0.0))
		_progress_by_id[node_id] = maxf(points_total - points_remaining, 0.0)
		_started_entries[node_id] = true
		_active_entry_ids.append(node_id)
		# Branch A's minimal display only highlighted one "active" card at a time even though
		# the server allows unlimited concurrent projects (RESEARCH.md — no hard slot limit).
		# _active_entry_id is kept only for legacy single-active callers; Branch C's UI reads
		# _active_entry_ids for the full set.
		if _active_entry_id.is_empty():
			_active_entry_id = node_id

		_active_points_total[node_id] = points_total
		if _active_remaining_last_time.has(node_id):
			var dt: float = now - float(_active_remaining_last_time[node_id])
			var raw_delta: float = float(_active_remaining_last_raw[node_id]) - points_remaining
			if dt > 0.0:
				_active_remaining_rate[node_id] = maxf(raw_delta / dt, 0.0)
		else:
			_active_remaining_rate[node_id] = 0.0
		_active_remaining_last_raw[node_id] = points_remaining
		_active_remaining_last_time[node_id] = now
		# Re-anchor the interpolated value to the fresh server sample every time one arrives —
		# corrects any drift the frame-by-frame decay accumulated since the last sample.
		_active_remaining_interp[node_id] = points_remaining

	# Drop interpolation bookkeeping for anything no longer active (completed or cancelled).
	for stale_id: Variant in _active_points_total.keys().duplicate():
		if not seen_node_ids.has(String(stale_id)):
			_active_points_total.erase(stale_id)
			_active_remaining_interp.erase(stale_id)
			_active_remaining_rate.erase(stale_id)
			_active_remaining_last_raw.erase(stale_id)
			_active_remaining_last_time.erase(stale_id)

	entries_changed.emit()


## Decays each active project's interpolated remaining-points value toward zero at its
## estimated per-second rate, giving the progress bars a smooth per-frame fill instead of the
## server's stepped once-per-second samples. Never lets the interpolated value run past what
## the next real sample will correct to (rate is re-estimated, and the value re-anchored, on
## every sync_from_server_state() call), so the worst case is a brief plateau if the network
## hiccups, never a runaway overshoot.
func _process(delta: float) -> void:
	for node_id: Variant in _active_remaining_interp.keys():
		var rate: float = float(_active_remaining_rate.get(node_id, 0.0))
		if rate <= 0.0:
			continue
		var remaining: float = float(_active_remaining_interp[node_id])
		_active_remaining_interp[node_id] = maxf(remaining - rate * delta, 0.0)


## Starts or resumes a research entry if it is available.
## Parameters:
## - entry_id: identifier of the entry to activate.
## Returns: true when the entry became active or was already researched.
func start_research(entry_id: String) -> bool:
	if not _entries_by_id.has(entry_id):
		_emit_research_rejected(entry_id, "Unknown research entry")
		return false

	if is_researched(entry_id):
		return true

	if not is_available(entry_id):
		_emit_research_rejected(entry_id, get_unavailable_reason(entry_id))
		return false

	_active_entry_id = entry_id
	_started_entries[entry_id] = true
	_emit_research_started(entry_id)

	var entry: Dictionary = get_entry(entry_id)
	if int(entry.get("science_value", 0)) <= 0:
		_complete_active_entry()

	entries_changed.emit()
	return true


## Returns the display state for a research entry.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: one of STATE_UNAVAILABLE, STATE_AVAILABLE, or STATE_RESEARCHED.
func get_entry_state(entry_id: String) -> String:
	if is_researched(entry_id):
		return STATE_RESEARCHED
	if is_available(entry_id):
		return STATE_AVAILABLE
	return STATE_UNAVAILABLE


## Returns a loaded research entry definition.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: entry dictionary, or an empty dictionary when missing.
func get_entry(entry_id: String) -> Dictionary:
	return _entries_by_id.get(entry_id, {})


## Returns all loaded entries in stable JSON order.
## Parameters: none.
## Returns: array of entry dictionaries.
func get_entries() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for entry_id: String in _entry_order:
		result.append(get_entry(entry_id))
	return result


## Returns the loaded research column names.
## Parameters: none.
## Returns: stable array of column names.
func get_columns() -> Array[String]:
	return _columns.duplicate()


## Returns the loaded research row numbers.
## Parameters: none.
## Returns: sorted array of row numbers.
func get_rows() -> Array[int]:
	return _rows.duplicate()


## Finds the entry occupying a specific column and row.
## Parameters:
## - column_name: displayed column/category name.
## - row: row index.
## Returns: entry dictionary, or empty dictionary when the table cell is empty.
func get_entry_at(column_name: String, row: int) -> Dictionary:
	for entry_id: String in _entry_order:
		var entry: Dictionary = get_entry(entry_id)
		if entry.get("column", "") == column_name and int(entry.get("row", -1)) == row:
			return entry
	return {}


## Returns whether an entry has completed.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: true if researched.
func is_researched(entry_id: String) -> bool:
	return _completed_entries.has(entry_id)


## Returns whether an entry can be started or resumed.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: true if row prerequisites and exclusivity allow it.
func is_available(entry_id: String) -> bool:
	if not _entries_by_id.has(entry_id) or is_researched(entry_id):
		return false

	if not _prerequisites_met(entry_id):
		return false

	return not _has_exclusive_conflict(entry_id)


## Checks real per-node prerequisites (RESEARCH.md's adjacency-web rule — OR semantics,
## satisfied once ANY listed requires id is researched) when the source data provides them;
## falls back to the legacy "any entry in the previous row is researched" heuristic for
## content authored without explicit requires (e.g. client/test/research_system_test.gd).
func _prerequisites_met(entry_id: String) -> bool:
	var entry: Dictionary = get_entry(entry_id)
	if entry.get("has_requires", false):
		var requires: Array = entry.get("requires", [])
		if requires.is_empty():
			return true
		for req_id: Variant in requires:
			if is_researched(String(req_id)):
				return true
		return false

	var row: int = int(entry.get("row", 0))
	return row <= 0 or _is_previous_row_complete(row)


## Returns the saved progress amount for an entry.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: progress in science points.
func get_progress_science_value(entry_id: String) -> float:
	return float(_progress_by_id.get(entry_id, 0.0))


## Returns normalized progress for an entry.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: 0.0 to 1.0, or 1.0 for zero-duration completed entries.
func get_progress_ratio(entry_id: String) -> float:
	# Branch C — prefer the client-side interpolated sample for currently-active projects, so
	# progress bars fill smoothly between the server's once-per-second broadcasts instead of
	# stepping. Falls back to the legacy science_value-ratio path for anything not currently
	# an active project (researched/locked/available nodes have no interpolation state).
	if _active_points_total.has(entry_id):
		var total: float = float(_active_points_total[entry_id])
		if total <= 0.0:
			return 1.0
		var remaining: float = float(_active_remaining_interp.get(entry_id, 0.0))
		return clampf((total - remaining) / total, 0.0, 1.0)

	var entry: Dictionary = get_entry(entry_id)
	var science_value: int = int(entry.get("science_value", 0))
	if science_value <= 0:
		return 1.0 if is_researched(entry_id) else 0.0
	return clampf(get_progress_science_value(entry_id) / float(science_value), 0.0, 1.0)


## Returns the active entry id — the first concurrently-active project found, kept for legacy
## single-active callers. Prefer get_active_entry_ids() for the full concurrent set.
## Parameters: none.
## Returns: active research id, or empty string when none is active.
func get_active_entry_id() -> String:
	return _active_entry_id


## Returns every currently-active (in-progress) research node id, sorted soonest-to-complete
## first (ascending remaining points) — the sort order the IN PROGRESS sidebar section wants
## per RESEARCH_UI_HANDOFF.md §3.1.
## Parameters: none.
## Returns: array of node ids currently mid-research.
func get_active_entry_ids() -> Array[String]:
	var ids: Array[String] = _active_entry_ids.duplicate()
	ids.sort_custom(func(a: String, b: String) -> bool:
		return float(_active_remaining_interp.get(a, 0.0)) < float(_active_remaining_interp.get(b, 0.0))
	)
	return ids


## Returns a {node_id, met} array describing each of a node's prerequisites, for the Locked
## popup's ✓/✗ requirements checklist (RESEARCH_UI_HANDOFF.md §6.4).
## Parameters:
## - entry_id: identifier of the entry whose requirements to check.
## Returns: array of {"node_id": String, "title": String, "met": bool} dictionaries.
func get_requirement_status(entry_id: String) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var entry: Dictionary = get_entry(entry_id)
	for raw_req_id: Variant in entry.get("requires", []):
		var req_id: String = String(raw_req_id)
		var req_entry: Dictionary = get_entry(req_id)
		result.append({
			"node_id": req_id,
			"title": req_entry.get("title", req_id),
			"met": is_researched(req_id),
		})
	return result


## Returns a user-facing reason an entry cannot currently be researched.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: rejection reason.
func get_unavailable_reason(entry_id: String) -> String:
	if not _entries_by_id.has(entry_id):
		return "Unknown research entry"

	if not _prerequisites_met(entry_id):
		return "Complete a required prerequisite first"

	if _has_exclusive_conflict(entry_id):
		return "Another exclusive research path is already selected"

	return "Research is not available"


func _append_unique_column(column_name: String) -> void:
	if not _columns.has(column_name):
		_columns.append(column_name)


func _append_unique_row(row: int) -> void:
	if not _rows.has(row):
		_rows.append(row)


func _sort_layout_axes() -> void:
	_rows.sort()


func _is_previous_row_complete(row: int) -> bool:
	var previous_row: int = row - 1
	for entry_id: String in _entry_order:
		var entry: Dictionary = get_entry(entry_id)
		if int(entry.get("row", -1)) == previous_row and is_researched(entry_id):
			return true
	return false


## Branch C fix: a mutex tier's options must stay clickable even after a sibling completes —
## RESEARCH.md's Respec rule explicitly allows re-selecting a different option at an already-
## decided mutex tier (old perk stays active until the new one completes, then is displaced,
## no refund). Only an option ALREADY mid-research at this tier blocks its siblings (you can't
## run two mutex options concurrently) — a merely RESEARCHED sibling is a respec candidate, not
## a hard lock, and surfaces as the mutex-conflict warning popup instead (research_node_popup.gd
## variant 3 / RESEARCH_UI_HANDOFF.md §6.3), never a Locked state.
func _has_exclusive_conflict(entry_id: String) -> bool:
	var entry: Dictionary = get_entry(entry_id)
	var exclusive_group: String = entry.get("exclusive_group", "")
	if exclusive_group.is_empty():
		return false

	for other_entry_id: String in _entry_order:
		if other_entry_id == entry_id:
			continue
		var other_entry: Dictionary = get_entry(other_entry_id)
		if other_entry.get("exclusive_group", "") != exclusive_group:
			continue
		var other_progress: float = float(_progress_by_id.get(other_entry_id, 0.0))
		if (other_progress > 0.0 or _started_entries.has(other_entry_id)) and not is_researched(other_entry_id):
			return true

	return false


## Returns the id of a mutex-group sibling that is already researched (a respec candidate) for
## the given node, or "" when there is none. Used by research_node_popup.gd to decide between
## the plain Confirm/Cancel body and the mutex-conflict warning body (RESEARCH_UI_HANDOFF.md
## §6.2 vs §6.3).
## Parameters:
## - entry_id: identifier of the entry being opened in the popup.
## Returns: the displaced sibling's node id, or an empty string.
func get_mutex_respec_conflict(entry_id: String) -> String:
	var entry: Dictionary = get_entry(entry_id)
	var exclusive_group: String = entry.get("exclusive_group", "")
	if exclusive_group.is_empty():
		return ""
	for other_entry_id: String in _entry_order:
		if other_entry_id == entry_id:
			continue
		var other_entry: Dictionary = get_entry(other_entry_id)
		if other_entry.get("exclusive_group", "") != exclusive_group:
			continue
		if is_researched(other_entry_id):
			return other_entry_id
	return ""


func _complete_active_entry() -> void:
	var completed_entry_id: String = _active_entry_id
	if completed_entry_id.is_empty():
		return

	var entry: Dictionary = get_entry(completed_entry_id)
	_completed_entries[completed_entry_id] = true
	_progress_by_id[completed_entry_id] = float(entry.get("science_value", 0))
	_active_entry_id = ""
	_emit_research_completed(completed_entry_id, entry.get("effects", {}))


func _emit_research_started(entry_id: String) -> void:
	if has_node("/root/EventBus"):
		EventBus.research_started.emit(entry_id)


func _emit_research_progress(entry_id: String) -> void:
	if has_node("/root/EventBus"):
		EventBus.research_progress_changed.emit(entry_id, get_progress_ratio(entry_id))


func _emit_research_completed(entry_id: String, effects: Dictionary) -> void:
	if has_node("/root/EventBus"):
		EventBus.research_completed.emit(entry_id, effects)
		var entry: Dictionary = get_entry(entry_id)
		var title: String = entry.get("title", entry_id)
		EventBus.notification_requested.emit("Research complete: " + title, "research")


func _emit_research_rejected(entry_id: String, reason: String) -> void:
	if has_node("/root/EventBus"):
		EventBus.research_rejected.emit(entry_id, reason)
		EventBus.notification_requested.emit(reason, "warning")
