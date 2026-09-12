extends Control
## The shared research node popup — one instance, six body variants over one shell
## (hover-lite tooltips are a separate, much simpler control implemented directly on the
## cards, not part of this file — see research_entry_card.gd / research_drawer_panel.gd).
##
## Architecturally load-bearing: this Control is instantiated ONCE by game_hud.gd as a
## top-level overlay added LAST in the scene tree, and is NEVER registered through
## HUDManager — HUDManager.show_panel() closes any other open FULL_CENTER panel first, which
## would close Full Tree if this popup were registered as its own FULL_CENTER panel. Both the
## sidebar drawer and Full Tree open this same instance via EventBus.research_node_popup_
## requested(node_id), toggled through `.visible` only. See phase-11-task-c-ui-interaction.md's
## Critical Pre-Read for the full rationale.

const ResearchCardStyle = preload("res://src/systems/research/research_card_style.gd")

const _PANEL_MIN_SIZE: Vector2 = Vector2(460, 200)
const _IMAGE_HEIGHT: float = 140.0
const _VIGNETTE_COLOR: Color = Color(0.07, 0.05, 0.03, 1.0)

var _research_system: Node = null
var _current_node_id: String = ""
var _showing_cancel_confirmation: bool = false

# Shell
var _backdrop: ColorRect
var _box: PanelContainer
var _box_vbox: VBoxContainer
var _image_area: Control
var _header_image: TextureRect
var _vignette: TextureRect
var _title_row: HBoxContainer
var _badge_row: HBoxContainer
var _title_label: Label
var _state_tag_label: Label
var _subtitle_label: Label
var _body_scroll: ScrollContainer
var _body_vbox: VBoxContainer
var _description_label: Label
var _requires_label: Label
var _warning_label: Label
var _cost_label: Label
var _progress_bar: ProgressBar
var _cancel_summary_label: Label
var _footer: HBoxContainer
var _btn_left: Button
var _btn_right: Button


func _ready() -> void:
	_build_shell()
	if has_node("/root/EventBus"):
		EventBus.research_node_popup_requested.connect(open_for_node)
	visible = false
	# Escape must close only this popup, not whatever's open underneath (Full Tree), per
	# docs/UI_UX_DESIGN.md §9.6's single recursive "close the topmost thing" rule. This popup is
	# deliberately not registered through HUDManager (see the class doc comment above), so
	# HUDManager's own _input()-based Escape handling has no idea this popup exists and would
	# otherwise consume the key first and close Full Tree instead. Godot calls _input() on nodes
	# in process-priority order (lower runs first, ties broken by tree order); HUDManager is an
	# autoload with the default priority 0, so a negative priority here guarantees this popup's
	# _input() runs first and — when it marks the event handled — HUDManager's _input() (and
	# research_tree_view.gd's _unhandled_input() Escape handling) never sees the key at all.
	process_priority = -100


func _input(event: InputEvent) -> void:
	if not visible:
		return
	if not event is InputEventKey:
		return
	var key_event: InputEventKey = event
	if not key_event.pressed or key_event.echo or key_event.physical_keycode != KEY_ESCAPE:
		return
	if _showing_cancel_confirmation:
		_on_cancel_confirmation_back()
	else:
		_close()
	get_viewport().set_input_as_handled()


func _process(_delta: float) -> void:
	# Smooth per-frame progress bar refresh while the Researching variant is open — mirrors
	# research_tree_view.gd's identical per-frame progress-only refresh. Skipped while the
	# Cancel-confirmation sub-step is showing (progress bar isn't part of that body).
	if not visible or _research_system == null or _current_node_id.is_empty() or _showing_cancel_confirmation:
		return
	if not _progress_bar.visible:
		return
	_progress_bar.value = _research_system.get_progress_ratio(_current_node_id)


## Injects the shared research system this popup reads node definitions/live state from.
## Parameters:
## - research_system: node exposing ResearchSystem methods (see research_system.gd).
## Returns: nothing.
func setup(research_system: Node) -> void:
	_research_system = research_system


## Opens the popup for a node, picking the correct body variant from its live state.
## Parameters:
## - node_id: research node identifier to display.
## Returns: nothing.
func open_for_node(node_id: String) -> void:
	if _research_system == null or node_id.is_empty():
		return
	_current_node_id = node_id
	_showing_cancel_confirmation = false
	visible = true
	_refresh_body()


