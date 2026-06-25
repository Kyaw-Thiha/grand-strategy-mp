extends PanelContainer
## Research panel — full-center overlay, with Infantry/Artillery/Armoured/Air/Naval/Economy sub-tabs.
## Content will be replaced when Phase 10 implements the research tree.


func _ready() -> void:
	pass


func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null("Margin/TabBar")
	if tabs_node == null:
		return
	if not tabs_node is TabContainer:
		push_warning("ResearchPanel: Margin/TabBar is not a TabContainer")
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_child_count()
	if count <= 1:
		return
	var current: int = tabs.current_tab
	var next: int = current + (1 if forward else -1)
	tabs.current_tab = posmod(next, count)