extends CanvasLayer
## General settings overlay. Builds a left-tab settings panel with Control,
## Sound, Display, Advanced, and Mods pages.

const PAGE_CONTROL: String = "control"
const PAGE_SOUND: String = "sound"
const PAGE_DISPLAY: String = "display"
const PAGE_ADVANCED: String = "advanced"
const PAGE_MODS: String = "mods"

const SIDEBAR_WIDTH: float = 150.0
const SETTINGS_PANEL_SIZE: Vector2 = Vector2(820.0, 580.0)

var _capturing_action: String = ""
var _capturing_button: Button = null
var _action_buttons: Dictionary = {}  # action -> Button
var _nav_buttons: Dictionary = {}     # page id -> Button
var _current_page: String = PAGE_CONTROL

var _dim: ColorRect
var _panel: PanelContainer
var _page_title: Label
var _page_content: VBoxContainer

var _overall_volume: float = 80.0
var _sfx_volume: float = 80.0
var _music_volume: float = 70.0
var _ui_scale: float = 100.0
var _fullscreen_enabled: bool = false
var _edge_scroll_enabled: bool = true
var _vim_mode_enabled: bool = false


func _ready() -> void:
	layer = 11
	_build_shell()
	_select_page(PAGE_CONTROL)
	hide()


## Shows the settings panel and refreshes the current page.
## Parameters: none.
## Returns: nothing.
func show_panel() -> void:
	_refresh_all_buttons()
	_select_page(_current_page)
	show()


## Hides the settings panel and cancels any active key capture.
## Parameters: none.
## Returns: nothing.
func hide_panel() -> void:
	_cancel_capture()
	hide()


func _build_shell() -> void:
	_dim = ColorRect.new()
	_dim.color = Color(0, 0, 0, 0.6)
	_dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_dim.gui_input.connect(_on_dim_input)
	add_child(_dim)

	var center: CenterContainer = CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)

	_panel = PanelContainer.new()
	_panel.custom_minimum_size = SETTINGS_PANEL_SIZE
	center.add_child(_panel)

	var margin: MarginContainer = MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 14)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_bottom", 14)
	_panel.add_child(margin)

	var outer_vbox: VBoxContainer = VBoxContainer.new()
	outer_vbox.add_theme_constant_override("separation", 10)
	margin.add_child(outer_vbox)

	var title_bar: HBoxContainer = HBoxContainer.new()
	outer_vbox.add_child(title_bar)

	var title: Label = Label.new()
	title.text = "Settings"
	title.add_theme_font_size_override("font_size", 20)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_bar.add_child(title)

	var close_btn: Button = Button.new()
	close_btn.text = "X"
	close_btn.custom_minimum_size = Vector2(32.0, 30.0)
	close_btn.pressed.connect(hide_panel)
	title_bar.add_child(close_btn)

	var separator: HSeparator = HSeparator.new()
	outer_vbox.add_child(separator)

	var body: HBoxContainer = HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 12)
	outer_vbox.add_child(body)

	var sidebar: VBoxContainer = VBoxContainer.new()
	sidebar.custom_minimum_size = Vector2(SIDEBAR_WIDTH, 0.0)
	sidebar.add_theme_constant_override("separation", 6)
	body.add_child(sidebar)

	_add_nav_button(sidebar, PAGE_CONTROL, "CONTROL")
	_add_nav_button(sidebar, PAGE_SOUND, "SOUND")
	_add_nav_button(sidebar, PAGE_DISPLAY, "DISPLAY")
	_add_nav_button(sidebar, PAGE_ADVANCED, "ADVANCED")
	_add_nav_button(sidebar, PAGE_MODS, "MODS")

	var vertical_separator: VSeparator = VSeparator.new()
	body.add_child(vertical_separator)

	var right_column: VBoxContainer = VBoxContainer.new()
	right_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right_column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right_column.add_theme_constant_override("separation", 10)
	body.add_child(right_column)

	_page_title = Label.new()
	_page_title.add_theme_font_size_override("font_size", 18)
	right_column.add_child(_page_title)

	var content_scroll: ScrollContainer = ScrollContainer.new()
	content_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right_column.add_child(content_scroll)

	_page_content = VBoxContainer.new()
	_page_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_page_content.add_theme_constant_override("separation", 8)
	content_scroll.add_child(_page_content)


func _add_nav_button(parent: VBoxContainer, page_id: String, label_text: String) -> void:
	var button: Button = Button.new()
	button.text = label_text
	button.toggle_mode = true
	button.custom_minimum_size = Vector2(SIDEBAR_WIDTH, 34.0)
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.pressed.connect(_select_page.bind(page_id))
	parent.add_child(button)
	_nav_buttons[page_id] = button