func _close() -> void:
	visible = false
	_current_node_id = ""
	_showing_cancel_confirmation = false


func _build_shell() -> void:
	_backdrop = ColorRect.new()
	_backdrop.name = "Backdrop"
	_backdrop.color = Color(0, 0, 0, 0.55)
	_backdrop.anchor_right = 1.0
	_backdrop.anchor_bottom = 1.0
	_backdrop.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_backdrop.grow_vertical = Control.GROW_DIRECTION_BOTH
	_backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_backdrop)

	var center := CenterContainer.new()
	center.name = "Center"
	center.anchor_right = 1.0
	center.anchor_bottom = 1.0
	center.grow_horizontal = Control.GROW_DIRECTION_BOTH
	center.grow_vertical = Control.GROW_DIRECTION_BOTH
	center.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(center)

	_box = PanelContainer.new()
	_box.name = "Box"
	_box.custom_minimum_size = _PANEL_MIN_SIZE
	var box_style := StyleBoxFlat.new()
	box_style.bg_color = Color(0.09, 0.07, 0.045, 0.99)
	box_style.border_width_left = 2
	box_style.border_width_top = 2
	box_style.border_width_right = 2
	box_style.border_width_bottom = 2
	box_style.border_color = Color(0.6, 0.48, 0.28, 1.0)
	box_style.corner_radius_top_left = 4
	box_style.corner_radius_top_right = 4
	box_style.corner_radius_bottom_left = 4
	box_style.corner_radius_bottom_right = 4
	_box.add_theme_stylebox_override("panel", box_style)
	center.add_child(_box)

	_box_vbox = VBoxContainer.new()
	_box_vbox.name = "Layout"
	_box_vbox.add_theme_constant_override("separation", 0)
	_box.add_child(_box_vbox)

	# ── Image header + vignette (RESEARCH_UI_HANDOFF.md §6.2) ──────────────────────────────
	_image_area = Control.new()
	_image_area.name = "ImageArea"
	_image_area.custom_minimum_size = Vector2(0, _IMAGE_HEIGHT)
	_image_area.clip_contents = true
	_box_vbox.add_child(_image_area)

	_header_image = TextureRect.new()
	_header_image.name = "HeaderImage"
	_header_image.anchor_right = 1.0
	_header_image.anchor_bottom = 1.0
	_header_image.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_header_image.grow_vertical = Control.GROW_DIRECTION_BOTH
	_header_image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_header_image.stretch_mode = TextureRect.STRETCH_SCALE
	_image_area.add_child(_header_image)

	_vignette = TextureRect.new()
	_vignette.name = "Vignette"
	_vignette.anchor_left = 0.0
	_vignette.anchor_right = 1.0
	_vignette.anchor_top = 0.34
	_vignette.anchor_bottom = 1.0
	_vignette.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_vignette.texture = _build_vignette_texture()
	_vignette.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_vignette.stretch_mode = TextureRect.STRETCH_SCALE
	_image_area.add_child(_vignette)

	var content_margin := MarginContainer.new()
	content_margin.name = "ContentMargin"
	content_margin.add_theme_constant_override("margin_left", 18)
	content_margin.add_theme_constant_override("margin_top", 12)
	content_margin.add_theme_constant_override("margin_right", 18)
	content_margin.add_theme_constant_override("margin_bottom", 14)
	_box_vbox.add_child(content_margin)

	var content_vbox := VBoxContainer.new()
	content_vbox.name = "ContentVBox"
	content_vbox.add_theme_constant_override("separation", 8)
	content_margin.add_child(content_vbox)

	_title_row = HBoxContainer.new()
	_title_row.add_theme_constant_override("separation", 6)
	content_vbox.add_child(_title_row)

	_badge_row = HBoxContainer.new()
	_badge_row.add_theme_constant_override("separation", 2)
	_title_row.add_child(_badge_row)

	_title_label = Label.new()
	_title_label.add_theme_font_size_override("font_size", 18)
	_title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_title_row.add_child(_title_label)

	_state_tag_label = Label.new()
	_state_tag_label.add_theme_font_size_override("font_size", 13)
	_title_row.add_child(_state_tag_label)

	_subtitle_label = Label.new()
	_subtitle_label.modulate = Color(0.78, 0.70, 0.55, 1.0)
	_subtitle_label.add_theme_font_size_override("font_size", 13)
	content_vbox.add_child(_subtitle_label)

	content_vbox.add_child(HSeparator.new())

	_body_scroll = ScrollContainer.new()
	_body_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_body_scroll.custom_minimum_size = Vector2(0, 140)
	_body_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	content_vbox.add_child(_body_scroll)

	_body_vbox = VBoxContainer.new()
	_body_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body_vbox.add_theme_constant_override("separation", 8)
	_body_scroll.add_child(_body_vbox)

	_description_label = Label.new()
	_description_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_body_vbox.add_child(_description_label)

	_warning_label = Label.new()
	_warning_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_warning_label.modulate = Color(0.92, 0.55, 0.25, 1.0)
	_warning_label.visible = false
	_body_vbox.add_child(_warning_label)

	_requires_label = Label.new()
	_requires_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_requires_label.visible = false
	_body_vbox.add_child(_requires_label)

	_cost_label = Label.new()
	_body_vbox.add_child(_cost_label)

	_progress_bar = ProgressBar.new()
	_progress_bar.max_value = 1.0
	_progress_bar.step = 0.001
	_progress_bar.show_percentage = true
	_progress_bar.visible = false
	_body_vbox.add_child(_progress_bar)

	_cancel_summary_label = Label.new()
	_cancel_summary_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_cancel_summary_label.visible = false
	_body_vbox.add_child(_cancel_summary_label)

	content_vbox.add_child(HSeparator.new())

	# Footer — pinned outside the scroll area, never scrolls (RESEARCH_UI_HANDOFF.md §6.2's
	# explicit requirement). Reuses air_wing_spawn_panel.gd/air_wing_escort_picker_panel.gd's
	# plain-HBoxContainer Confirm/Cancel footer wiring shape, not their HUDManager registration.
	_footer = HBoxContainer.new()
	_footer.alignment = BoxContainer.ALIGNMENT_END
	_footer.add_theme_constant_override("separation", 8)
	content_vbox.add_child(_footer)

	_btn_left = Button.new()
	_footer.add_child(_btn_left)
	_btn_right = Button.new()
	_footer.add_child(_btn_right)

	_backdrop.gui_input.connect(_on_backdrop_input)


