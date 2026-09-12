extends RefCounted
## Loads research tree node definitions from client/assets/data/research/<branch>.json,
## mirroring MapLoader._load_json's exact idiom, and remaps each node's field names to the
## Dictionary shape research_system.gd.load_from_definitions() already expects
## (id/column/row/title/description/science_value/exclusive_group/effects). Remapping here
## keeps research_system.gd itself untouched, per phase-11-task-a's stated preference.

const RESEARCH_DATA_DIR: String = "res://assets/data/research/"
const BRANCHES: Array[String] = ["armour", "infantry", "ordnance", "air", "naval", "economy_buildings", "general"]

# Branch A placeholder — the JSON schema's real cost.science is always 0 this branch (currency
# lands in Branch B). A flat nonzero value here keeps the local display's progress bar
# meaningful in the interim; Step 8e's server-sync overwrite is what will replace this once
# RESEARCH_UPDATES broadcasts start carrying real progress values.
const PLACEHOLDER_SCIENCE_VALUE: int = 4


## Loads every branch file and returns one flat array of remapped definitions ready for
## research_system.gd.load_from_definitions().
## Parameters: none.
## Returns: array of definition dictionaries (possibly empty if no files were found).
static func load_all_definitions() -> Array:
	var all_definitions: Array = []
	for branch: String in BRANCHES:
		for raw_node: Dictionary in _load_branch_file(branch):
			if raw_node.has("_comment"):
				continue
			all_definitions.append(_remap_node(raw_node))
	return all_definitions


static func _load_branch_file(branch: String) -> Array:
	var path: String = RESEARCH_DATA_DIR + branch + ".json"
	if not FileAccess.file_exists(path):
		push_warning("ResearchTreeDataLoader: file not found — %s" % path)
		return []
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_warning("ResearchTreeDataLoader: cannot open — %s" % path)
		return []
	var text: String = file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Array:
		push_warning("ResearchTreeDataLoader: expected a top-level JSON array — %s" % path)
		return []
	return parsed


static func _remap_node(raw_node: Dictionary) -> Dictionary:
	var branch: String = raw_node.get("branch", "")
	var path_id: String = raw_node.get("path_id", "")
	var tier: int = int(raw_node.get("tier", 0))
	var short_description: String = raw_node.get("short_description", "")
	var full_description: String = raw_node.get("description", "")
	var cost: Dictionary = raw_node.get("cost", {})
	var mutex_group_id_raw: Variant = raw_node.get("mutex_group_id", null)
	return {
		"id": raw_node.get("id", ""),
		"column": "%s / %s" % [branch, path_id],
		"row": tier,
		"title": raw_node.get("name", raw_node.get("id", "")),
		# Card text uses the short, glance-friendly copy (RESEARCH_UI_HANDOFF.md §5/§6.1) — the
		# fuller "description" is carried through separately below for Branch C's popup body,
		# not shown on the card itself.
		"description": "%s · Tier %d\n\n%s" % [branch, tier, short_description],
		"science_value": PLACEHOLDER_SCIENCE_VALUE if int(cost.get("science", 0)) <= 0 else int(cost.get("science", 0)),
		"exclusive_group": raw_node.get("mutex_group_id", "") if raw_node.get("mutex_group_id", null) != null else "",
		"effects": {"raw": raw_node.get("effects", [])},
		# Fields beyond research_system.gd's own schema, carried through for future UI use
		# (Branch C's badges/size/requires-driven layout, and the popup's full description)
		# without needing another load pass.
		"branch": branch,
		"badges": raw_node.get("badges", []),
		"size": raw_node.get("size", "minor"),
		"requires": raw_node.get("requires", []),
		"short_description": short_description,
		"full_description": full_description,
		# Branch B — real {money, science} base cost, passed through for the drawer/full-tree
		# cards' live concurrency-adjusted cost display (research_system.gd.load_from_definitions
		# carries this straight into its normalized entry dictionary).
		"cost": cost,
		# Branch C additions — needed by the popup (image header, mutex warning body) and the
		# Full Tree left rail's per-unit grouping/sort (RESEARCH_UI_HANDOFF.md §3.1/§4.1).
		# Branch A's loader dropped these on the floor since its minimal card-only UI never
		# needed them; carried through here so research_system.gd's normalized entry (see its
		# load_from_definitions()) can pass them on to the card/popup layer.
		"unit_id": raw_node.get("unit_id", ""),
		"path_id": path_id,
		"tier": tier,
		"mutex_group_id": String(mutex_group_id_raw) if mutex_group_id_raw != null else "",
		"image_asset": raw_node.get("image_asset", ""),
	}
