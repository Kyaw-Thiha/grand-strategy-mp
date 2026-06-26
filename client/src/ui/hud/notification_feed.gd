extends VBoxContainer
## Bottom-left HUD notification feed.
## Owns transient visual notification cards only; notification producers emit
## EventBus.notification_requested(message, type).

const MAX_VISIBLE_NOTIFICATIONS: int = 4
const DISPLAY_SECONDS: float = 5.0
const FADE_SECONDS: float = 0.2
const CARD_WIDTH: float = 320.0
const CARD_MIN_HEIGHT: float = 56.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	alignment = BoxContainer.ALIGNMENT_END
	var push_callable: Callable = Callable(self, "push_notification")
	if has_node("/root/EventBus") and not EventBus.notification_requested.is_connected(push_callable):
		EventBus.notification_requested.connect(push_callable)


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
	add_child(card)
	_trim_old_notifications()
	_play_entry_animation(card)
	_schedule_removal(card)


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
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	card.add_child(margin)

	var row: HBoxContainer = HBoxContainer.new()
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
		_:
			return "NOTICE"


## Enforces the visible notification cap.
## Parameters: none.
## Returns: nothing.
func _trim_old_notifications() -> void:
	while get_child_count() > MAX_VISIBLE_NOTIFICATIONS:
		var oldest: Node = get_child(0)
		remove_child(oldest)
		oldest.queue_free()


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
