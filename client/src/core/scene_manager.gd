extends Node
## Handles all scene transitions. Single point of control for moving between
## main menu, lobby, game, and postgame screens.

signal scene_changed(scene_name: String)

const SCENE_MAIN_MENU := "res://scenes/main_menu/main_menu.tscn"
const SCENE_LOBBY     := "res://scenes/lobby/lobby.tscn"
const SCENE_GAME      := "res://scenes/debug/map_debug.tscn"  # Phase 3: reuse map debug
const SCENE_POSTGAME  := "res://scenes/postgame/postgame.tscn"


func goto_main_menu() -> void:
	_transition(SCENE_MAIN_MENU, "main_menu")


func goto_lobby() -> void:
	_transition(SCENE_LOBBY, "lobby")


func goto_game() -> void:
	_transition(SCENE_GAME, "game")


func goto_postgame() -> void:
	_transition(SCENE_POSTGAME, "postgame")


func _transition(scene_path: String, scene_name: String) -> void:
	get_tree().change_scene_to_file(scene_path)
	scene_changed.emit(scene_name)
