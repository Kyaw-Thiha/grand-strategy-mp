class_name LandSelectionSurround
extends Control
## Screen-space visual union surrounding one selected land counter and its action tray.

signal action_requested(action_id: StringName, division_id: String)

const ICON_OUTER_RADIUS := 32.0
const ICON_INNER_RADIUS := 26.0
const BUTTON_SIZE := Vector2(34.0, 34.0)
const DEFAULT_ICON_MAX_WIDTH := 22
const COMPOSITION_ICON_MAX_WIDTH := 24
const BUTTON_GAP := 4.0
const TRAY_PADDING := 6.0
const TRAY_HEIGHT := 46.0
const TRAY_CORNER_RADIUS := 10.0
const TRAY_CIRCLE_OVERLAP := 10.0
const TRAY_VERTICAL_OFFSET := 64.0
const MAX_TRAY_SLIDE := 20.0
const SURFACE_MARGIN := Vector4(4.0, 8.0, 4.0, 6.0)
const SELECTION_ENTER_DURATION := 0.12
const SELECTION_ENTER_RADIUS_BOOST := 8.0
const SELECTION_ENTER_START_ALPHA := 0.6
const ACTION_COMPOSITION: StringName = &"composition"
const ACTION_CENTER_CAMERA: StringName = &"center_camera"
const ACTION_HOLD: StringName = &"hold"
const ACTION_RETREAT: StringName = &"retreat"
const PLACEMENT_TOP_RIGHT: StringName = &"top_right"
const PLACEMENT_TOP_LEFT: StringName = &"top_left"
const PLACEMENT_BOTTOM_RIGHT: StringName = &"bottom_right"
const PLACEMENT_BOTTOM_LEFT: StringName = &"bottom_left"
const COMPOSITION_ICON := preload("res://assets/icons/table-cells-solid-full.svg")
const CENTER_CAMERA_ICON := preload("res://assets/icons/arrows-to-dot-solid-full.svg")
const HOLD_ICON := preload("res://assets/icons/hand-regular-full.svg")
const RETREAT_ICON := preload("res://assets/icons/person-running-solid-full.svg")

@export_range(2, 4, 1) var control_count: int = 2

@onready var _surface: ColorRect = $Surface

var _buttons: Array[Button] = []
var _button_actions: Array[StringName] = []
var _context_division_id: String = ""
var _hold_available: bool = false
var _retreat_available: bool = false
var _layout_revision: int = 0
var _armed_action: StringName = &""
var _armed_division_id: String = ""
var _armed_layout_revision: int = -1
var _selection_tween: Tween = null
var _placement: StringName = PLACEMENT_TOP_RIGHT
var _tray_slide: float = 0.0
var _anchor_position: Vector2 = Vector2.ZERO
var _icon_center: Vector2 = Vector2.ZERO


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_anchor_position = global_position + Vector2(36.0, 72.0)
	_ensure_buttons()
	_configure_controls()
	KeybindManager.bindings_changed.connect(_on_keybinds_changed)


## Rebuilds the tray for an isolated two-, three-, or four-control review variant.
func set_control_count(count: int) -> void:
	control_count = clampi(count, 2, 4)
	if is_node_ready():
		_configure_controls()


## Returns the supported placements in preferred fallback order.
## Parameters: none.
## Returns: top-right, top-left, bottom-right, and bottom-left identifiers.
func get_placements() -> Array[StringName]:
	return [
		PLACEMENT_TOP_RIGHT,
		PLACEMENT_TOP_LEFT,
		PLACEMENT_BOTTOM_RIGHT,
		PLACEMENT_BOTTOM_LEFT,
	]


## Returns the maximum inward tray correction accepted by each placement.
## Parameters: none.
## Returns: maximum slide in screen pixels.
func get_max_tray_slide() -> float:
	return MAX_TRAY_SLIDE


## Returns the active placement identifier.
## Parameters: none.
## Returns: current placement identifier.
func get_placement() -> StringName:
	return _placement


## Returns the active inward tray correction in pixels.
## Parameters: none.
## Returns: current slide in screen pixels.
func get_tray_slide() -> float:
	return _tray_slide


