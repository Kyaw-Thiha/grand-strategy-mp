extends Node
## Automated test for ChatPanel message rendering.
## Run headless: --scene scenes/test/test_chat_panel.tscn

var _pass_count: int = 0
var _fail_count: int = 0


func _ready() -> void:
	var panel: Control = preload("res://scenes/game/panels/chat_panel.tscn").instantiate() as Control
	add_child(panel)
	await get_tree().process_frame

	var message_list: VBoxContainer = panel.get_node("%MessageList") as VBoxContainer
	await panel.add_message("12:23", "simon@example.com", "I need some backup.")
	_check(message_list.get_child_count() == 1, "non-empty message creates one entry")

	var entry: RichTextLabel = message_list.get_child(0) as RichTextLabel
	_check(entry.text.contains("12:23"), "entry includes time")
	_check(entry.text.contains("simon@example.com"), "entry includes email")
	_check(entry.text.contains("I need some backup."), "entry includes message body")

	await panel.add_message("12:24", "blank@example.com", "   ")
	_check(message_list.get_child_count() == 1, "blank message is ignored")

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
