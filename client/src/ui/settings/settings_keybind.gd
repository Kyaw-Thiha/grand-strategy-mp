extends CanvasLayer
## Keybind settings overlay. Procedurally builds the action list from
## KeybindPresets.ACTIONS. Opened from the pause menu Settings button.

var _capturing_action: String = ""
var _capturing_button: Button = null
var _action_buttons: Dictionary = {}  # action → Button

var _dim: ColorRect
var _panel: PanelContainer
var _content_vbox: VBoxContainer


func _ready() -> void:
	layer = 11
	_build_shell()
	_build_action_rows()
	hide()


func show_panel() -> void:
	_refresh_all_buttons()
	show()


func hide_panel() -> void:
	_cancel_capture()
	hide()


# ---------------------------------------------------------------------------
# UI construction
# ---------------------------------------------------------------------------

func _build_shell() -> void:
	_dim = ColorRect.new()
	_dim.color = Color(0, 0, 0, 0.6)
	_dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)

	_panel = PanelContainer.new()
	_panel.custom_minimum_size = Vector2(680, 560)
	center.add_child(_panel)

	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 14)
	_panel.add_child(margin)

	var outer_vbox := VBoxContainer.new()
	margin.add_child(outer_vbox)

	# Title row
	var title_bar := HBoxContainer.new()
	outer_vbox.add_child(title_bar)

	var title := Label.new()
	title.text = "Keybind Settings"
	title.add_theme_font_size_override("font_size", 18)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_bar.add_child(title)

	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.custom_minimum_size = Vector2(32, 0)
	close_btn.pressed.connect(hide_panel)
	title_bar.add_child(close_btn)

	var title_sep := HSeparator.new()
	outer_vbox.add_child(title_sep)

	# Scroll area
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	outer_vbox.add_child(scroll)

	_content_vbox = VBoxContainer.new()
	_content_vbox.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_content_vbox)

	var bottom_sep := HSeparator.new()
	outer_vbox.add_child(bottom_sep)

	# Bottom bar
	var bottom_bar := HBoxContainer.new()
	bottom_bar.alignment = BoxContainer.ALIGNMENT_CENTER
	bottom_bar.add_theme_constant_override("separation", 12)
	outer_vbox.add_child(bottom_bar)

	var reset_default_btn := Button.new()
	reset_default_btn.text = "Reset to Default"
	reset_default_btn.pressed.connect(_on_reset_default)
	bottom_bar.add_child(reset_default_btn)

	var left_hand_btn := Button.new()
	left_hand_btn.text = "Reset to Left-Handed"
	left_hand_btn.pressed.connect(_on_reset_left_handed)
	bottom_bar.add_child(left_hand_btn)


func _build_action_rows() -> void:
	var current_category := ""

	for meta: Dictionary in KeybindPresets.ACTIONS:
		var category: String = meta.get("category", "")
		if category != current_category:
			current_category = category
			var spacer := Control.new()
			spacer.custom_minimum_size = Vector2(0, 10)
			_content_vbox.add_child(spacer)

			var header := Label.new()
			header.text = category.to_upper()
			header.add_theme_font_size_override("font_size", 11)
			header.add_theme_color_override("font_color", Color(0.7, 0.55, 0.3))
			_content_vbox.add_child(header)

		var action: String = meta.action
		var display: String = meta.get("display", action)
		var is_reserved: bool = meta.get("reserved", false)

		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		_content_vbox.add_child(row)

		var lbl := Label.new()
		lbl.text = display
		lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if is_reserved:
			lbl.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
		row.add_child(lbl)

		var key_btn := Button.new()
		key_btn.custom_minimum_size = Vector2(150, 0)
		key_btn.text = KeybindManager.get_action_display_text(action)
		if is_reserved:
			key_btn.disabled = true
		else:
			key_btn.pressed.connect(_on_key_button_pressed.bind(action, key_btn))
		row.add_child(key_btn)
		_action_buttons[action] = key_btn

		if not is_reserved:
			var clear_btn := Button.new()
			clear_btn.text = "✕"
			clear_btn.custom_minimum_size = Vector2(30, 0)
			clear_btn.pressed.connect(_on_clear_pressed.bind(action))
			row.add_child(clear_btn)


# ---------------------------------------------------------------------------
# Input capture
# ---------------------------------------------------------------------------

func _input(event: InputEvent) -> void:
	if _capturing_action == "" or not visible:
		return
	if not (event is InputEventKey):
		return
	var key: InputEventKey = event as InputEventKey
	if not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_ESCAPE:
		_cancel_capture()
		get_viewport().set_input_as_handled()
		return
	var ev: InputEventKey = key.duplicate() as InputEventKey
	ev.pressed = false
	KeybindManager.remap_action(_capturing_action, ev)
	_action_buttons[_capturing_action].text = KeybindManager.get_action_display_text(_capturing_action)
	_cancel_capture()
	get_viewport().set_input_as_handled()


# ---------------------------------------------------------------------------
# Signal handlers
# ---------------------------------------------------------------------------

func _on_key_button_pressed(action: String, btn: Button) -> void:
	if _capturing_action != "":
		_cancel_capture()
	_capturing_action = action
	_capturing_button = btn
	btn.text = "Press a key…"


func _on_clear_pressed(action: String) -> void:
	KeybindManager.remap_action(action, null)
	_action_buttons[action].text = "Unbound"


func _on_reset_default() -> void:
	KeybindManager.reset_to_default()
	_refresh_all_buttons()


func _on_reset_left_handed() -> void:
	KeybindManager.apply_preset(KeybindPresets.LEFT_HANDED)
	_refresh_all_buttons()


func _cancel_capture() -> void:
	if _capturing_button != null and _capturing_action != "":
		_capturing_button.text = KeybindManager.get_action_display_text(_capturing_action)
	_capturing_action = ""
	_capturing_button = null


func _refresh_all_buttons() -> void:
	for action: String in _action_buttons:
		_action_buttons[action].text = KeybindManager.get_action_display_text(action)
