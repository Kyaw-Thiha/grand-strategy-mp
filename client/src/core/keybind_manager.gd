extends Node
## Autoload: registers all InputMap actions, applies saved remaps on startup,
## and provides remap / preset / save / reset API used by SettingsKeybind.

const _CONFIG_PATH := "user://keybinds.cfg"


func _ready() -> void:
	_register_all_actions()
	_load_from_config()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

func remap_action(action: String, event: InputEvent) -> void:
	if not InputMap.has_action(action):
		return
	InputMap.action_erase_events(action)
	if event != null:
		InputMap.action_add_event(action, event)
	save()


func apply_preset(preset: Dictionary) -> void:
	# Reset all managed actions to project defaults first
	InputMap.load_from_project_settings()
	_register_all_actions()  # re-register any that weren't in project.godot
	# Apply preset overrides
	for action: String in preset:
		if not InputMap.has_action(action):
			continue
		var entry: Dictionary = preset[action]
		var pk: int = entry.get("physical_keycode", 0)
		InputMap.action_erase_events(action)
		if pk != 0:
			InputMap.action_add_event(action, _make_key(pk,
				entry.get("ctrl", false),
				entry.get("shift", false),
				entry.get("alt", false)))
	save()


func reset_to_default() -> void:
	InputMap.load_from_project_settings()
	_register_all_actions()
	if FileAccess.file_exists(_CONFIG_PATH):
		DirAccess.remove_absolute(_CONFIG_PATH)


func save() -> void:
	var cfg := ConfigFile.new()
	for meta: Dictionary in KeybindPresets.ACTIONS:
		var action: String = meta.action
		if not InputMap.has_action(action):
			continue
		var events: Array[InputEvent] = InputMap.action_get_events(action)
		if events.is_empty():
			cfg.set_value(action, "physical_keycode", 0)
			cfg.set_value(action, "ctrl",  false)
			cfg.set_value(action, "shift", false)
			cfg.set_value(action, "alt",   false)
		else:
			var ev: InputEvent = events[0]
			if ev is InputEventKey:
				var ek := ev as InputEventKey
				cfg.set_value(action, "physical_keycode", ek.physical_keycode)
				cfg.set_value(action, "ctrl",  ek.ctrl_pressed)
				cfg.set_value(action, "shift", ek.shift_pressed)
				cfg.set_value(action, "alt",   ek.alt_pressed)
	cfg.save(_CONFIG_PATH)


func get_action_display_text(action: String) -> String:
	if not InputMap.has_action(action):
		return "—"
	var events: Array[InputEvent] = InputMap.action_get_events(action)
	if events.is_empty():
		return "Unbound"
	return events[0].as_text()


# ---------------------------------------------------------------------------
# Private
# ---------------------------------------------------------------------------

func _load_from_config() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(_CONFIG_PATH) != OK:
		return
	for action: String in cfg.get_sections():
		if not InputMap.has_action(action):
			continue
		var pk: int = cfg.get_value(action, "physical_keycode", 0)
		if pk == 0:
			InputMap.action_erase_events(action)
			continue
		var ev := _make_key(pk,
			cfg.get_value(action, "ctrl",  false),
			cfg.get_value(action, "shift", false),
			cfg.get_value(action, "alt",   false))
		InputMap.action_erase_events(action)
		InputMap.action_add_event(action, ev)


