extends VBoxContainer
## Bottom-left HUD notification feed.
## Owns transient visual notification cards only; notification producers emit
## EventBus.notification_requested(message, type).

const MAX_VISIBLE_NOTIFICATIONS: int = 4
const DISPLAY_SECONDS: float = 5.0
const FADE_SECONDS: float = 0.2
const CARD_WIDTH: float = 320.0
const CARD_MIN_HEIGHT: float = 56.0
const VOTE_RECT_SIZE: Vector2 = Vector2(20.0, 14.0)

var _interactive_cards: Dictionary = {}
var _interactive_payloads: Dictionary = {}
var _vote_rect_texture: Texture2D = null


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	alignment = BoxContainer.ALIGNMENT_END
	var push_callable: Callable = Callable(self, "push_notification")
	if has_node("/root/EventBus") and not EventBus.notification_requested.is_connected(push_callable):
		EventBus.notification_requested.connect(push_callable)
	var interactive_push_callable: Callable = Callable(self, "push_interactive_notification")
	if has_node("/root/EventBus") and not EventBus.interactive_notification_requested.is_connected(interactive_push_callable):
		EventBus.interactive_notification_requested.connect(interactive_push_callable)
	var interactive_update_callable: Callable = Callable(self, "update_interactive_notification")
	if has_node("/root/EventBus") and not EventBus.interactive_notification_updated.is_connected(interactive_update_callable):
		EventBus.interactive_notification_updated.connect(interactive_update_callable)
	set_process(true)


func _process(_delta: float) -> void:
	for raw_notification_id: Variant in _interactive_payloads.keys():
		var notification_id: String = str(raw_notification_id)
		var card: PanelContainer = _interactive_cards.get(notification_id, null) as PanelContainer
		if card == null or not is_instance_valid(card):
			continue
		var progress_bar: ProgressBar = card.get_node_or_null("Margin/Row/Content/TimerProgress") as ProgressBar
		if progress_bar == null:
			continue
		var payload: Dictionary = _interactive_payloads.get(notification_id, {}) as Dictionary
		progress_bar.value = _get_deadline_progress(payload)


## Adds a transient notification card to the feed.
## Parameters:
## - message: user-facing notification text.
## - notification_type: semantic category such as research, warning, error, or combat.
## Returns: nothing.
func push_notification(message: String, notification_type: String = "default") -> void:
	var trimmed_message: String = message.strip_edges()
	if trimmed_message.is_empty():
		return

	var card: PanelContainer = _create_notification_card(trimmed_message, notification_type)
	card.set_meta("interactive", false)
	add_child(card)
	_trim_old_notifications()
	_play_entry_animation(card)
	_schedule_removal(card)


## Adds or replaces a persistent interactive notification card.
## Parameters:
## - notification: structured server payload for a diplomacy vote.
## Returns: nothing.
func push_interactive_notification(notification: Dictionary) -> void:
	var notification_id: String = str(notification.get("notification_id", ""))
	if notification_id.is_empty():
		return
	_interactive_payloads[notification_id] = notification.duplicate(true)

	var card: PanelContainer = _interactive_cards.get(notification_id, null) as PanelContainer
	if card == null or not is_instance_valid(card):
		card = _create_interactive_notification_card(notification)
		card.set_meta("interactive", true)
		_interactive_cards[notification_id] = card
		add_child(card)
		_trim_old_notifications()
		_play_entry_animation(card)
	else:
		_rebuild_interactive_card(card, notification)


## Updates a persistent interactive notification card in place.
## Parameters:
## - notification: structured server payload with the same notification_id as the original card.
## Returns: nothing.
func update_interactive_notification(notification: Dictionary) -> void:
	var notification_id: String = str(notification.get("notification_id", ""))
	if notification_id.is_empty():
		return
	var merged_payload: Dictionary = (_interactive_payloads.get(notification_id, {}) as Dictionary).duplicate(true)
	for key: Variant in notification.keys():
		merged_payload[key] = notification[key]
	_interactive_payloads[notification_id] = merged_payload

	var card: PanelContainer = _interactive_cards.get(notification_id, null) as PanelContainer
	if card == null or not is_instance_valid(card):
		if merged_payload.has("message"):
			push_interactive_notification(merged_payload)
		return

	_rebuild_interactive_card(card, merged_payload)
	if bool(merged_payload.get("resolved", false)):
		_schedule_interactive_removal(notification_id)