func _select_page(page_id: String) -> void:
	_cancel_capture()
	_current_page = page_id
	for raw_page_id: Variant in _nav_buttons.keys():
		var nav_page_id: String = str(raw_page_id)
		var button: Button = _nav_buttons[nav_page_id] as Button
		button.button_pressed = nav_page_id == page_id

	_clear_page_content()
	match page_id:
		PAGE_CONTROL:
			_page_title.text = "Control"
			_build_control_page()
		PAGE_SOUND:
			_page_title.text = "Sound"
			_build_sound_page()
		PAGE_DISPLAY:
			_page_title.text = "Display"
			_build_display_page()
		PAGE_ADVANCED:
			_page_title.text = "Advanced"
			_build_advanced_page()
		PAGE_MODS:
			_page_title.text = "Mods"
			_build_mods_page()


func _clear_page_content() -> void:
	_action_buttons.clear()
	for child: Node in _page_content.get_children():
		_page_content.remove_child(child)
		child.queue_free()


func _build_control_page() -> void:
	var intro: Label = Label.new()
	intro.text = "Key bindings"
	intro.add_theme_color_override("font_color", Color(0.76, 0.64, 0.42, 1.0))
	_page_content.add_child(intro)

	var current_category: String = ""
	for meta: Dictionary in KeybindPresets.ACTIONS:
		var category: String = str(meta.get("category", ""))
		if category != current_category:
			current_category = category
			_add_category_header(category)

		var action: String = str(meta.get("action", ""))
		var display: String = str(meta.get("display", action))
		var is_reserved: bool = bool(meta.get("reserved", false))
		_add_keybind_row(action, display, is_reserved)

	var bottom_separator: HSeparator = HSeparator.new()
	_page_content.add_child(bottom_separator)

	var bottom_bar: HBoxContainer = HBoxContainer.new()
	bottom_bar.alignment = BoxContainer.ALIGNMENT_BEGIN
	bottom_bar.add_theme_constant_override("separation", 12)
	_page_content.add_child(bottom_bar)

	var reset_default_btn: Button = Button.new()
	reset_default_btn.text = "Reset to Default"
	reset_default_btn.pressed.connect(_on_reset_default)
	bottom_bar.add_child(reset_default_btn)

	var left_hand_btn: Button = Button.new()
	left_hand_btn.text = "Reset to Left-Handed"
	left_hand_btn.pressed.connect(_on_reset_left_handed)
	bottom_bar.add_child(left_hand_btn)


func _add_category_header(category: String) -> void:
	var spacer: Control = Control.new()
	spacer.custom_minimum_size = Vector2(0.0, 8.0)
	_page_content.add_child(spacer)

	var header: Label = Label.new()
	header.text = category.to_upper()
	header.add_theme_font_size_override("font_size", 11)
	header.add_theme_color_override("font_color", Color(0.7, 0.55, 0.3, 1.0))
	_page_content.add_child(header)


func _add_keybind_row(action: String, display: String, is_reserved: bool) -> void:
	var row: HBoxContainer = HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	_page_content.add_child(row)

	var label: Label = Label.new()
	label.text = display
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if is_reserved:
		label.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5, 1.0))
	row.add_child(label)

	var key_button: Button = Button.new()
	key_button.custom_minimum_size = Vector2(150.0, 0.0)
	key_button.text = KeybindManager.get_action_display_text(action)
	if is_reserved:
		key_button.disabled = true
	else:
		key_button.pressed.connect(_on_key_button_pressed.bind(action, key_button))
	row.add_child(key_button)
	_action_buttons[action] = key_button

	if not is_reserved:
		var clear_button: Button = Button.new()
		clear_button.text = "X"
		clear_button.custom_minimum_size = Vector2(30.0, 0.0)
		clear_button.pressed.connect(_on_clear_pressed.bind(action))
		row.add_child(clear_button)


func _build_sound_page() -> void:
	_page_content.add_child(_create_slider_row("Overall Volume", _overall_volume, func(value: float) -> void:
		_overall_volume = value
	))
	_page_content.add_child(_create_slider_row("SFX Volume", _sfx_volume, func(value: float) -> void:
		_sfx_volume = value
	))
	_page_content.add_child(_create_slider_row("Background Music Volume", _music_volume, func(value: float) -> void:
		_music_volume = value
	))


