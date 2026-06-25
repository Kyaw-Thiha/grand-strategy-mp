extends Node
## Owns local prototype research state for the research tree.
## This is client-local until server-side research authority is implemented.

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

	var entry: Dictionary = get_entry(entry_id)
	var row: int = int(entry.get("row", 0))
	if row > 0 and not _is_previous_row_complete(row):
		return false

	return not _has_exclusive_conflict(entry_id)


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
	var entry: Dictionary = get_entry(entry_id)
	var science_value: int = int(entry.get("science_value", 0))
	if science_value <= 0:
		return 1.0 if is_researched(entry_id) else 0.0
	return clampf(get_progress_science_value(entry_id) / float(science_value), 0.0, 1.0)


## Returns the active entry id.
## Parameters: none.
## Returns: active research id, or empty string when none is active.
func get_active_entry_id() -> String:
	return _active_entry_id


## Returns a user-facing reason an entry cannot currently be researched.
## Parameters:
## - entry_id: identifier of the entry.
## Returns: rejection reason.
func get_unavailable_reason(entry_id: String) -> String:
	if not _entries_by_id.has(entry_id):
		return "Unknown research entry"

	var entry: Dictionary = get_entry(entry_id)
	var row: int = int(entry.get("row", 0))
	if row > 0 and not _is_previous_row_complete(row):
		return "Complete any research in the previous row first"

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
		if is_researched(other_entry_id) or other_progress > 0.0 or _started_entries.has(other_entry_id):
			return true

	return false


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


func _emit_research_rejected(entry_id: String, reason: String) -> void:
	if has_node("/root/EventBus"):
		EventBus.research_rejected.emit(entry_id, reason)
		EventBus.notification_requested.emit(reason, "warning")
