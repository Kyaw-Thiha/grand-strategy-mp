extends Control

@onready var _result_label: Label = %ResultLabel


func _ready() -> void:
	SessionManager.session_ended.connect(_on_session_ended)


func _on_session_ended(winner_id: String, reason: String) -> void:
	if winner_id != "":
		_result_label.text = "Winner: " + winner_id + "\n" + reason
	else:
		_result_label.text = "Game over\n" + reason


func _on_main_menu_btn_pressed() -> void:
	SceneManager.goto_main_menu()
