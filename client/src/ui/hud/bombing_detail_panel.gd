extends PanelContainer

const GLYPH_SCENE        := preload("res://scenes/game/panels/unit_glyph_cell.tscn")
const STATUS_BARS_SCRIPT := preload("res://src/ui/hud/status_bars.gd")


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
	vbox.add_theme_constant_override("separation", 8)
	outer.add_child(vbox)

	var header := HBoxContainer.new()
	vbox.add_child(header)
	var icon_bg := Panel.new()
	icon_bg.custom_minimum_size = Vector2(26, 26)
	icon_bg.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var icon_style := StyleBoxFlat.new()
	icon_style.bg_color = Color(0.85, 0.50, 0.10, 1.0)
	icon_style.corner_radius_top_left     = 13
	icon_style.corner_radius_top_right    = 13
	icon_style.corner_radius_bottom_left  = 13
	icon_style.corner_radius_bottom_right = 13
	icon_bg.add_theme_stylebox_override("panel", icon_style)
	header.add_child(icon_bg)
	var icon := TextureRect.new()
	icon.texture = preload("res://assets/icons/fire-solid-full.svg")
	icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	icon.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 4)
	icon.modulate = Color(1.0, 1.0, 1.0, 0.95)
	icon_bg.add_child(icon)
	var title := Label.new()
	title.text = "BOMBING RUN"
	title.name = "TitleLabel"
	header.add_child(title)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.pressed.connect(_close)
	header.add_child(close_btn)


func populate(data: Dictionary) -> void:
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
	header.text = "%d × %s" % [count, _aircraft_label(atype)]
	section.add_child(header)

	var grid := GridContainer.new()
	grid.columns = 5
	var result := _build_run_grid(grid)
	var glyphs: Array   = result[0]
	var bars_list: Array = result[1]
	_populate_run_grid(glyphs, bars_list,
		run.get("grid_snapshot", []), run.get("hit_cells", []))
	section.add_child(grid)

	var ptype: String = run.get("pattern_type", "")
	var total_dmg: int = run.get("total_hp_damage", 0)
	var casualties_label := Label.new()
	casualties_label.text = "%s  ·  %d casualties" % [_pattern_label(ptype), total_dmg]
	section.add_child(casualties_label)

	vbox.add_child(section)
	return total_dmg


func _build_run_grid(container: GridContainer) -> Array:
	var glyphs    := []
	var bars_list := []
	for _i in range(25):
		var vbox := VBoxContainer.new()
		vbox.add_theme_constant_override("separation", 0)

		var glyph = GLYPH_SCENE.instantiate()
		glyph.set("unit_type", "")
		glyph.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		glyph.size_flags_vertical   = Control.SIZE_FILL | Control.SIZE_EXPAND
		vbox.add_child(glyph)
		glyphs.append(glyph)

		var bars = STATUS_BARS_SCRIPT.new()
		bars.custom_minimum_size = Vector2(0, 10)
		bars.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		bars.visible = false
		vbox.add_child(bars)
		bars_list.append(bars)

		container.add_child(vbox)
	return [glyphs, bars_list]


func _populate_run_grid(glyphs: Array, bars_list: Array,
		grid_snapshot: Array, hit_cells: Array) -> void:
	for i in range(glyphs.size()):
		glyphs[i].unit_type = ""
		glyphs[i].modulate  = Color(1, 1, 1, 1)
		glyphs[i].set("is_targeted", false)
		bars_list[i].visible = false

	# Legacy fallback: no snapshot, synthesise from hit_cells
	if grid_snapshot.is_empty() and not hit_cells.is_empty():
		for h in hit_cells:
			var idx: int = h.get("cell_index", -1)
			if idx < 0 or idx >= glyphs.size():
				continue
			glyphs[idx].unit_type = h.get("unit_type", "infantry")
			glyphs[idx].set("is_targeted", true)
		return

	# Apply full formation from snapshot
	for snap in grid_snapshot:
		var idx: int = snap.get("cell_index", -1)
		if idx < 0 or idx >= glyphs.size():
			continue
		var utype: String = snap.get("unit_type", "")
		if utype.is_empty():
			continue
		glyphs[idx].unit_type = utype
		glyphs[idx].set("incapacitated", snap.get("incapacitated", false))
		bars_list[idx].visible = true
		bars_list[idx].set("hp_pct",   snap.get("hp",          100.0) / 100.0)
		bars_list[idx].set("supp_pct", snap.get("suppression",   0.0) / 100.0)

	# Red overlay on cells that were actually hit
	for h in hit_cells:
		var idx: int = h.get("cell_index", -1)
		if idx >= 0 and idx < glyphs.size():
			glyphs[idx].set("is_targeted", true)


func _close() -> void:
	EventBus.bombing_detail_closed.emit()


func _find_vbox() -> VBoxContainer:
	for child in get_children():
		if child is MarginContainer:
			for c2 in child.get_children():
				if c2 is VBoxContainer:
					return c2
	return null


func _aircraft_label(atype: String) -> String:
	match atype:
		"cas_plane": return "CAS Plane"
		_: return atype.replace("_", " ").capitalize()


func _pattern_label(ptype: String) -> String:
	match ptype:
		"cas": return "CAS"
		"fighter_strafe": return "Fighter Strafe"
		_: return ptype.capitalize()


func _get_map_loader() -> Node:
	var ml2: MainLoop = Engine.get_main_loop()
	if ml2 == null:
		return null
	var root_node: Window = ml2.root
	var ml: Node = root_node.find_child("MapLoader", true, false)
	if ml == null:
		ml = preload("res://src/systems/map/map_loader.gd").new()
	return ml