func _build_vignette_texture() -> GradientTexture2D:
	# Mirrors vision_system.gd's existing GradientTexture2D usage (a different purpose there —
	# fog-of-war mask) — confirms the engine feature is already used elsewhere in this
	# codebase; this is simply a new *use* of it for the popup header's image fade.
	var gradient := Gradient.new()
	gradient.set_color(0, Color(_VIGNETTE_COLOR.r, _VIGNETTE_COLOR.g, _VIGNETTE_COLOR.b, 0.0))
	gradient.set_color(1, Color(_VIGNETTE_COLOR.r, _VIGNETTE_COLOR.g, _VIGNETTE_COLOR.b, 1.0))
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_LINEAR
	texture.fill_from = Vector2(0, 0)
	texture.fill_to = Vector2(0, 1)
	texture.width = 4
	texture.height = 64
	return texture


func _on_backdrop_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_close()
		accept_event()


## Rebuilds the popup body for whichever of the six variants the current node's live state
## resolves to. Called on open, and again after Confirm/Cancel actions change state.
func _refresh_body() -> void:
	if _research_system == null or _current_node_id.is_empty():
		return
	var entry: Dictionary = _research_system.get_entry(_current_node_id)
	var legacy_state: String = _research_system.get_entry_state(_current_node_id)
	var active_ids: Array = _research_system.get_active_entry_ids()
	var is_active: bool = active_ids.has(_current_node_id)
	var state: String = ResearchCardStyle.resolve_state(legacy_state, is_active)

	_title_label.text = entry.get("title", _current_node_id)
	_subtitle_label.text = "%s%s" % [
		entry.get("branch", ""),
		(" → " + String(entry.get("path_id", "")).capitalize()) if not String(entry.get("path_id", "")).is_empty() else "",
	]
	_set_header_image(entry.get("image_asset", ""))
	_rebuild_badge_row(entry.get("badges", []))

	_warning_label.visible = false
	_requires_label.visible = false
	_progress_bar.visible = false
	_cancel_summary_label.visible = false
	_cost_label.visible = true
	_body_scroll.visible = true

	if _showing_cancel_confirmation and is_active:
		_populate_cancel_confirmation(entry)
		return

	match state:
		ResearchCardStyle.STATE_RESEARCHED:
			_populate_researched(entry)
		ResearchCardStyle.STATE_LOCKED:
			_populate_locked(entry)
		ResearchCardStyle.STATE_RESEARCHING:
			_populate_researching(entry)
		_:
			var conflict_id: String = _research_system.get_mutex_respec_conflict(_current_node_id)
			if not conflict_id.is_empty():
				_populate_mutex_conflict(entry, conflict_id)
			else:
				_populate_available(entry)


