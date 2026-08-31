extends PanelContainer
## Province Detail — full-center modal. One row per building type (Build at level 0,
## Upgrade at level >=1), no [Path>] column — perk trees are out of scope for this phase
## (ECONOMY_BUILDINGS.md's research-tree layer is deferred). Rows disable and show progress
## while their building_type is in the province's construction_queue.

signal close_requested()

const MAX_BUILDING_LEVEL := 5

# Human-readable labels for the 24 documented building types — keep in sync with
# game-server/src/data/building_stats.ts's BUILDING_TYPES. "town_hall" displays as
# "Command Post" per user direction — display-only rename, the underlying key/mechanic
# (population-to-VP weighting, ECONOMY_BUILDINGS.md) is unchanged. Note: ECONOMY_BUILDINGS.md's
# Out of Scope list already separately references a future, distinct "command post" building
# concept (radius mechanics) — this rename reuses that name for town_hall's existing effect,
# which may need reconciling once that real building gets designed.
const BUILDING_LABELS := {
	"fort": "Fort", "port": "Port", "airbase": "Airbase", "supply_hub": "Supply Hub",
	"factory": "Factory", "radar": "Radar", "barracks": "Barracks", "tank_plant": "Tank Plant",
	"ordnance_factory": "Ordnance Factory", "aircraft_factory": "Aircraft Factory",
	"school": "School", "hospital": "Hospital", "warehouse": "Warehouse / Depot",
	"shipyard": "Shipyard", "town_hall": "Command Post",
	"res_grain": "Grain Farm", "res_iron": "Iron Mine", "res_oil": "Oil Derrick",
	"res_rubber": "Rubber Plantation", "res_nitrates": "Nitrate Works",
	"res_tungsten": "Tungsten Mine", "res_chromium": "Chromium Mine",
	"res_aluminium": "Bauxite Mine + Refinery", "res_uranium": "Uranium Mine",
}

# Building rows are grouped into named sections, each separated by a heading + horizontal
# rule, per user-confirmed UI layout.
const SECTIONS := [
	{"heading": "Military Production", "buildings": ["barracks", "tank_plant", "ordnance_factory", "aircraft_factory", "shipyard"]},
	{"heading": "Military", "buildings": ["airbase", "port", "fort", "supply_hub", "town_hall", "radar"]},
	{"heading": "Civilian", "buildings": ["factory", "school", "hospital", "warehouse"]},
	{"heading": "Resource", "buildings": ["res_grain", "res_iron", "res_oil", "res_rubber", "res_nitrates", "res_tungsten", "res_chromium", "res_aluminium", "res_uranium"]},
]

var _current_province_id: String = ""
# building_type -> { "level_label": Label, "action_slot": HBoxContainer } — rows are created
# ONCE per province and updated in place afterward. Rebuilding all 24 rows on every
# BUILDING_UPDATES tick (this used to run on every _refresh() call, and the server broadcasts
# that message every tick while ANY construction is active — see EconomyBuildingSystem.tick())
# was corrupting the ScrollContainer's scroll-extent computation via constant node churn
# (queue_free() defers actual removal, so rapid rebuilds could leave it sizing against a
# transiently stale child list) — that's what made the last row's bottom portion unclickable.
var _row_widgets: Dictionary = {}

@onready var _title: Label = %Title
@onready var _meta: Label = %Meta
@onready var _close_button: Button = %CloseButton
@onready var _rows_container: VBoxContainer = %RowsContainer


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	EventBus.province_detail_open_requested.connect(_on_open_requested)
	close_requested.connect(func() -> void: EventBus.province_detail_closed.emit())
	EventBus.province_economy_updated.connect(_on_province_economy_updated)


func _on_open_requested(province_id: String) -> void:
	_current_province_id = province_id
	# HUDManager only resizes this panel (and its Margin/VBox/Scroll descendants) when
	# show_panel() runs, but that resize doesn't finish propagating until a later frame.
	# Populating rows synchronously here made the ScrollContainer compute its scrollbar
	# range against a still-zero-height rect — and since nothing else re-triggers a layout
	# pass for a province with no active construction, that broken range stuck permanently,
	# silently swallowing clicks below whatever tiny page it had cached. Waiting for layout
	# to actually settle first avoids that.
	await get_tree().process_frame
	await get_tree().process_frame
	_rebuild_rows()


func _on_province_economy_updated(province_id: String) -> void:
	if province_id.is_empty() or province_id == _current_province_id:
		_update_rows_in_place()


