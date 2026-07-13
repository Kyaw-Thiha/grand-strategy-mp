extends PanelContainer

const GLYPH_SCENE := preload("res://scenes/game/panels/unit_glyph_cell.tscn")
const DISMISS_SEC := 8.0

var _dismiss_timer: float = 0.0
var _progress_bar: TextureProgressBar


func _ready() -> void:
	_setup_ui()


func _setup_ui() -> void:
	var outer := MarginContainer.new()
	outer.add_theme_constant_override("margin_left", 12)
	outer.add_theme_constant_override("margin_right", 12)
	outer.add_theme_constant_override("margin_top", 12)
	outer.add_theme_constant_override("margin_bottom", 12)
	add_child(outer)

	var vbox := VBoxContainer.new()
	outer.add_child(vbox)

	var header := HBoxContainer.new()
	vbox.add_child(header)
	var icon := TextureRect.new()
	icon.texture = preload("res://assets/icons/fire-solid-full.svg")
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.custom_minimum_size = Vector2(20, 20)
	header.add_child(icon)
	var title := Label.new()
	title.text = "BOMBING RUN"
	title.name = "TitleLabel"
	header.add_child(title)
	header.add_child(HSeparator.new())
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.pressed.connect(_close)
	header.add_child(close_btn)

	_progress_bar = TextureProgressBar.new()
	_progress_bar.max_value = 1.0
	_progress_bar.value = 1.0
	_progress_bar.custom_minimum_size = Vector2(0, 6)
	vbox.add_child(_progress_bar)


func populate(data: Dictionary) -> void:
	_dismiss_timer = 0.0
	_progress_bar.value = 1.0

	var vbox := _find_vbox()
	if vbox == null:
		return

	var subtitle := Label.new()
	var province_id: String = data.get("province_id", "")
	if province_id.begins_with("div:"):
		subtitle.text = "Ground Attack"
	elif not province_id.is_empty():
		var province_data: Dictionary = _get_map_loader().get_province_data(province_id)
		subtitle.text = province_data.get("name", province_id)
	else:
		subtitle.text = province_id
	vbox.add_child(subtitle)

	var runs: Array = data.get("runs", [])
	var total_casualties := 0
	for run in runs:
		total_casualties += _add_run_section(vbox, run)

	if runs.size() > 1:
		var total_label := Label.new()
		total_label.text = "Total  ·  %d casualties" % total_casualties
		vbox.add_child(total_label)


func _add_run_section(vbox: VBoxContainer, run: Dictionary) -> int:
	var section := VBoxContainer.new()

	var header := Label.new()
	var count: int = run.get("count", 0)
	var atype: String = run.get("aircraft_type", "")
	header.text = "%d × %s" % [count, atype.replace("_", " ").capitalize()]
	section.add_child(header)

	var ptype: String = run.get("pattern_type", "")
	var total_dmg: int = run.get("total_hp_damage", 0)

	if ptype != "direct":
		var grid := GridContainer.new()
		grid.columns = 5
		var cells := _build_run_grid(grid)
		_populate_run_grid(cells, run.get("hit_cells", []))
		section.add_child(grid)

	var casualties_label := Label.new()
	casualties_label.text = "%s  ·  %d casualties" % [ptype.capitalize(), total_dmg]
	section.add_child(casualties_label)

	vbox.add_child(section)
	return total_dmg


func _build_run_grid(container: GridContainer) -> Array:
	var result := []
	for i in range(25):
		var cell = GLYPH_SCENE.instantiate()
		container.add_child(cell)
		result.append(cell)
	return result


func _populate_run_grid(cells: Array, hit_cells: Array) -> void:
	for cell in cells:
		cell.unit_type = ""
		cell.modulate = Color(1, 1, 1, 1)
	var hit_set := {}
	for h in hit_cells:
		hit_set[h.cell_index] = h.hp_damage
	for i in range(cells.size()):
		if hit_set.has(i):
			cells[i].unit_type = "infantry"
			cells[i].modulate = Color(1.0, 0.2, 0.2, 0.9)


func _process(delta: float) -> void:
	_dismiss_timer += delta
	_progress_bar.value = 1.0 - (_dismiss_timer / DISMISS_SEC)
	if _dismiss_timer >= DISMISS_SEC:
		_close()


func _close() -> void:
	EventBus.bombing_detail_closed.emit()
	var ml: MainLoop = Engine.get_main_loop()
	if ml != null:
		var root_node: Window = ml.root
		var hud: Node = root_node.find_child("GameHUD", true, false)
		if hud != null and hud.has_method("_hide_bombing_detail"):
			hud._hide_bombing_detail()


func _find_vbox() -> VBoxContainer:
	for child in get_children():
		if child is MarginContainer:
			for c2 in child.get_children():
				if c2 is VBoxContainer:
					return c2
	return null


func _get_map_loader() -> Node:
	var ml2: MainLoop = Engine.get_main_loop()
	if ml2 == null:
		return null
	var root_node: Window = ml2.root
	var ml: Node = root_node.find_child("MapLoader", true, false)
	if ml == null:
		ml = preload("res://src/systems/map/map_loader.gd").new()
	return ml