## Builds a themed notification card.
## Parameters:
## - message: user-facing notification text.
## - notification_type: semantic category controlling title and accent color.
## Returns: a configured notification card control.
func _create_notification_card(message: String, notification_type: String) -> PanelContainer:
	var normalized_type: String = notification_type.to_lower()
	var accent_color: Color = _get_type_color(normalized_type)

	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, CARD_MIN_HEIGHT)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.modulate = Color(1.0, 1.0, 1.0, 0.0)
	card.position.x = -18.0
	card.add_theme_stylebox_override("panel", _create_card_style(accent_color))

	var margin: MarginContainer = MarginContainer.new()
	margin.name = "Margin"
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var row: HBoxContainer = HBoxContainer.new()
	row.name = "Row"
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 8)
	margin.add_child(row)

	var accent: ColorRect = ColorRect.new()
	accent.custom_minimum_size = Vector2(4.0, 0.0)
	accent.size_flags_vertical = Control.SIZE_EXPAND_FILL
	accent.mouse_filter = Control.MOUSE_FILTER_IGNORE
	accent.color = accent_color
	row.add_child(accent)

	var text_column: VBoxContainer = VBoxContainer.new()
	text_column.name = "Content"
	text_column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	text_column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text_column.add_theme_constant_override("separation", 2)
	row.add_child(text_column)

	var title: Label = Label.new()
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title.text = _get_type_title(normalized_type)
	title.add_theme_color_override("font_color", accent_color)
	title.add_theme_font_size_override("font_size", 12)
	text_column.add_child(title)

	var body: Label = Label.new()
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.text = message
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_theme_font_size_override("font_size", 14)
	text_column.add_child(body)

	return card


## Builds an interactive diplomacy notification card.
## Parameters:
## - notification: structured server payload for a diplomacy vote.
## Returns: a configured notification card control.
func _create_interactive_notification_card(notification: Dictionary) -> PanelContainer:
	var normalized_type: String = str(notification.get("notification_type", "diplomacy")).to_lower()
	var accent_color: Color = _get_type_color(normalized_type)

	var card: PanelContainer = PanelContainer.new()
	card.custom_minimum_size = Vector2(CARD_WIDTH, CARD_MIN_HEIGHT)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.modulate = Color(1.0, 1.0, 1.0, 0.0)
	card.position.x = -18.0
	card.add_theme_stylebox_override("panel", _create_card_style(accent_color))

	var margin: MarginContainer = MarginContainer.new()
	margin.name = "Margin"
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var row: HBoxContainer = HBoxContainer.new()
	row.name = "Row"
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", 8)
	margin.add_child(row)

	var accent: ColorRect = ColorRect.new()
	accent.custom_minimum_size = Vector2(4.0, 0.0)
	accent.size_flags_vertical = Control.SIZE_EXPAND_FILL
	accent.mouse_filter = Control.MOUSE_FILTER_IGNORE
	accent.color = accent_color
	row.add_child(accent)

	var content: VBoxContainer = VBoxContainer.new()
	content.name = "Content"
	content.mouse_filter = Control.MOUSE_FILTER_PASS
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 6)
	row.add_child(content)

	_rebuild_interactive_card(card, notification)
	return card