func _register_all_actions() -> void:
	# Camera
	_reg("cam_pan_up",         _key(KEY_W))
	_reg("cam_pan_down",        _key(KEY_S))
	_reg("cam_pan_left",        _key(KEY_A))
	_reg("cam_pan_right",       _key(KEY_D))
	_reg("cam_zoom_in",         _key(KEY_EQUAL, true))   # Ctrl +=
	_reg("cam_zoom_out",        _key(KEY_MINUS, true))   # Ctrl +-
	_reg("cam_bookmark_jump_1", _key(KEY_F1))
	_reg("cam_bookmark_jump_2", _key(KEY_F2))
	_reg("cam_bookmark_jump_3", _key(KEY_F3))
	_reg("cam_bookmark_jump_4", _key(KEY_F4))
	_reg("cam_bookmark_jump_5", _key(KEY_F5))
	_reg("cam_bookmark_jump_6", _key(KEY_F6))
	_reg("cam_bookmark_jump_7", _key(KEY_F7))
	_reg("cam_bookmark_jump_8", _key(KEY_F8))
	_reg("cam_bookmark_set_1",  _key(KEY_F1, true))
	_reg("cam_bookmark_set_2",  _key(KEY_F2, true))
	_reg("cam_bookmark_set_3",  _key(KEY_F3, true))
	_reg("cam_bookmark_set_4",  _key(KEY_F4, true))
	_reg("cam_bookmark_set_5",  _key(KEY_F5, true))
	_reg("cam_bookmark_set_6",  _key(KEY_F6, true))
	_reg("cam_bookmark_set_7",  _key(KEY_F7, true))
	_reg("cam_bookmark_set_8",  _key(KEY_F8, true))
	# Unit orders
	_reg("unit_move",           _key(KEY_SPACE))
	_reg("unit_hold",           _key(KEY_G))
	_reg("unit_retreat",        _key(KEY_C))
	_reg("unit_cancel",         _key(KEY_X))
	_reg("unit_reposition",     _key(KEY_B))
	_reg("unit_idle_select",    null)   # reserved, unbound
	_reg("unit_cycle_engaged",  null)   # reserved, unbound
	# Control groups
	_reg("group_select_0", _key(KEY_0)); _reg("group_assign_0", _key(KEY_0, true)); _reg("group_add_0", _key(KEY_0, false, true))
	_reg("group_select_1", _key(KEY_1)); _reg("group_assign_1", _key(KEY_1, true)); _reg("group_add_1", _key(KEY_1, false, true))
	_reg("group_select_2", _key(KEY_2)); _reg("group_assign_2", _key(KEY_2, true)); _reg("group_add_2", _key(KEY_2, false, true))
	_reg("group_select_3", _key(KEY_3)); _reg("group_assign_3", _key(KEY_3, true)); _reg("group_add_3", _key(KEY_3, false, true))
	_reg("group_select_4", _key(KEY_4)); _reg("group_assign_4", _key(KEY_4, true)); _reg("group_add_4", _key(KEY_4, false, true))
	_reg("group_select_5", _key(KEY_5)); _reg("group_assign_5", _key(KEY_5, true)); _reg("group_add_5", _key(KEY_5, false, true))
	_reg("group_select_6", _key(KEY_6)); _reg("group_assign_6", _key(KEY_6, true)); _reg("group_add_6", _key(KEY_6, false, true))
	_reg("group_select_7", _key(KEY_7)); _reg("group_assign_7", _key(KEY_7, true)); _reg("group_add_7", _key(KEY_7, false, true))
	_reg("group_select_8", _key(KEY_8)); _reg("group_assign_8", _key(KEY_8, true)); _reg("group_add_8", _key(KEY_8, false, true))
	_reg("group_select_9", _key(KEY_9)); _reg("group_assign_9", _key(KEY_9, true)); _reg("group_add_9", _key(KEY_9, false, true))
	# Map & navigation
	_reg("map_mode_forward",  _key(KEY_QUOTELEFT))
	_reg("map_mode_backward", _key(KEY_QUOTELEFT, false, true))  # Shift+`
	_reg("map_relation_ring", _key(KEY_ALT))
	# Chat
	_reg("chat_team", _key(KEY_ENTER))
	_reg("chat_all",  _key(KEY_ENTER, false, true))  # Shift+Enter


func _reg(action: String, event: InputEventKey) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	else:
		InputMap.action_erase_events(action)
	if event != null:
		InputMap.action_add_event(action, event)


func _key(keycode: int, ctrl: bool = false, shift: bool = false, alt: bool = false) -> InputEventKey:
	var ev := InputEventKey.new()
	ev.physical_keycode = keycode
	ev.ctrl_pressed  = ctrl
	ev.shift_pressed = shift
	ev.alt_pressed   = alt
	return ev


func _make_key(pk: int, ctrl: bool, shift: bool, alt: bool) -> InputEventKey:
	return _key(pk, ctrl, shift, alt)
