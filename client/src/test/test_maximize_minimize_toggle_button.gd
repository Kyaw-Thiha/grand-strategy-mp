extends Node
## Automated test for MaximizeMinimizeToggleButton state and icon swapping.
## Run headless: --scene scenes/test/test_maximize_minimize_toggle_button.tscn

const ToggleButtonScene: PackedScene = preload("res://scenes/game/components/maximize_minimize_toggle_button.tscn")
const ToggleButtonScript: Script = preload("res://src/ui/components/maximize_minimize_toggle_button.gd")

var _pass_count: int = 0
var _fail_count: int = 0


func _ready() -> void:
	var button: Button = ToggleButtonScene.instantiate() as Button
	add_child(button)
	await get_tree().process_frame

	var emitted_states: Array[bool] = []
	button.toggled.connect(func(is_maximized: bool) -> void:
		emitted_states.append(is_maximized)
	)

	_check(bool(button.get("is_maximized")), "initial state is maximized")
	_check(button.icon == ToggleButtonScript.MAXIMIZED_ICON, "initial icon is minimize action")
	_check(button.tooltip_text == "Minimize", "initial tooltip says Minimize")
	_check(button.get_theme_stylebox("normal") != null, "toggle has solid normal border style")
	_check(button.get_theme_stylebox("hover") != null, "toggle has hover style")
	_check(button.get_theme_stylebox("pressed") != null, "toggle has pressed style")

	button.call("toggle")
	await get_tree().process_frame

	_check(not bool(button.get("is_maximized")), "first click changes to minimized")
	_check(button.icon == ToggleButtonScript.MINIMIZED_ICON, "minimized icon is maximize action")
	_check(button.tooltip_text == "Maximize", "minimized tooltip says Maximize")

	button.call("toggle")
	await get_tree().process_frame

	_check(bool(button.get("is_maximized")), "second click restores maximized")
	_check(button.icon == ToggleButtonScript.MAXIMIZED_ICON, "maximized icon is restored")
	_check(emitted_states == [false, true], "toggled emits new state each time")

	_report()


func _check(condition: bool, label: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		print("FAIL: ", label)


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
