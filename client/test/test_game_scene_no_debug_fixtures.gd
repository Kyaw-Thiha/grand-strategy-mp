extends Node

var _failed: bool = false

const TEST_PROVINCE_ID: String = "we6_germany_01"
const FRANCE_COLOR: Color = Color(0.27, 0.51, 0.71)


func _ready() -> void:
	GameState.map_id = "western_europe_6"
	GameState.divisions.clear()
	GameState.air_wings.clear()
	GameState.air_wing_paths.clear()
	GameState.nations.clear()
	GameState.provinces = {TEST_PROVINCE_ID: {"owner_id": "france"}}
	AuthManager.user_id = ""

	var packed_scene: PackedScene = load("res://scenes/game/game.tscn")
	var game_scene: Node = packed_scene.instantiate()
	var map_loader: Node = game_scene.get_node("MapLoader")
	var map_load_state: Dictionary = {"loaded": false}
	map_loader.map_loaded.connect(func(_province_count: int) -> void:
		map_load_state["loaded"] = true
	)
	add_child(game_scene)
	await get_tree().process_frame
	_assert_true(bool(map_load_state["loaded"]), "production game scene must load the server-selected map")

	_assert_true(GameState.divisions.is_empty(), "production game scene must not inject debug divisions")
	_assert_true(GameState.air_wings.is_empty(), "production game scene must not inject debug air wings")
	_assert_true(AuthManager.user_id.is_empty(), "production game scene must not create a debug player")
	_assert_true(GameState.nations.is_empty(), "production game scene must not assign a debug nation")
	var province_node: Node2D = map_loader.get_province_node(TEST_PROVINCE_ID)
	var province_fill: Polygon2D = province_node.get_node("Fill")
	_assert_true(
		province_fill.color.is_equal_approx(FRANCE_COLOR),
		"production map colors must use current GameState ownership"
	)

	game_scene.queue_free()
	await get_tree().process_frame
	if _failed:
		print("TESTS FAILED - see errors above")
		get_tree().quit(1)
		return

	print("[PASS] test_game_scene_no_debug_fixtures: all tests passed")
	get_tree().quit(0)


func _assert_true(value: bool, message: String) -> void:
	if value:
		return
	_failed = true
	push_error("ASSERT TRUE FAILED: " + message)
