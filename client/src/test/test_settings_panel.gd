extends Node
## Automated test for the tabbed settings panel and main-menu settings entry.

const SettingsScene: PackedScene = preload("res://scenes/game/settings_keybind.tscn")
const MainMenuScene: PackedScene = preload("res://scenes/main_menu/main_menu.tscn")

var _pass_count: int = 0
var _fail_count: int = 0


func _ready() -> void:
	var settings_panel: CanvasLayer = SettingsScene.instantiate() as CanvasLayer
	add_child(settings_panel)
	await get_tree().process_frame

	settings_panel.call("show_panel")
	await get_tree().process_frame
	_check(settings_panel.visible, "settings panel opens")
	_check(_has_button_text(settings_panel, "CONTROL"), "settings sidebar has Control")
	_check(_has_button_text(settings_panel, "SOUND"), "settings sidebar has Sound")
	_check(_has_button_text(settings_panel, "DISPLAY"), "settings sidebar has Display")
	_check(_has_button_text(settings_panel, "ADVANCED"), "settings sidebar has Advanced")
	_check(_has_button_text(settings_panel, "MODS"), "settings sidebar has Mods")
	_check(_has_button_text(settings_panel, "Reset to Default"), "Control page keeps keybind reset controls")

	var sound_button: Button = _find_button_text(settings_panel, "SOUND")
	if sound_button != null:
		sound_button.pressed.emit()
	await get_tree().process_frame
	_check(_has_label_text(settings_panel, "Overall Volume"), "Sound page has overall volume")
	_check(_has_label_text(settings_panel, "SFX Volume"), "Sound page has SFX volume")
	_check(_has_label_text(settings_panel, "Background Music Volume"), "Sound page has music volume")
	var first_slider: HSlider = _find_first_slider(settings_panel)
	_check(first_slider != null, "Sound page has an interactive slider")
	if first_slider != null:
		first_slider.value = 33.0
		_check(is_equal_approx(first_slider.value, 33.0), "Sound slider value changes")

	var display_button: Button = _find_button_text(settings_panel, "DISPLAY")
	if display_button != null:
		display_button.pressed.emit()
	await get_tree().process_frame
	_check(_has_label_text(settings_panel, "Fullscreen"), "Display page has fullscreen option")
	_check(_has_label_text(settings_panel, "UI Scale"), "Display page has UI scale option")
	_check(_has_label_text(settings_panel, "Camera Edge Scroll"), "Display page has edge scroll option")

	var advanced_button: Button = _find_button_text(settings_panel, "ADVANCED")
	if advanced_button != null:
		advanced_button.pressed.emit()
	await get_tree().process_frame
	_check(_has_label_text(settings_panel, "Enable VIM Mod"), "Advanced page has VIM Mod toggle")
	var vim_toggle: CheckButton = _find_first_check_button(settings_panel)
	if vim_toggle != null:
		vim_toggle.button_pressed = not vim_toggle.button_pressed
		_check(vim_toggle.button_pressed, "Advanced toggle changes state")

	var mods_button: Button = _find_button_text(settings_panel, "MODS")
	if mods_button != null:
		mods_button.pressed.emit()
	await get_tree().process_frame
	_check(_has_label_text(settings_panel, "(feature imcomplete)"), "Mods page shows incomplete feature text")

	settings_panel.queue_free()
	await get_tree().process_frame

	APIClient.jwt = "test-token"
	AuthManager.user_id = "test-user"
	AuthManager.has_host_pass = true
	var main_menu: Control = MainMenuScene.instantiate() as Control
	add_child(main_menu)
	await get_tree().process_frame
	var settings_button: Button = main_menu.get_node("%SettingsBtn") as Button
	_check(settings_button != null and settings_button.visible, "Main menu shows Settings after login")
	var create_game_button: Button = main_menu.get_node("%CreateGameBtn") as Button
	_check(settings_button.get_index() < create_game_button.get_index(), "Main menu Settings appears before Create Game")
	settings_button.pressed.emit()
	await get_tree().process_frame
	_check(_has_button_text(main_menu, "CONTROL"), "Main menu Settings opens settings overlay")

	_report()


func _check(condition: bool, label: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		print("FAIL: ", label)


func _has_button_text(root: Node, text: String) -> bool:
	return _find_button_text(root, text) != null


func _find_button_text(root: Node, text: String) -> Button:
	if root == null:
		return null
	if root is Button and (root as Button).text == text:
		return root as Button
	for child: Node in root.get_children():
		var found: Button = _find_button_text(child, text)
		if found != null:
			return found
	return null


func _has_label_text(root: Node, text: String) -> bool:
	if root == null:
		return false
	if root is Label and (root as Label).text == text:
		return true
	for child: Node in root.get_children():
		if _has_label_text(child, text):
			return true
	return false


func _find_first_slider(root: Node) -> HSlider:
	if root == null:
		return null
	if root is HSlider:
		return root as HSlider
	for child: Node in root.get_children():
		var found: HSlider = _find_first_slider(child)
		if found != null:
			return found
	return null


func _find_first_check_button(root: Node) -> CheckButton:
	if root == null:
		return null
	if root is CheckButton:
		return root as CheckButton
	for child: Node in root.get_children():
		var found: CheckButton = _find_first_check_button(child)
		if found != null:
			return found
	return null


func _report() -> void:
	var result: String
	var exit_code: int
	if _fail_count == 0:
		result = "ALL PASS (%d checks)" % _pass_count
		exit_code = 0
	else:
		result = "FAILED %d / %d checks" % [_fail_count, _pass_count + _fail_count]
		exit_code = 1
	print(result)
	get_tree().quit(exit_code)
