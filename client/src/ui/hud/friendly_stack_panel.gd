extends PanelContainer
## Bottom selection bar panel — placeholder for future multi-select (stack) feature.
## Currently dead code — stack selection not implemented in military_system.

var _list_container: VBoxContainer


func _ready() -> void:
	_list_container = get_node_or_null("Margin/VBox/Scroll/ListContainer")


func populate(division_ids: Array) -> void:
	if _list_container == null:
		push_warning("FriendlyStackPanel: node refs not found — tscn may be broken")
		return

	for child: Node in _list_container.get_children():
		_list_container.remove_child(child)
		child.queue_free()

	for div_id: String in division_ids:
		var lbl: Label = Label.new()
		lbl.text = div_id
		lbl.add_theme_font_size_override("font_size", 12)
		_list_container.add_child(lbl)