## Returns the complete surface bounds relative to its counter anchor.
## Parameters:
## - placement: one of the four placement constants exposed by get_placements().
## - tray_slide: inward horizontal correction, clamped to the supported range.
## Returns: anchor-relative bounds enclosing the shader surface and shadow.
func get_placement_bounds(placement: StringName, tray_slide: float = 0.0) -> Rect2:
	var geometry: Dictionary = _calculate_geometry(placement, tray_slide)
	return geometry.get("bounds", Rect2()) as Rect2


## Applies one tray placement while preserving the projected counter anchor.
## Parameters:
## - placement: one of the four placement constants exposed by get_placements().
## - tray_slide: inward horizontal correction in pixels.
## Returns: nothing.
func set_placement(placement: StringName, tray_slide: float = 0.0) -> void:
	if not get_placements().has(placement):
		return
	var clamped_slide: float = clampf(tray_slide, 0.0, MAX_TRAY_SLIDE)
	if placement == _placement and is_equal_approx(clamped_slide, _tray_slide):
		return
	_placement = placement
	_tray_slide = clamped_slide
	_layout_revision += 1
	_clear_armed_action()
	if is_node_ready():
		_configure_controls()


## Configures the selected division and its current state-specific actions.
## Parameters:
## - division_id: stable division context captured by action presses.
## - hold_available: whether the division currently passes MilitarySystem Hold eligibility.
## - retreat_available: whether the division currently passes MilitarySystem Retreat eligibility.
## Returns: nothing.
func set_action_context(
		division_id: String,
		hold_available: bool,
		retreat_available: bool = false
) -> void:
	if division_id == _context_division_id and hold_available == _hold_available \
			and retreat_available == _retreat_available:
		return
	_context_division_id = division_id
	_hold_available = hold_available
	_retreat_available = retreat_available
	_layout_revision += 1
	_clear_armed_action()
	if is_node_ready():
		_configure_controls()


## Places the enclosure center on a viewport-space division-counter anchor.
func set_anchor_position(screen_position: Vector2) -> void:
	_anchor_position = screen_position
	_apply_anchor_position()


## Returns the viewport-space center currently enclosed by this surface.
func get_anchor_position() -> Vector2:
	return _anchor_position


## Shows or hides the surface and invalidates any press armed before suspension.
## Parameters:
## - should_be_displayed: whether the connected surface should be visible.
## Returns: nothing.
func set_displayed(should_be_displayed: bool) -> void:
	if visible == should_be_displayed:
		return
	if not should_be_displayed:
		_layout_revision += 1
		_clear_armed_action()
	visible = should_be_displayed


## Returns the visible, tightly bounded native controls in display order.
func get_control_buttons() -> Array[Button]:
	var visible_buttons: Array[Button] = []
	for button: Button in _buttons:
		if button.visible:
			visible_buttons.append(button)
	return visible_buttons


## Returns every stable control so future hidden actions can pre-register input ownership.
func get_all_control_buttons() -> Array[Button]:
	return _buttons.duplicate()


## Plays the short entrance pop inherited from the former selected-counter ring.
## Parameters: none.
## Returns: nothing.
func play_selection_enter() -> void:
	if not is_node_ready():
		return
	if _selection_tween != null:
		_selection_tween.kill()
	_set_selection_enter_progress(0.0)
	_selection_tween = create_tween()
	_selection_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_selection_tween.tween_method(
		_set_selection_enter_progress,
		0.0,
		1.0,
		SELECTION_ENTER_DURATION
	)


func _ensure_buttons() -> void:
	if not _buttons.is_empty():
		return
	for index: int in 4:
		var button := Button.new()
		button.name = "Action%d" % (index + 1)
		button.theme_type_variation = &"TacticalOverlayButton"
		button.custom_minimum_size = BUTTON_SIZE
		button.size = BUTTON_SIZE
		button.expand_icon = true
		button.add_theme_constant_override("icon_max_width", DEFAULT_ICON_MAX_WIDTH)
		button.mouse_filter = Control.MOUSE_FILTER_STOP
		button.button_down.connect(_on_button_down.bind(index))
		button.pressed.connect(_on_button_pressed.bind(index))
		add_child(button)
		_buttons.append(button)
		_button_actions.append(&"")


