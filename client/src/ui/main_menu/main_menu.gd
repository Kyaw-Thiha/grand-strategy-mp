extends Control

@onready var _email_field: LineEdit    = %EmailField
@onready var _pass_field: LineEdit     = %PassField
@onready var _login_btn: Button        = %LoginBtn
@onready var _status_label: Label      = %StatusLabel
@onready var _post_login: VBoxContainer = %PostLogin
@onready var _code_field: LineEdit     = %JoinCodeField


func _ready() -> void:
	_post_login.hide()
	AuthManager.logged_in.connect(_on_login_succeeded)
	AuthManager.login_failed.connect(_on_login_failed)
	LobbySystem.lobby_created.connect(_on_lobby_created)
	LobbySystem.lobby_joined.connect(_on_lobby_joined)
	LobbySystem.lobby_join_failed.connect(_on_lobby_join_failed)

	if OS.is_debug_build():
		_email_field.text = "e2e-bot-a@example.com"
		_pass_field.text = "password123"

	if AuthManager.is_logged_in():
		_show_post_login()


func _on_login_btn_pressed() -> void:
	_login_btn.disabled = true
	_status_label.text = "Logging in..."
	await AuthManager.login(_email_field.text.strip_edges(), _pass_field.text)


func _on_login_succeeded(_user_id: String) -> void:
	_login_btn.disabled = false
	_status_label.text = ""
	_show_post_login()


func _on_login_failed(reason: String) -> void:
	_login_btn.disabled = false
	_status_label.text = "Login failed: " + reason


func _show_post_login() -> void:
	_post_login.show()
	# Hide Create Game button if player has no host pass
	var has_host_pass: bool = AuthManager.has_host_pass
	%CreateGameBtn.visible = has_host_pass


func _on_create_game_btn_pressed() -> void:
	_set_busy(true)
	await LobbySystem.create_lobby()


func _on_join_btn_pressed() -> void:
	var code: String = _code_field.text.strip_edges().to_upper()
	if code.length() != 6:
		_status_label.text = "Join code must be 6 characters"
		return
	_set_busy(true)
	await LobbySystem.join_by_code(code)


func _on_browse_btn_pressed() -> void:
	_set_busy(true)
	await LobbySystem.join_public_game()


func _on_lobby_created(_join_code: String, _room_id: String) -> void:
	SceneManager.goto_lobby()


func _on_lobby_joined(_room_id: String) -> void:
	SceneManager.goto_lobby()


func _on_lobby_join_failed(reason: String) -> void:
	_set_busy(false)
	_status_label.text = reason


func _set_busy(busy: bool) -> void:
	%CreateGameBtn.disabled = busy
	%JoinBtn.disabled = busy
	%BrowseBtn.disabled = busy
	_status_label.text = "Connecting..." if busy else ""