func _build_display_page() -> void:
	_page_content.add_child(_create_toggle_row("Fullscreen", _fullscreen_enabled, func(enabled: bool) -> void:
		_fullscreen_enabled = enabled
	))
	_page_content.add_child(_create_slider_row("UI Scale", _ui_scale, func(value: float) -> void:
		_ui_scale = value
	, 75.0, 125.0, "%d%%"))
	_page_content.add_child(_create_toggle_row("Camera Edge Scroll", _edge_scroll_enabled, func(enabled: bool) -> void:
		_edge_scroll_enabled = enabled
	))

	var hint: Label = Label.new()
	hint.text = "Display options are interactive placeholders for now."
	hint.add_theme_color_override("font_color", Color(0.62, 0.58, 0.50, 1.0))
	_page_content.add_child(hint)


func _build_advanced_page() -> void:
	_page_content.add_child(_create_toggle_row("Enable VIM Mod", _vim_mode_enabled, func(enabled: bool) -> void:
		_vim_mode_enabled = enabled
	))


func _build_mods_page() -> void:
	var label: Label = Label.new()
	label.text = "(feature imcomplete)"
	label.add_theme_font_size_override("font_size", 16)
	_page_content.add_child(label)


func _create_slider_row(
		label_text: String,
		value: float,
		on_changed: Callable,
		min_value: float = 0.0,
		max_value: float = 100.0,
		value_format: String = "%d"
) -> HBoxContainer:
	var row: HBoxContainer = HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)

	var label: Label = Label.new()
	label.text = label_text
	label.custom_minimum_size = Vector2(210.0, 0.0)
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(label)

	var slider: HSlider = HSlider.new()
	slider.min_value = min_value
	slider.max_value = max_value
	slider.step = 1.0
	slider.value = value
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(slider)

	var value_label: Label = Label.new()
	value_label.custom_minimum_size = Vector2(54.0, 0.0)
	value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	value_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	value_label.text = value_format % int(value)
	row.add_child(value_label)

	slider.value_changed.connect(func(new_value: float) -> void:
		value_label.text = value_format % int(new_value)
		on_changed.call(new_value)
	)
	return row


func _create_toggle_row(label_text: String, enabled: bool, on_toggled: Callable) -> HBoxContainer:
	var row: HBoxContainer = HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)

	var label: Label = Label.new()
	label.text = label_text
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	row.add_child(label)

	var toggle: CheckButton = CheckButton.new()
	toggle.text = "Enabled"
	toggle.button_pressed = enabled
	toggle.toggled.connect(func(value: bool) -> void:
		on_toggled.call(value)
	)
	row.add_child(toggle)
	return row


func _input(event: InputEvent) -> void:
	if not visible:
		return
	if not (event is InputEventKey):
		return
	var key: InputEventKey = event as InputEventKey
	if not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_ESCAPE:
		if _capturing_action != "":
			_cancel_capture()
		else:
			hide_panel()
		get_viewport().set_input_as_handled()
		return
	if _capturing_action == "":
		return
	var ev: InputEventKey = key.duplicate() as InputEventKey
	ev.pressed = false
	KeybindManager.remap_action(_capturing_action, ev)
	_action_buttons[_capturing_action].text = KeybindManager.get_action_display_text(_capturing_action)
	_cancel_capture()
	get_viewport().set_input_as_handled()


func _on_dim_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mouse_button: InputEventMouseButton = event as InputEventMouseButton
	if mouse_button.button_index in [
		MOUSE_BUTTON_WHEEL_UP,
		MOUSE_BUTTON_WHEEL_DOWN,
		MOUSE_BUTTON_WHEEL_LEFT,
		MOUSE_BUTTON_WHEEL_RIGHT,
	]:
		get_viewport().set_input_as_handled()
		return
	if mouse_button.pressed and mouse_button.button_index == MOUSE_BUTTON_LEFT:
		get_viewport().set_input_as_handled()
		hide_panel()


func _on_key_button_pressed(action: String, button: Button) -> void:
	if _capturing_action != "":
		_cancel_capture()
	_capturing_action = action
	_capturing_button = button
	button.text = "Press a key..."


func _on_clear_pressed(action: String) -> void:
	KeybindManager.remap_action(action, null)
	var button: Button = _action_buttons.get(action, null) as Button
	if button != null:
		button.text = "Unbound"


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
	for raw_action: Variant in _action_buttons.keys():
		var action: String = str(raw_action)
		var button: Button = _action_buttons[action] as Button
		button.text = KeybindManager.get_action_display_text(action)
