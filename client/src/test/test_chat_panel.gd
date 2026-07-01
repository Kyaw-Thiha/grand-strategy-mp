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
	var scroll_container: ScrollContainer = panel.get_node("%ScrollContainer") as ScrollContainer
	var latest_preview: HBoxContainer = panel.get_node("%LatestMessagePreview") as HBoxContainer
	var latest_time_label: Label = panel.get_node("%LatestTimeLabel") as Label
	var latest_email_label: Label = panel.get_node("%LatestEmailLabel") as Label
	var latest_message_label: Label = panel.get_node("%LatestMessageLabel") as Label
	var minimized_top_row: HBoxContainer = panel.get_node("%MinimizedTopRow") as HBoxContainer
	var header: HBoxContainer = panel.get_node("%Header") as HBoxContainer
	var title_label: Label = panel.get_node("Margin/VBox/Header/Title") as Label
	var input_row: HBoxContainer = panel.get_node("%InputRow") as HBoxContainer
	var message_input: TextEdit = panel.get_node("%MessageInput") as TextEdit
	var send_button: Button = panel.get_node("%SendButton") as Button
	var toggle_button: Button = panel.find_child("MaximizeMinimizeToggleButton", true, false) as Button
	_check(toggle_button != null, "chat panel includes maximize/minimize toggle button")
	_check(not bool(toggle_button.get("is_maximized")), "chat toggle starts minimized")
	_check(not bool(panel.get("is_maximized")), "chat panel starts minimized")
	_check(not header.visible, "header row hidden by default")
	_check(not title_label.is_visible_in_tree(), "ROOM CHAT title hidden by default")
	_check(not scroll_container.visible, "scrollback hidden by default")
	_check(latest_preview.visible, "latest preview visible by default")
	_check(panel.get_combined_minimum_size().y <= 104.0, "default minimized panel has compact height")
	_check(input_row.visible, "input row visible by default")
	_check(message_input.visible, "message input visible by default")
	_check(send_button.visible, "send button visible by default")
	await panel.add_message("12:23", "simon@example.com", "I need some backup.")
	_check(message_list.get_child_count() == 1, "non-empty message creates one entry")

	var entry: RichTextLabel = message_list.get_child(0) as RichTextLabel
	_check(entry.text.contains("12:23"), "entry includes time")
	_check(entry.text.contains("si*.com"), "entry includes masked email")
	_check(not entry.text.contains("simon@example.com"), "entry hides full email")
	_check(not entry.text.contains("[b]"), "entry email is not bolded")
	_check(entry.text.contains("I need some backup."), "entry includes message body")
	await panel.add_message("12:25", "nora@example.com", "Second message.")
	_check(message_list.get_child_count() == 2, "second non-empty message is retained in scrollback")
	_check(latest_time_label.text == "12:25", "default preview uses newest message time")
	_check(latest_email_label.text == "[no*.com]", "default preview uses masked newest message email")
	_check(latest_message_label.text == "Second message.", "default preview uses newest message body")
	_check(latest_message_label.autowrap_mode == TextServer.AUTOWRAP_OFF, "latest preview does not wrap")
	_check(
		latest_message_label.text_overrun_behavior == TextServer.OVERRUN_TRIM_ELLIPSIS,
		"latest preview trims overflow with ellipsis"
	)

	_check(not header.visible, "header row hidden when minimized")
	_check(not title_label.is_visible_in_tree(), "ROOM CHAT title hidden when minimized")
	_check(not scroll_container.visible, "scrollback hidden when minimized")
	_check(latest_preview.visible, "latest preview visible when minimized")
	_check(latest_time_label.text == "12:25", "latest preview uses newest message time")
	_check(latest_email_label.text == "[no*.com]", "latest preview uses masked newest message email")
	_check(latest_message_label.text == "Second message.", "latest preview uses newest message body")
	_check(panel.get_combined_minimum_size().y <= 104.0, "minimized panel has compact height")
	_check(input_row.visible, "input row remains visible when minimized")
	_check(message_input.visible, "message input remains visible when minimized")
	_check(send_button.visible, "send button remains visible when minimized")
	_check(toggle_button.is_visible_in_tree(), "toggle button remains visible when minimized")
	_check(toggle_button.size.x > 0.0 and toggle_button.size.y > 0.0, "minimized toggle has clickable size")
	_check(
		minimized_top_row.get_child(minimized_top_row.get_child_count() - 1) == toggle_button,
		"minimized toggle is rightmost"
	)
	_check(toggle_button.modulate.a < 1.0, "minimized toggle is visually toned down")

	toggle_button.call("toggle")
	await get_tree().process_frame
	_check(bool(panel.get("is_maximized")), "toggle restores maximized chat panel")
	_check(header.visible, "header row visible when maximized")
	_check(scroll_container.visible, "scrollback visible again when maximized")
	_check(not latest_preview.is_visible_in_tree(), "latest preview hidden again when maximized")
	_check(message_list.get_child_count() == 2, "scrollback keeps all messages after restore")

	toggle_button.call("toggle")
	await get_tree().process_frame
	panel.call("open_chat_input")
	await get_tree().process_frame
	await get_tree().process_frame
	_check(bool(panel.get("is_maximized")), "open_chat_input maximizes minimized chat")
	_check(message_input.has_focus(), "open_chat_input focuses message input")
	message_input.release_focus()
	await get_tree().process_frame

	var escape_event: InputEventKey = InputEventKey.new()
	escape_event.pressed = true
	escape_event.keycode = KEY_ESCAPE
	message_input.grab_focus()
	await get_tree().process_frame
	panel.call("_on_message_input_gui_input", escape_event)
	await get_tree().process_frame
	_check(not message_input.has_focus(), "Escape exits chat typing focus")

	var blank_enter_event: InputEventKey = InputEventKey.new()
	blank_enter_event.pressed = true
	blank_enter_event.keycode = KEY_ENTER
	message_input.text = "   "
	message_input.grab_focus()
	await get_tree().process_frame
	panel.call("_on_message_input_gui_input", blank_enter_event)
	await get_tree().process_frame
	_check(message_input.has_focus(), "blank Enter keeps chat typing focus")
	message_input.release_focus()
	await get_tree().process_frame

	var send_enter_event: InputEventKey = InputEventKey.new()
	send_enter_event.pressed = true
	send_enter_event.keycode = KEY_ENTER
	message_input.text = "Sending focus test"
	message_input.grab_focus()
	await get_tree().process_frame
	panel.call("_on_message_input_gui_input", send_enter_event)
	await get_tree().process_frame
	_check(not message_input.has_focus(), "sending a message exits chat typing focus")

	await panel.add_message("12:26", "abc@x", "Short email.")
	var short_email_entry: RichTextLabel = message_list.get_child(2) as RichTextLabel
	_check(short_email_entry.text.contains("abc@x"), "short email is not masked")

	var focus_log: Array[bool] = []
	EventBus.chat_input_focus_changed.connect(func(focused: bool) -> void: focus_log.append(focused))
	message_input.grab_focus()
	await get_tree().process_frame
	message_input.release_focus()
	await get_tree().process_frame
	_check(focus_log.has(true), "chat input focus emits blocking signal")
	_check(focus_log.has(false), "chat input blur clears blocking signal")

	await panel.add_message("12:24", "blank@example.com", "   ")
	_check(message_list.get_child_count() == 3, "blank message is ignored")

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