func _rebuild_interactive_card(card: PanelContainer, notification: Dictionary) -> void:
	var content: VBoxContainer = card.get_node_or_null("Margin/Row/Content") as VBoxContainer
	if content == null:
		return
	for child: Node in content.get_children():
		content.remove_child(child)
		child.queue_free()

	var normalized_type: String = str(notification.get("notification_type", "diplomacy")).to_lower()
	var accent_color: Color = _get_type_color(normalized_type)

	var title: Label = Label.new()
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title.text = _get_type_title(normalized_type)
	title.add_theme_color_override("font_color", accent_color)
	title.add_theme_font_size_override("font_size", 12)
	content.add_child(title)

	var body: Label = Label.new()
	body.mouse_filter = Control.MOUSE_FILTER_IGNORE
	body.text = str(notification.get("message", "Diplomacy vote"))
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_theme_font_size_override("font_size", 14)
	content.add_child(body)

	var progress_bar: ProgressBar = ProgressBar.new()
	progress_bar.name = "TimerProgress"
	progress_bar.custom_minimum_size = Vector2(0.0, 7.0)
	progress_bar.max_value = 1.0
	progress_bar.step = 0.001
	progress_bar.show_percentage = false
	progress_bar.value = _get_deadline_progress(notification)
	progress_bar.add_theme_stylebox_override("fill", _create_progress_fill_style(accent_color))
	content.add_child(progress_bar)

	var voters: Array = notification.get("voters", []) as Array
	if not voters.is_empty():
		var vote_row: HBoxContainer = HBoxContainer.new()
		vote_row.name = "VoteRectangles"
		vote_row.mouse_filter = Control.MOUSE_FILTER_PASS
		vote_row.add_theme_constant_override("separation", 4)
		content.add_child(vote_row)
		for raw_voter: Variant in voters:
			if not raw_voter is Dictionary:
				continue
			var voter: Dictionary = raw_voter
			vote_row.add_child(_create_vote_rectangle(voter))

	if bool(notification.get("resolved", false)):
		var result_label: Label = Label.new()
		result_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		result_label.text = "PASSED" if bool(notification.get("passed", false)) else "FAILED"
		result_label.add_theme_color_override("font_color", Color(0.48, 0.78, 0.42, 1.0) if bool(notification.get("passed", false)) else Color(0.88, 0.30, 0.26, 1.0))
		result_label.add_theme_font_size_override("font_size", 12)
		content.add_child(result_label)
		return

	if bool(notification.get("requires_response", false)):
		var button_row: HBoxContainer = HBoxContainer.new()
		button_row.mouse_filter = Control.MOUSE_FILTER_PASS
		button_row.add_theme_constant_override("separation", 6)
		content.add_child(button_row)
		button_row.add_child(_create_vote_button(notification, true))
		button_row.add_child(_create_vote_button(notification, false))


func _create_vote_button(notification: Dictionary, accepted: bool) -> Button:
	var button: Button = Button.new()
	button.custom_minimum_size = Vector2(64, 26)
	button.text = str(notification.get("yes_label", "Yes")) if accepted else str(notification.get("no_label", "No"))
	var vote_id: String = str(notification.get("vote_id", ""))
	button.pressed.connect(func() -> void:
		button.disabled = true
		DiplomacySystem.submit_vote_response(vote_id, accepted)
	)
	return button


func _create_vote_rectangle(voter: Dictionary) -> TextureRect:
	var rect: TextureRect = TextureRect.new()
	rect.custom_minimum_size = VOTE_RECT_SIZE
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.texture = _get_vote_rect_texture()
	rect.modulate = _get_vote_status_color(str(voter.get("status", "pending")))
	var nation_id: String = str(voter.get("nation_id", ""))
	rect.tooltip_text = _get_nation_display_name(nation_id)
	return rect


func _get_vote_rect_texture() -> Texture2D:
	if _vote_rect_texture != null:
		return _vote_rect_texture
	var image: Image = Image.create(1, 1, false, Image.FORMAT_RGBA8)
	image.fill(Color.WHITE)
	_vote_rect_texture = ImageTexture.create_from_image(image)
	return _vote_rect_texture


func _get_vote_status_color(status: String) -> Color:
	match status:
		"yes":
			return Color(0.28, 0.72, 0.36, 1.0)
		"no":
			return Color(0.86, 0.26, 0.22, 1.0)
		_:
			return Color(0.45, 0.45, 0.48, 1.0)


func _get_nation_display_name(nation_id: String) -> String:
	if nation_id.is_empty():
		return "Unknown"
	var path: String = "res://assets/data/western_europe_6/nations.json"
	if not FileAccess.file_exists(path):
		return nation_id.capitalize()
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Array:
		return nation_id.capitalize()
	var definitions: Array = parsed
	for raw_definition: Variant in definitions:
		if not raw_definition is Dictionary:
			continue
		var definition: Dictionary = raw_definition
		if str(definition.get("id", "")) == nation_id:
			return str(definition.get("name", nation_id.capitalize()))
	return nation_id.capitalize()


func _get_deadline_progress(notification: Dictionary) -> float:
	var duration_ms: float = float(notification.get("duration_ms", 0))
	var deadline_at: float = float(notification.get("deadline_at", 0))
	if duration_ms <= 0.0 or deadline_at <= 0.0:
		return 0.0
	var now_ms: float = Time.get_unix_time_from_system() * 1000.0
	var remaining_ms: float = clamp(deadline_at - now_ms, 0.0, duration_ms)
	return remaining_ms / duration_ms


func _create_progress_fill_style(accent_color: Color) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(accent_color.r, accent_color.g, accent_color.b, 0.86)
	style.corner_radius_top_left = 2
	style.corner_radius_top_right = 2
	style.corner_radius_bottom_right = 2
	style.corner_radius_bottom_left = 2
	return style


