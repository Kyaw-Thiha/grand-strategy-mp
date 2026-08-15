extends Node
## Verifies move destination feedback setup, zoom compensation, and cleanup.

const MoveDestinationEffectScript := preload(
		"res://src/systems/military/move_destination_effect.gd")

var _failed: bool = false


func _ready() -> void:
	var camera: Camera2D = Camera2D.new()
	camera.zoom = Vector2(2.0, 2.0)
	camera.enabled = true
	add_child(camera)
	camera.make_current()

	var effect: MoveDestinationEffect = MoveDestinationEffectScript.new()
	var base_color: Color = Color(0.1, 0.2, 0.3)
	effect.setup(Vector2(120.0, 80.0), base_color)
	add_child(effect)

	_assert_eq(effect.position, Vector2(120.0, 80.0), "effect must use the destination position")
	_assert_true(effect.get_effect_color().get_luminance() > base_color.get_luminance(),
			"effect must lighten the nation color")

	await get_tree().process_frame
	await get_tree().process_frame
	effect._process(0.0)
	_assert_eq(effect.scale, Vector2(0.5, 0.5), "effect must compensate for camera zoom")

	await get_tree().create_timer(0.65).timeout
	await get_tree().process_frame
	_assert_true(not is_instance_valid(effect), "effect must free itself after its animation")

	if _failed:
		push_error("MoveDestinationEffect test FAILED")
		get_tree().quit(1)
		return
	print("MoveDestinationEffect test passed.")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)


func _assert_eq(actual: Variant, expected: Variant, message: String) -> void:
	if actual == expected:
		return
	_failed = true
	push_error("ASSERT EQ FAILED: %s actual=%s expected=%s" % [message, str(actual), str(expected)])
