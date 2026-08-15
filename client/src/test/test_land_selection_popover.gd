extends Node
## Targeted checks for the owned-land contextual selection UI and counter status data.

const POPOVER_SCENE := preload("res://scenes/game/panels/land_selection_popover.tscn")
const DIVISION_ICON_SCENE := preload("res://scenes/systems/military/division_icon.tscn")
const MILITARY_SYSTEM_SCRIPT := preload("res://src/systems/military/military_system.gd")

var _pass_count: int = 0
var _fail_count: int = 0


func _ready() -> void:
	GameState.divisions = {
		"france_div_01": {
			"division_id": "france_div_01",
			"nation_id": "france",
			"division_type": "infantry",
			"template_id": "",
			"hp": 72.0,
			"max_hp": 120.0,
			"suppression": 35.0,
			"combat_state": "idle",
			"supply_status": "normal",
		},
		"france_div_02": {
			"division_id": "france_div_02",
			"nation_id": "france",
			"division_type": "armoured",
			"template_id": "armour_test",
			"hp": 40.0,
			"max_hp": 100.0,
			"suppression": 80.0,
			"combat_state": "engaged",
			"supply_status": "out_of_supply",
		},
	}

	var popover: Control = POPOVER_SCENE.instantiate()
	add_child(popover)
	await get_tree().process_frame
	EventBus.division_selection_changed.emit(["france_div_01"] as Array[String])
	EventBus.division_active_changed.emit("france_div_01")
	EventBus.division_inspector_requested.emit("france_div_01")
	popover.set_anchor_available(true)
	_check(popover.visible, "single click request opens inspector")
	_check(popover.get_node("Margin/Content/Header/Title").text == "france_div_01", "inspector shows active division identity")
	_check(popover.get_node("Margin/Content/Body").visible, "single inspector shows composition body")

	var opened_composition_ids: Array[String] = []
	EventBus.division_template_viewer_open_requested.connect(func(division_id: String) -> void:
		opened_composition_ids.append(division_id)
	)
	(popover.get_node("Margin/Content/Body/Composition") as Button).pressed.emit()
	_check(opened_composition_ids == ["france_div_01"], "composition opens for active division")

	(popover.get_node("Margin/Content/Header/Close") as Button).pressed.emit()
	_check(not popover.is_display_requested(), "closing single inspector preserves selection without display")

	EventBus.division_hover_changed.emit("france_div_01")
	await get_tree().create_timer(0.35).timeout
	popover.set_anchor_available(true)
	_check(not popover.visible, "owned division hover no longer opens delayed preview")
	GameState.divisions["france_div_01"]["division_type"] = "motorized"
	EventBus.division_updated.emit("france_div_01")
	EventBus.division_hover_changed.emit("")
	_check(not popover.is_display_requested(), "hover transitions do not affect legacy inspector visibility")

	EventBus.division_active_changed.emit("france_div_02")
	EventBus.division_selection_changed.emit(["france_div_01", "france_div_02"] as Array[String])
	popover.set_anchor_available(true)
	_check(popover.get_node("Margin/Content/InspectChip").visible, "box selection starts as collapsed group chip")
	(popover.get_node("Margin/Content/InspectChip") as Button).pressed.emit()
	popover.set_anchor_available(true)
	_check(popover.get_node("Margin/Content/Roster").visible, "expanded group shows selected roster")
	_check(popover.get_node("Margin/Content/Body").visible, "expanded group shows active composition")
	_check((popover.get_node("Margin/Content/Actions/Retreat") as Button).visible, "group exposes contextual retreat when applicable")

	var active_requests: Array[String] = []
	var remove_requests: Array[String] = []
	EventBus.division_active_requested.connect(func(division_id: String) -> void: active_requests.append(division_id))
	EventBus.division_selection_remove_requested.connect(func(division_id: String) -> void: remove_requests.append(division_id))
	var first_roster_row: HBoxContainer = popover.get_node("Margin/Content/Roster").get_child(0) as HBoxContainer
	(first_roster_row.get_child(0) as Button).pressed.emit()
	(first_roster_row.get_child(1) as Button).pressed.emit()
	_check(active_requests == ["france_div_01"], "roster chip requests active division without replacing group")
	_check(remove_requests == ["france_div_01"], "roster remove emits selection intent")
	EventBus.division_selection_changed.emit(["france_div_02"] as Array[String])
	popover.set_anchor_available(true)
	_check(popover.get_node("Margin/Content/Body").visible, "removing from an expanded group keeps remaining inspector open")

	var icon: Node2D = DIVISION_ICON_SCENE.instantiate()
	add_child(icon)
	icon.setup(GameState.get_division("france_div_01"), Color.BLUE, 60.0, 45.0, 60.0)
	icon.set_visual_emphasis(0.92)
	_check(is_equal_approx(icon.get_visual_emphasis(), 0.92), "ordinary land counter uses slight baseline emphasis")
	await get_tree().create_timer(0.15).timeout
	_check(is_equal_approx(icon.self_modulate.a, 0.92), "ordinary emphasis transitions smoothly to its target")
	_check(is_equal_approx(float(icon.get("hp")), 72.0), "counter receives current HP")
	_check(is_equal_approx(float(icon.get("max_hp")), 120.0), "counter receives maximum HP")
	_check(is_equal_approx(float(icon.get("suppression")), 35.0), "counter receives suppression")
	icon.set_selected(true)
	icon.set_active_selection(true)
	_check(bool(icon.get("is_active_selection")), "counter distinguishes active member of selection")

	var second_icon: Node2D = DIVISION_ICON_SCENE.instantiate()
	add_child(second_icon)
	second_icon.position = Vector2(100.0, 0.0)
	second_icon.setup(GameState.get_division("france_div_02"), Color.BLUE, 60.0, 45.0, 60.0)
	var military: Node = MILITARY_SYSTEM_SCRIPT.new()
	add_child(military)
	military.set("_icons", {"france_div_01": icon, "france_div_02": second_icon})
	military.call("_refresh_all_icon_visual_emphasis")
	_check(is_equal_approx(icon.get_visual_emphasis(), 0.92), "visible friendly counter receives ordinary emphasis")
	_check(is_equal_approx(second_icon.get_visual_emphasis(), 0.92), "visible enemy counter receives the same ordinary emphasis")
	military.call("_commit_selection", ["france_div_01"] as Array[String], "france_div_01")
	_check(is_equal_approx(icon.get_visual_emphasis(), 1.0), "selected land counter receives full emphasis")
	_check(military.get("_icons").size() == 2, "emphasis styling does not create division counters")
	second_icon.visible = false
	military.call("_refresh_all_icon_visual_emphasis")
	_check(not second_icon.visible, "emphasis styling does not bypass fog visibility")
	second_icon.visible = true
	military.call("_add_to_selection", "france_div_02")
	var selected_ids: Array[String] = military.get("_selected_division_ids")
	_check(selected_ids == ["france_div_01", "france_div_02"], "shift-style add preserves existing land selection")
	_check(military.get("_selected_division_id") == "france_div_02", "newly added division becomes active")
	military.call("_set_active_division", "france_div_01")
	military.call("_remove_from_selection", "france_div_01")
	selected_ids = military.get("_selected_division_ids")
	_check(selected_ids == ["france_div_02"], "selection removal preserves remaining division")
	_check(military.get("_selected_division_id") == "france_div_02", "removing active division promotes a remaining member")
	military.set("_selection_preview_division_ids", ["france_div_01"] as Array[String])
	military.set("_drag_select_additive", false)
	military.set("_drag_select_subtractive", false)
	military.set("_drag_select_current_screen", Vector2.ZERO)
	military.call("_commit_drag_selection")
	selected_ids = military.get("_selected_division_ids")
	_check(selected_ids == ["france_div_01"], "plain drag commit replaces selection with typed preview IDs")
	var original_canvas_transform: Transform2D = get_viewport().get_canvas_transform()
	get_viewport().canvas_transform = Transform2D().scaled(Vector2(4.0, 4.0))
	_check(military.find_division_at_world(Vector2(6.0, 0.0)).is_empty(), "counter hit threshold remains 20 screen pixels at high zoom")
	get_viewport().canvas_transform = original_canvas_transform
	military.set("_hovered_division_id", "france_div_02")
	military.set("_drag_select_pressed", true)
	military.set("_drag_select_active", true)
	military.cancel_pointer_interaction()
	_check(military.get("_hovered_division_id") == "", "UI pointer ownership clears pending unit hover")
	_check(not bool(military.get("_drag_select_pressed")), "UI pointer ownership cancels an unfinished drag selection")

	_finish()


func _check(condition: bool, label: String) -> void:
	if condition:
		_pass_count += 1
		print("PASS: ", label)
	else:
		_fail_count += 1
		print("FAIL: ", label)


func _finish() -> void:
	if _fail_count == 0:
		print("ALL PASS (%d checks)" % _pass_count)
	else:
		print("FAILED %d / %d checks" % [_fail_count, _pass_count + _fail_count])
	get_tree().quit(0 if _fail_count == 0 else 1)
