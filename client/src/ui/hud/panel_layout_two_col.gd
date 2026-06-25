extends PanelContainer
class_name PanelLayoutTwoCol
## Reusable two-column layout: left fixed content area, right context-sensitive panel.
## Left col is the primary content (grid, list, tree).
## Right col swaps by selection state (empty when nothing selected, detail when item selected).
##
## Usage:
##   var layout: PanelLayoutTwoCol = $PanelLayoutTwoCol
##   layout.set_left_content(my_grid_node)
##   layout.set_right_content(detail_node)  # or clear_right_content()

signal left_item_selected(item_id: String)

var _left_container: Control
var _right_container: Control


func _ready() -> void:
	var margin: MarginContainer = $Margin
	var hbox: HBoxContainer = $Margin/HBox
	_left_container = $Margin/HBox/LeftCol
	_right_container = $Margin/HBox/RightCol


func set_left_content(node: Control) -> void:
	_clear_left()
	node.layout_mode = 1
	node.size_flags_horizontal = 3
	_left_container.add_child(node)


func set_right_content(node: Control) -> void:
	_clear_right()
	node.layout_mode = 1
	node.size_flags_horizontal = 2
	node.custom_minimum_size.x = 220
	_right_container.add_child(node)


func clear_left() -> void:
	_clear_left()


func clear_right() -> void:
	_clear_right()


func _clear_left() -> void:
	for child: Node in _left_container.get_children():
		_left_container.remove_child(child)
		child.queue_free()


func _clear_right() -> void:
	for child: Node in _right_container.get_children():
		_right_container.remove_child(child)
		child.queue_free()