## Full teardown + recreate — only called when a (possibly new) province is opened, never on
## a routine economy tick, so the ScrollContainer's child list stays stable while browsing.
func _rebuild_rows() -> void:
	if _current_province_id.is_empty():
		return
	_refresh_header()

	for child in _rows_container.get_children():
		child.queue_free()
	_row_widgets.clear()

	var econ: Dictionary = GameState.province_economy.get(_current_province_id, {})
	var buildings: Dictionary = econ.get("buildings", {})

	var first_section := true
	for section: Dictionary in SECTIONS:
		var section_buildings: Array = section["buildings"]
		var present: Array = section_buildings.filter(func(b: String) -> bool: return buildings.has(b))
		if present.is_empty():
			continue

		if not first_section:
			var separator_margin := MarginContainer.new()
			separator_margin.add_theme_constant_override("margin_top", 4)
			separator_margin.add_theme_constant_override("margin_bottom", 4)
			var separator := ColorRect.new()
			separator.custom_minimum_size = Vector2(0, 1)
			separator.color = Color(0.79, 0.60, 0.19, 0.4)
			separator_margin.add_child(separator)
			_rows_container.add_child(separator_margin)
		first_section = false

		var heading := Label.new()
		heading.text = String(section["heading"]).to_upper()
		heading.add_theme_font_size_override("font_size", 11)
		heading.add_theme_color_override("font_color", Color(0.96, 0.78, 0.38, 1.0))
		_rows_container.add_child(heading)

		for building_type: String in present:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 6)

			var name_label := Label.new()
			name_label.text = BUILDING_LABELS.get(building_type, building_type.capitalize())
			name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			name_label.clip_text = true  # long names must not force the row wider than the panel
			name_label.add_theme_font_size_override("font_size", 11)
			row.add_child(name_label)

			var level_label := Label.new()
			level_label.custom_minimum_size = Vector2(55, 0)
			level_label.add_theme_font_size_override("font_size", 11)
			row.add_child(level_label)

			var action_slot := HBoxContainer.new()
			action_slot.custom_minimum_size = Vector2(100, 0)
			row.add_child(action_slot)

			_rows_container.add_child(row)
			_row_widgets[building_type] = {"level_label": level_label, "action_slot": action_slot}

	_update_rows_in_place()


func _refresh_header() -> void:
	var province: Dictionary = GameState.get_province(_current_province_id)
	_title.text = province.get("name", _current_province_id).to_upper()
	_meta.text = "Pop %d | Ind %d | Infra %d" % [
		int(province.get("population", 0)),
		int(province.get("industry", 0)),
		int(province.get("infrastructure", 0)),
	]


## Updates every row's level text and action widget (button vs progress) in place — never
## adds/removes a ROW, only swaps each row's small action_slot's children, so the outer
## VBoxContainer's child count/order never changes on a routine economy tick.
func _update_rows_in_place() -> void:
	if _current_province_id.is_empty() or _row_widgets.is_empty():
		return
	_refresh_header()

	var econ: Dictionary = GameState.province_economy.get(_current_province_id, {})
	var buildings: Dictionary = econ.get("buildings", {})
	var resource_deposits: Dictionary = econ.get("resource_deposits", {})
	var construction_queue: Array = econ.get("construction_queue", [])
	var under_construction: Dictionary = {}
	for project: Dictionary in construction_queue:
		var pt: Dictionary = project
		under_construction[pt.get("building_type", "")] = pt

	for building_type: String in _row_widgets:
		if not buildings.has(building_type):
			continue
		var widgets: Dictionary = _row_widgets[building_type]
		var level: int = int(buildings[building_type])
		(widgets["level_label"] as Label).text = "Lv %d/%d" % [level, MAX_BUILDING_LEVEL]
		_populate_action_slot(
			widgets["action_slot"], building_type, level,
			under_construction.get(building_type), resource_deposits,
		)


## A resource-extraction building (building_type "res_<resource>") with zero local deposit
## for that resource is still a valid build per ECONOMY_BUILDINGS.md (it just produces zero
## output) — the Build/Upgrade button is disabled here purely as a UX nicety, not because the
## build is actually blocked by any documented rule.
func _has_zero_deposit(building_type: String, resource_deposits: Dictionary) -> bool:
	if not building_type.begins_with("res_"):
		return false
	var resource_type: String = building_type.substr(4)
	return float(resource_deposits.get(resource_type, 0)) <= 0.0


## Fills a row's small, persistent action_slot container with either a progress label or a
## Build/Upgrade button. Called on every economy update, but only ever touches this one leaf
## container — the outer row/VBoxContainer structure is never rebuilt (see _rebuild_rows()'s
## doc comment for why that distinction matters).
func _populate_action_slot(action_slot: HBoxContainer, building_type: String, level: int, active_project, resource_deposits: Dictionary) -> void:
	for child in action_slot.get_children():
		child.queue_free()

	if active_project != null:
		var project: Dictionary = active_project
		var total: float = float(project.get("points_total", 1))
		var remaining: float = float(project.get("points_remaining", 0))
		var pct: int = int(round(100.0 * (total - remaining) / max(total, 1.0)))
		var progress_label := Label.new()
		progress_label.text = "Building... %d%%" % pct
		progress_label.add_theme_font_size_override("font_size", 11)
		action_slot.add_child(progress_label)
	else:
		var btn := Button.new()
		if level >= MAX_BUILDING_LEVEL:
			btn.text = "Max"
			btn.disabled = true
		elif _has_zero_deposit(building_type, resource_deposits):
			btn.text = "Build" if level == 0 else "Upgrade"
			btn.disabled = true
			btn.tooltip_text = "No local deposit for this resource"
		else:
			btn.text = "Build" if level == 0 else "Upgrade"
			btn.pressed.connect(_on_build_pressed.bind(building_type))
		btn.custom_minimum_size = Vector2(85, 20)
		btn.add_theme_font_size_override("font_size", 11)
		action_slot.add_child(btn)


func _on_build_pressed(building_type: String) -> void:
	CommandQueue.submit("BUILD_BUILDING", {
		"province_id": _current_province_id,
		"building_type": building_type,
	})