func _set_header_image(image_path: String) -> void:
	if image_path.is_empty() or not ResourceLoader.exists(image_path):
		_header_image.texture = null
		return
	_header_image.texture = load(image_path)


func _rebuild_badge_row(badges: Array) -> void:
	for child: Node in _badge_row.get_children():
		child.queue_free()
	var built_row: HBoxContainer = ResearchCardStyle.build_badge_row(badges)
	for child: Node in built_row.get_children().duplicate():
		built_row.remove_child(child)
		_badge_row.add_child(child)


## Prefers the fuller popup-only `full_description` text; falls back to the legacy stitched
## `description` field only when full_description is genuinely absent/empty (e.g. an editor-
## authored card that predates Branch A's short/full description split).
func _popup_description_text(entry: Dictionary) -> String:
	var full: String = entry.get("full_description", "")
	return full if not full.is_empty() else entry.get("description", "")


func _format_cost(entry: Dictionary) -> String:
	var cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
	return "Cost: $%d · SCI %d" % [int(cost.get("money", 0)), int(cost.get("science", 0))]


## Variant 2 — Available → Confirm/Cancel (RESEARCH_UI_HANDOFF.md §6.2).
func _populate_available(entry: Dictionary) -> void:
	_state_tag_label.text = ""
	_description_label.text = _popup_description_text(entry)
	_cost_label.text = _format_cost(entry)
	_populate_requires_list(entry)
	_wire_footer("Cancel", _close, "Confirm", _on_confirm_start)


## Variant 3 — Available mutex option with a respec conflict (RESEARCH_UI_HANDOFF.md §6.3).
func _populate_mutex_conflict(entry: Dictionary, conflict_node_id: String) -> void:
	_state_tag_label.text = ""
	_description_label.text = _popup_description_text(entry)
	var conflict_entry: Dictionary = _research_system.get_entry(conflict_node_id)
	var conflict_title: String = conflict_entry.get("title", conflict_node_id)
	_warning_label.visible = true
	_warning_label.text = "⚠ Researching this will un-research \"%s\" once complete. It stays active until then. No currency refunded." % conflict_title
	_cost_label.text = _format_cost(entry)
	_populate_requires_list(entry)
	_wire_footer("Cancel", _close, "Confirm", _on_confirm_start)


## Variant 4 — Locked → read-only (RESEARCH_UI_HANDOFF.md §6.4).
func _populate_locked(entry: Dictionary) -> void:
	_state_tag_label.text = "🔒 LOCKED"
	_description_label.text = _popup_description_text(entry)
	_cost_label.visible = false
	_populate_requires_list(entry)
	_wire_footer("", Callable(), "Close", _close)


## Variant 5 — Researched → read-only, no requirements block (RESEARCH_UI_HANDOFF.md §6.5).
func _populate_researched(entry: Dictionary) -> void:
	_state_tag_label.text = "✅ RESEARCHED"
	_description_label.text = _popup_description_text(entry)
	_cost_label.visible = false
	_wire_footer("", Callable(), "Close", _close)


## Variant 6 — Researching → progress + Cancel (RESEARCH_UI_HANDOFF.md §6.6).
func _populate_researching(entry: Dictionary) -> void:
	_state_tag_label.text = ""
	_description_label.text = _popup_description_text(entry)
	_cost_label.visible = false
	_progress_bar.visible = true
	_progress_bar.value = _research_system.get_progress_ratio(_current_node_id)
	_wire_footer("Cancel Research", _on_cancel_research_pressed, "Close", _close)