func _configure_controls() -> void:
	_configure_action_button(0, ACTION_COMPOSITION, COMPOSITION_ICON, "Composition")
	_configure_action_button(1, ACTION_CENTER_CAMERA, CENTER_CAMERA_ICON, "Center Camera")
	if _hold_available:
		_configure_action_button(
			2,
			ACTION_HOLD,
			HOLD_ICON,
			"Hold [%s]" % KeybindManager.get_action_display_text("unit_hold")
		)
	elif _retreat_available:
		_configure_action_button(
			2,
			ACTION_RETREAT,
			RETREAT_ICON,
			"Retreat [%s]" % KeybindManager.get_action_display_text("unit_retreat")
		)
	else:
		_configure_placeholder_button(2)
	for index: int in range(3, _buttons.size()):
		_configure_placeholder_button(index)

	var visible_control_count: int = 3 if _hold_available or _retreat_available else control_count
	var tray_width: float = (BUTTON_SIZE.x * float(visible_control_count)) \
			+ (BUTTON_GAP * float(visible_control_count - 1)) + (TRAY_PADDING * 2.0)
	var geometry: Dictionary = _calculate_geometry(_placement, _tray_slide, tray_width)
	var bounds: Rect2 = geometry.get("bounds", Rect2()) as Rect2
	_icon_center = geometry.get("icon_center", Vector2.ZERO) as Vector2
	var tray_center: Vector2 = geometry.get("tray_center", Vector2.ZERO) as Vector2
	var button_origin: Vector2 = geometry.get("button_origin", Vector2.ZERO) as Vector2
	custom_minimum_size = bounds.size
	size = custom_minimum_size
	_surface.size = size
	var surface_material: ShaderMaterial = _surface.material as ShaderMaterial
	surface_material.set_shader_parameter("surface_size", size)
	surface_material.set_shader_parameter("icon_center", _icon_center)
	surface_material.set_shader_parameter("outer_radius", ICON_OUTER_RADIUS)
	surface_material.set_shader_parameter("inner_radius", ICON_INNER_RADIUS)
	surface_material.set_shader_parameter("tray_center", tray_center)
	surface_material.set_shader_parameter("tray_half_size", Vector2(tray_width, TRAY_HEIGHT) * 0.5)
	surface_material.set_shader_parameter("tray_corner_radius", TRAY_CORNER_RADIUS)

	for index: int in _buttons.size():
		var button: Button = _buttons[index]
		button.visible = index < visible_control_count
		button.position = button_origin + Vector2(
			float(index) * (BUTTON_SIZE.x + BUTTON_GAP),
			0.0
		)
	_apply_anchor_position()


## Calculates local shader and button geometry around the fixed counter anchor.
## Parameters:
## - placement: requested tray orientation.
## - tray_slide: inward horizontal correction.
## - tray_width_override: optional precomputed tray width.
## Returns: anchor-relative bounds and local shader/control positions.
func _calculate_geometry(
		placement: StringName,
		tray_slide: float,
		tray_width_override: float = -1.0
) -> Dictionary:
	var visible_control_count: int = 3 if _hold_available or _retreat_available else control_count
	var tray_width: float = tray_width_override
	if tray_width < 0.0:
		tray_width = (BUTTON_SIZE.x * float(visible_control_count)) \
				+ (BUTTON_GAP * float(visible_control_count - 1)) + (TRAY_PADDING * 2.0)
	var is_left: bool = placement == PLACEMENT_TOP_LEFT or placement == PLACEMENT_BOTTOM_LEFT
	var is_bottom: bool = placement == PLACEMENT_BOTTOM_RIGHT \
			or placement == PLACEMENT_BOTTOM_LEFT
	var inward_slide: float = clampf(tray_slide, 0.0, MAX_TRAY_SLIDE)
	var tray_left: float
	if is_left:
		tray_left = -(ICON_OUTER_RADIUS - TRAY_CIRCLE_OVERLAP) - tray_width + inward_slide
	else:
		tray_left = ICON_OUTER_RADIUS - TRAY_CIRCLE_OVERLAP - inward_slide
	var tray_top: float = TRAY_VERTICAL_OFFSET - TRAY_HEIGHT if is_bottom else -TRAY_VERTICAL_OFFSET
	var animated_circle_extent: float = ICON_OUTER_RADIUS + SELECTION_ENTER_RADIUS_BOOST
	var relative_bounds := Rect2(
		Vector2(
			minf(-animated_circle_extent, tray_left) - SURFACE_MARGIN.x,
			minf(-animated_circle_extent, tray_top) - SURFACE_MARGIN.y
		),
		Vector2.ZERO
	)
	var maximum := Vector2(
		maxf(animated_circle_extent, tray_left + tray_width) + SURFACE_MARGIN.z,
		maxf(animated_circle_extent, tray_top + TRAY_HEIGHT) + SURFACE_MARGIN.w
	)
	relative_bounds.size = maximum - relative_bounds.position
	return {
		"bounds": relative_bounds,
		"icon_center": -relative_bounds.position,
		"tray_center": Vector2(
			tray_left + (tray_width * 0.5),
			tray_top + (TRAY_HEIGHT * 0.5)
		) - relative_bounds.position,
		"button_origin": Vector2(
			tray_left + TRAY_PADDING,
			tray_top + TRAY_PADDING
		) - relative_bounds.position,
	}