## Creates the card panel style for the provided accent.
## Parameters:
## - accent_color: semantic notification accent color.
## Returns: stylebox used by the card panel.
func _create_card_style(accent_color: Color) -> StyleBoxFlat:
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(0.07, 0.05, 0.03, 0.96)
	style.border_color = Color(accent_color.r, accent_color.g, accent_color.b, 0.82)
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.corner_radius_top_left = 2
	style.corner_radius_top_right = 2
	style.corner_radius_bottom_right = 2
	style.corner_radius_bottom_left = 2
	return style


## Returns the accent color for a notification type.
## Parameters:
## - notification_type: normalized type string.
## Returns: HUD accent color.
func _get_type_color(notification_type: String) -> Color:
	match notification_type:
		"research":
			return Color(0.18, 0.62, 0.56, 1.0)
		"warning":
			return Color(0.96, 0.70, 0.26, 1.0)
		"error":
			return Color(0.88, 0.26, 0.20, 1.0)
		"combat":
			return Color(0.86, 0.36, 0.18, 1.0)
		"diplomacy":
			return Color(0.48, 0.31, 0.69, 1.0)
		_:
			return Color(0.96, 0.78, 0.38, 1.0)


## Returns the display title for a notification type.
## Parameters:
## - notification_type: normalized type string.
## Returns: uppercase title text.
func _get_type_title(notification_type: String) -> String:
	match notification_type:
		"research":
			return "RESEARCH"
		"warning":
			return "WARNING"
		"error":
			return "ERROR"
		"combat":
			return "COMBAT"
		"diplomacy":
			return "DIPLOMACY"
		_:
			return "NOTICE"


## Enforces the visible notification cap.
## Parameters: none.
## Returns: nothing.
func _trim_old_notifications() -> void:
	while get_child_count() > MAX_VISIBLE_NOTIFICATIONS:
		var oldest: Node = _get_oldest_removable_notification()
		if oldest == null:
			oldest = get_child(0)
		var notification_id: String = _get_notification_id_for_card(oldest)
		if not notification_id.is_empty():
			_interactive_cards.erase(notification_id)
			_interactive_payloads.erase(notification_id)
		remove_child(oldest)
		oldest.queue_free()


func _get_oldest_removable_notification() -> Node:
	for child: Node in get_children():
		if not bool(child.get_meta("interactive", false)):
			return child
	return null


func _get_notification_id_for_card(card: Node) -> String:
	for raw_notification_id: Variant in _interactive_cards.keys():
		var notification_id: String = str(raw_notification_id)
		if _interactive_cards.get(notification_id, null) == card:
			return notification_id
	return ""


## Plays the notification entry animation.
## Parameters:
## - card: notification card to animate.
## Returns: nothing.
func _play_entry_animation(card: PanelContainer) -> void:
	var tween: Tween = create_tween()
	tween.set_parallel(true)
	tween.tween_property(card, "modulate:a", 1.0, FADE_SECONDS)
	tween.tween_property(card, "position:x", 0.0, FADE_SECONDS)


## Removes a notification after its display duration.
## Parameters:
## - card: notification card to remove.
## Returns: nothing.
func _schedule_removal(card: PanelContainer) -> void:
	await get_tree().create_timer(DISPLAY_SECONDS).timeout
	if not is_instance_valid(card) or card.get_parent() != self:
		return
	var tween: Tween = create_tween()
	tween.set_parallel(true)
	tween.tween_property(card, "modulate:a", 0.0, FADE_SECONDS)
	tween.tween_property(card, "position:x", -18.0, FADE_SECONDS)
	await tween.finished
	if is_instance_valid(card) and card.get_parent() == self:
		remove_child(card)
		card.queue_free()


func _schedule_interactive_removal(notification_id: String) -> void:
	await get_tree().create_timer(DISPLAY_SECONDS).timeout
	var card: PanelContainer = _interactive_cards.get(notification_id, null) as PanelContainer
	if card == null or not is_instance_valid(card) or card.get_parent() != self:
		return
	var tween: Tween = create_tween()
	tween.set_parallel(true)
	tween.tween_property(card, "modulate:a", 0.0, FADE_SECONDS)
	tween.tween_property(card, "position:x", -18.0, FADE_SECONDS)
	await tween.finished
	if is_instance_valid(card) and card.get_parent() == self:
		remove_child(card)
		card.queue_free()
	_interactive_cards.erase(notification_id)
	_interactive_payloads.erase(notification_id)