## Researching → Cancel Research sub-step: shows exact invested/refund/forfeit numbers before
## committing, per RESEARCH.md's Cancelling In-Progress Research rule and RESEARCH_UI_HANDOFF.
## md §6.6. Numbers come from GameState.research's live active_projects sample (server-computed
## progress% × cost), the refund-rate itself is a server-side constant never recomputed here.
func _populate_cancel_confirmation(entry: Dictionary) -> void:
	_state_tag_label.text = "⚠ CANCEL RESEARCH?"
	_body_scroll.visible = false
	_description_label.visible = false
	_cost_label.visible = false
	_progress_bar.visible = false
	_cancel_summary_label.visible = true

	var cost: Dictionary = entry.get("cost", {"money": 0, "science": 0})
	var progress_ratio: float = _research_system.get_progress_ratio(_current_node_id)
	# Fixed refund rate is a server-side balance constant (RESEARCH.md) — mirrored here only
	# for the pre-confirmation estimate the player sees; the server computes and returns the
	# authoritative refund/forfeit via CANCEL_RESEARCH's response / the next RESEARCH_UPDATES,
	# reported by the drawer/tree's existing "Cancelled: ... refunded X, forfeited Y" toast.
	const DISPLAY_REFUND_RATE_ESTIMATE: float = 0.5
	var invested_money: float = float(cost.get("money", 0)) * progress_ratio
	var invested_science: float = float(cost.get("science", 0)) * progress_ratio
	var refund_money: float = invested_money * DISPLAY_REFUND_RATE_ESTIMATE
	var refund_science: float = invested_science * DISPLAY_REFUND_RATE_ESTIMATE
	_cancel_summary_label.text = "%s — %d%% complete\n\nInvested so far: $%.1f · SCI %.1f\nEstimated refund: $%.1f · SCI %.1f\nEstimated forfeit: $%.1f · SCI %.1f\n\nProgress resets to 0%%. This cannot be undone. Exact numbers are confirmed by the server." % [
		entry.get("title", _current_node_id), int(roundf(progress_ratio * 100.0)),
		invested_money, invested_science,
		refund_money, refund_science,
		invested_money - refund_money, invested_science - refund_science,
	]
	_wire_footer("Back", _on_cancel_confirmation_back, "Confirm Cancel", _on_confirm_cancel_research)


func _populate_requires_list(entry: Dictionary) -> void:
	var requirement_rows: Array = _research_system.get_requirement_status(_current_node_id)
	if requirement_rows.is_empty():
		_requires_label.visible = false
		return
	var lines: Array[String] = ["Requires:"]
	for row: Dictionary in requirement_rows:
		lines.append("  %s %s" % ["✓" if row.get("met", false) else "✗", row.get("title", row.get("node_id", ""))])
	_requires_label.text = "\n".join(lines)
	_requires_label.visible = true


func _wire_footer(left_text: String, left_callback: Callable, right_text: String, right_callback: Callable) -> void:
	_disconnect_all(_btn_left.pressed)
	_disconnect_all(_btn_right.pressed)
	_btn_left.visible = not left_text.is_empty()
	if _btn_left.visible:
		_btn_left.text = left_text
		_btn_left.pressed.connect(left_callback)
	_btn_right.visible = not right_text.is_empty()
	if _btn_right.visible:
		_btn_right.text = right_text
		_btn_right.pressed.connect(right_callback)


func _disconnect_all(sig: Signal) -> void:
	for connection: Dictionary in sig.get_connections():
		sig.disconnect(connection.get("callable"))


func _on_confirm_start() -> void:
	CommandQueue.submit("START_RESEARCH", {"node_id": _current_node_id})
	_close()


func _on_cancel_research_pressed() -> void:
	_showing_cancel_confirmation = true
	_refresh_body()


func _on_cancel_confirmation_back() -> void:
	_showing_cancel_confirmation = false
	_refresh_body()


func _on_confirm_cancel_research() -> void:
	CommandQueue.submit("CANCEL_RESEARCH", {"node_id": _current_node_id})
	_close()