func _apply_anchor_position() -> void:
	global_position = _anchor_position - _icon_center


func _configure_action_button(
		index: int,
		action_id: StringName,
		icon_texture: Texture2D,
		tooltip: String
) -> void:
	var button: Button = _buttons[index]
	_button_actions[index] = action_id
	button.name = String(action_id).to_pascal_case()
	if action_id == ACTION_HOLD:
		button.theme_type_variation = &"TacticalHoldButton"
	elif action_id == ACTION_RETREAT:
		button.theme_type_variation = &"TacticalRetreatButton"
	else:
		button.theme_type_variation = &"TacticalOverlayButton"
	button.text = ""
	button.icon = icon_texture
	button.add_theme_constant_override(
		"icon_max_width",
		COMPOSITION_ICON_MAX_WIDTH if action_id == ACTION_COMPOSITION else DEFAULT_ICON_MAX_WIDTH
	)
	button.tooltip_text = tooltip
	button.disabled = false


func _configure_placeholder_button(index: int) -> void:
	var button: Button = _buttons[index]
	_button_actions[index] = &""
	button.theme_type_variation = &"TacticalOverlayButton"
	button.name = "FutureAction%d" % (index + 1)
	button.text = String.chr(65 + index)
	button.icon = null
	button.add_theme_constant_override("icon_max_width", DEFAULT_ICON_MAX_WIDTH)
	button.tooltip_text = "Future state-specific action"
	button.disabled = true


func _on_button_down(index: int) -> void:
	if index < 0 or index >= _button_actions.size():
		return
	var action_id: StringName = _button_actions[index]
	if action_id.is_empty() or _context_division_id.is_empty():
		return
	_armed_action = action_id
	_armed_division_id = _context_division_id
	_armed_layout_revision = _layout_revision


func _on_button_pressed(index: int) -> void:
	var action_id: StringName = _armed_action
	var division_id: String = _armed_division_id
	var armed_revision: int = _armed_layout_revision
	_clear_armed_action()
	if index < 0 or index >= _button_actions.size():
		return
	if action_id.is_empty() or division_id.is_empty():
		return
	if armed_revision != _layout_revision or action_id != _button_actions[index]:
		return
	if division_id != _context_division_id or not _buttons[index].visible \
			or _buttons[index].disabled:
		return
	action_requested.emit(action_id, division_id)


func _clear_armed_action() -> void:
	_armed_action = &""
	_armed_division_id = ""
	_armed_layout_revision = -1


func _set_selection_enter_progress(progress: float) -> void:
	var eased_progress: float = clampf(progress, 0.0, 1.0)
	var inverse_progress: float = 1.0 - eased_progress
	var surface_material: ShaderMaterial = _surface.material as ShaderMaterial
	surface_material.set_shader_parameter(
		"selection_pop",
		SELECTION_ENTER_RADIUS_BOOST * inverse_progress
	)
	surface_material.set_shader_parameter("selection_emphasis", inverse_progress)
	var opacity: float = lerpf(SELECTION_ENTER_START_ALPHA, 1.0, eased_progress)
	_surface.self_modulate.a = opacity
	for button: Button in _buttons:
		button.self_modulate.a = opacity


func _on_keybinds_changed() -> void:
	if not _hold_available and not _retreat_available:
		return
	_layout_revision += 1
	_clear_armed_action()
	_configure_controls()
