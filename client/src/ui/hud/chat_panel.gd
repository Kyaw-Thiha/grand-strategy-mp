extends PanelContainer
## Persistent in-game chat panel.
## Displays room chat and submits SEND_CHAT commands through CommandQueue.

signal layout_changed

const MAX_MESSAGE_LENGTH: int = 500
const MAXIMIZED_MINIMUM_SIZE: Vector2 = Vector2(360.0, 260.0)
const MINIMIZED_MINIMUM_SIZE: Vector2 = Vector2(360.0, 90.0)
const MASKED_EMAIL_PREFIX_LENGTH: int = 2
const MASKED_EMAIL_SUFFIX_LENGTH: int = 4

@onready var _header: HBoxContainer = %Header
@onready var _minimized_top_row: HBoxContainer = %MinimizedTopRow
@onready var _message_list: VBoxContainer = %MessageList
@onready var _scroll_container: ScrollContainer = %ScrollContainer
@onready var _latest_message_preview: HBoxContainer = %LatestMessagePreview
@onready var _latest_time_label: Label = %LatestTimeLabel
@onready var _latest_email_label: Label = %LatestEmailLabel
@onready var _latest_message_label: Label = %LatestMessageLabel
@onready var _toggle_button: Button = %MaximizeMinimizeToggleButton
@onready var _input: TextEdit = %MessageInput
@onready var _send_button: Button = %SendButton

var is_maximized: bool = true
var _latest_message_time: String = ""
var _latest_message_email: String = ""
var _latest_message_body: String = ""
var _header_toggle_index: int = -1


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS
	_header_toggle_index = _toggle_button.get_index()
	_send_button.pressed.connect(_send_current_message)
	_input.gui_input.connect(_on_message_input_gui_input)
	_input.focus_entered.connect(_on_message_input_focus_entered)
	_input.focus_exited.connect(_on_message_input_focus_exited)
	if not _toggle_button.toggled.is_connected(set_maximized):
		_toggle_button.toggled.connect(set_maximized)
	set_maximized(bool(_toggle_button.get("is_maximized")))

	var chat_callable: Callable = Callable(self, "add_message")
	if has_node("/root/EventBus") and not EventBus.chat_message_received.is_connected(chat_callable):
		EventBus.chat_message_received.connect(chat_callable)


## Adds a received chat message to the scrollback.
## Parameters:
## - time: server-formatted HH:MM timestamp.
## - email: sender display email.
## - message: plain text chat body.
## Returns: nothing.
func add_message(time: String, email: String, message: String) -> void:
	var trimmed_message: String = message.strip_edges()
	if trimmed_message.is_empty():
		return

	var entry: RichTextLabel = RichTextLabel.new()
	entry.bbcode_enabled = true
	entry.fit_content = true
	entry.scroll_active = false
	entry.selection_enabled = true
	entry.mouse_filter = Control.MOUSE_FILTER_PASS
	entry.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	entry.custom_minimum_size = Vector2(0.0, 24.0)
	entry.add_theme_font_size_override("normal_font_size", 13)
	entry.text = _format_message_bbcode(time, email, trimmed_message)
	_message_list.add_child(entry)
	_latest_message_time = time
	_latest_message_email = email
	_latest_message_body = trimmed_message
	_refresh_latest_message_preview()
	await get_tree().process_frame
	_scroll_container.scroll_vertical = int(_scroll_container.get_v_scroll_bar().max_value)


## Applies maximized or minimized visual state to the chat panel.
## Parameters:
## - value: true for full scrollback, false for latest-message-only view.
## Returns: nothing.
func set_maximized(value: bool) -> void:
	is_maximized = value
	_header.visible = is_maximized
	_minimized_top_row.visible = not is_maximized
	_scroll_container.visible = is_maximized
	custom_minimum_size = MAXIMIZED_MINIMUM_SIZE if is_maximized else MINIMIZED_MINIMUM_SIZE
	_move_toggle_button_for_current_state()
	size = get_combined_minimum_size()
	if not is_maximized:
		_refresh_latest_message_preview()
	layout_changed.emit()


func _exit_tree() -> void:
	if has_node("/root/EventBus"):
		EventBus.chat_input_focus_changed.emit(false)


## Opens the chat for text entry.
## Parameters: none.
## Returns: nothing.
func open_chat_input() -> void:
	if not is_maximized:
		set_maximized(true)
	call_deferred("_focus_message_input")


## Closes chat text entry without hiding the chat panel.
## Parameters: none.
## Returns: nothing.
func close_chat_input() -> void:
	_input.release_focus()


