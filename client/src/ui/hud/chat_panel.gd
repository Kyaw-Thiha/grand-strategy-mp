extends PanelContainer
## Persistent in-game chat panel.
## Displays room chat and submits SEND_CHAT commands through CommandQueue.

const MAX_MESSAGE_LENGTH: int = 500

@onready var _message_list: VBoxContainer = %MessageList
@onready var _scroll_container: ScrollContainer = %ScrollContainer
@onready var _input: TextEdit = %MessageInput
@onready var _send_button: Button = %SendButton


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_send_button.pressed.connect(_send_current_message)
	_input.gui_input.connect(_on_message_input_gui_input)

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
	entry.text = (
		"[color=#9c8460]" + _escape_bbcode(time) + "[/color] " +
		"[color=#f0c15f][b][" + _escape_bbcode(email) + "][/b][/color] " +
		"[color=#e8dfcc]" + _escape_bbcode(trimmed_message) + "[/color]"
	)
	_message_list.add_child(entry)
	await get_tree().process_frame
	_scroll_container.scroll_vertical = int(_scroll_container.get_v_scroll_bar().max_value)


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
	_input.grab_focus()


## Escapes user-provided text before inserting it into RichTextLabel BBCode.
## Parameters:
## - value: plain text value.
## Returns: BBCode-safe text.
func _escape_bbcode(value: String) -> String:
	return value.replace("[", "[lb]").replace("]", "[rb]")