## Reports whether the message input currently owns keyboard focus.
## Parameters: none.
## Returns: true when the chat TextEdit has focus.
func is_message_input_focused() -> bool:
	return _input.has_focus()


## Handles Enter-to-send while preserving Shift+Enter for multi-line drafts.
## Parameters:
## - event: GUI input event from the TextEdit.
## Returns: nothing.
func _on_message_input_gui_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return
	var key_event: InputEventKey = event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return
	if key_event.keycode == KEY_ESCAPE:
		close_chat_input()
		_input.accept_event()
		return
	if key_event.keycode != KEY_ENTER and key_event.keycode != KEY_KP_ENTER:
		return
	if key_event.shift_pressed:
		return

	_send_current_message()
	_input.accept_event()


## Sends the current draft to the server through CommandQueue.
## Parameters: none.
## Returns: nothing.
func _send_current_message() -> void:
	var message: String = _input.text.strip_edges()
	if message.is_empty():
		return
	if message.length() > MAX_MESSAGE_LENGTH:
		message = message.left(MAX_MESSAGE_LENGTH)
	CommandQueue.submit("SEND_CHAT", {"message": message})
	_input.text = ""
	close_chat_input()


## Formats a chat message for RichTextLabel display.
## Parameters:
## - time: server-formatted HH:MM timestamp.
## - email: sender display email.
## - message: plain text chat body.
## Returns: BBCode-formatted message text.
func _format_message_bbcode(time: String, email: String, message: String) -> String:
	var masked_email: String = _mask_email(email)
	return (
		"[color=#9c8460]" + _escape_bbcode(time) + "[/color] " +
		"[color=#d0a758][" + _escape_bbcode(masked_email) + "][/color] " +
		"[color=#e8dfcc]" + _escape_bbcode(message) + "[/color]"
	)


## Refreshes the minimized latest-message preview labels.
## Parameters: none.
## Returns: nothing.
func _refresh_latest_message_preview() -> void:
	_latest_time_label.text = _latest_message_time
	_latest_email_label.text = "[" + _mask_email(_latest_message_email) + "]" if not _latest_message_email.is_empty() else ""
	_latest_message_label.text = _latest_message_body


## Moves the reusable toggle button between the full header and minimized row.
## Parameters: none.
## Returns: nothing.
func _move_toggle_button_for_current_state() -> void:
	var target_parent: Control = _header if is_maximized else _minimized_top_row
	if _toggle_button.get_parent() == target_parent:
		if not is_maximized:
			_minimized_top_row.move_child(_toggle_button, _minimized_top_row.get_child_count() - 1)
			_toggle_button.modulate = Color(1.0, 1.0, 1.0, 0.62)
		else:
			_toggle_button.modulate = Color.WHITE
		return
	_toggle_button.get_parent().remove_child(_toggle_button)
	target_parent.add_child(_toggle_button)
	if is_maximized and _header_toggle_index >= 0:
		_header.move_child(_toggle_button, min(_header_toggle_index, _header.get_child_count() - 1))
		_toggle_button.modulate = Color.WHITE
	elif not is_maximized:
		_minimized_top_row.move_child(_toggle_button, _minimized_top_row.get_child_count() - 1)
		_toggle_button.modulate = Color(1.0, 1.0, 1.0, 0.62)


## Gives keyboard focus to the message input after any relayout has settled.
## Parameters: none.
## Returns: nothing.
func _focus_message_input() -> void:
	_input.grab_focus()


## Emits chat input focus state so gameplay and HUD hotkeys can pause while typing.
## Parameters: none.
## Returns: nothing.
func _on_message_input_focus_entered() -> void:
	EventBus.chat_input_focus_changed.emit(true)


## Clears chat input focus state when typing focus leaves the message box.
## Parameters: none.
## Returns: nothing.
func _on_message_input_focus_exited() -> void:
	EventBus.chat_input_focus_changed.emit(false)


## Masks a sender email for chat display.
## Parameters:
## - email: original sender email.
## Returns: the original value for short emails, otherwise first two chars + * + last four chars.
func _mask_email(email: String) -> String:
	if email.length() <= MASKED_EMAIL_PREFIX_LENGTH + MASKED_EMAIL_SUFFIX_LENGTH:
		return email
	return email.left(MASKED_EMAIL_PREFIX_LENGTH) + "*" + email.right(MASKED_EMAIL_SUFFIX_LENGTH)


## Escapes user-provided text before inserting it into RichTextLabel BBCode.
## Parameters:
## - value: plain text value.
## Returns: BBCode-safe text.
func _escape_bbcode(value: String) -> String:
	return value.replace("[", "[lb]").replace("]", "[rb]")
