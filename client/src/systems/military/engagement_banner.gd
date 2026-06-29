extends Node2D
## Map combat indicator: colored circle + crossed swords.
## Circle color reflects attacker advantage (green=winning, red=losing, grey=even).

var _engagement_id:    String     = ""
var _div_a_id:         String     = ""
var _div_b_id:         String     = ""
var _atk_hp_pct:       float      = 0.5
var _def_hp_pct:       float      = 0.5
var _suppression_warn: bool       = false
var _icons:            Dictionary = {}

var _pulse_alpha: float = 1.0
var _pulse_dir:   float = -1.0

const CIRCLE_R: float = 16.0
const CLICK_R:  float = 20.0
const OFFSET_Y: float = -30.0

const ATK_WARN_HP: float = 0.20
const DEF_WARN_HP: float = 0.40

const C_GREEN:  Color = Color(0.20, 0.75, 0.35, 1.0)
const C_RED:    Color = Color(0.75, 0.20, 0.20, 1.0)
const C_NEUTRAL:Color = Color(0.70, 0.70, 0.70, 1.0)
const C_BORDER: Color = Color(0.08, 0.05, 0.02, 0.8)


func setup(div_a: String, div_b: String, icon_dict: Dictionary, eng_id: String) -> void:
	_div_a_id      = div_a
	_div_b_id      = div_b
	_icons         = icon_dict
	_engagement_id = eng_id
	EventBus.division_updated.connect(_on_division_updated)
	EventBus.round_resolved.connect(_on_round_resolved)
	queue_redraw()

func get_atk_hp_pct()        -> float: return _atk_hp_pct
func get_def_hp_pct()        -> float: return _def_hp_pct
func get_suppression_warning()-> bool:  return _suppression_warn

func update_hp(atk: float, def_pct: float) -> void:
	_atk_hp_pct       = clamp(atk,     0.0, 1.0)
	_def_hp_pct       = clamp(def_pct, 0.0, 1.0)
	_suppression_warn = _atk_hp_pct < ATK_WARN_HP or _def_hp_pct < DEF_WARN_HP
	queue_redraw()

func cleanup() -> void:
	if EventBus.division_updated.is_connected(_on_division_updated):
		EventBus.division_updated.disconnect(_on_division_updated)
	if EventBus.round_resolved.is_connected(_on_round_resolved):
		EventBus.round_resolved.disconnect(_on_round_resolved)
	queue_free()

func get_uses_dashed_border() -> bool: return false

func get_border_color() -> Color:
	return Color(1.0, 0.5, 0.0, _pulse_alpha) if _suppression_warn else C_NEUTRAL

func get_advantage_color() -> Color:
	return _compute_advantage_color()

func _compute_advantage_color() -> Color:
	var diff := _atk_hp_pct - _def_hp_pct
	if diff > 0.02:
		return C_NEUTRAL.lerp(C_GREEN, diff)
	elif diff < -0.02:
		return C_NEUTRAL.lerp(C_RED, -diff)
	return C_NEUTRAL


func _process(delta: float) -> void:
	if _icons.has(_div_a_id) and _icons.has(_div_b_id):
		var pa: Vector2 = _icons[_div_a_id].position
		var pb: Vector2 = _icons[_div_b_id].position
		position = (pa + pb) * 0.5 + Vector2(0.0, OFFSET_Y)

	if _suppression_warn:
		_pulse_alpha += _pulse_dir * delta * 2.0
		if _pulse_alpha <= 0.6:
			_pulse_alpha = 0.6
			_pulse_dir   = 1.0
		elif _pulse_alpha >= 1.0:
			_pulse_alpha = 1.0
			_pulse_dir   = -1.0
		queue_redraw()


func _draw() -> void:
	var color := _compute_advantage_color()
	if _suppression_warn:
		color.a = _pulse_alpha

	draw_circle(Vector2.ZERO, CIRCLE_R, color)
	draw_arc(Vector2.ZERO, CIRCLE_R, 0.0, TAU, 24, C_BORDER, 1.5)

	draw_line(Vector2(-5.0, -5.0), Vector2( 5.0,  5.0), Color.WHITE, 2.0)
	draw_line(Vector2( 5.0, -5.0), Vector2(-5.0,  5.0), Color.WHITE, 2.0)


func _input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	if not event.pressed or event.button_index != MOUSE_BUTTON_LEFT:
		return
	var local := to_local(get_global_mouse_position())
	if local.length() <= CLICK_R:
		EventBus.tactical_combat_opened.emit(_engagement_id)
		get_viewport().set_input_as_handled()


func _on_division_updated(div_id: String) -> void:
	if div_id == _div_a_id or div_id == _div_b_id:
		_refresh_hp()

func _on_round_resolved(eng_id: String, _rn: int, _lp: String,
						_ad: Array, _dd: Array, _fb: Array, _tur: int) -> void:
	if (eng_id.begins_with(_div_a_id + "_vs_" + _div_b_id) or
		eng_id.begins_with(_div_b_id + "_vs_" + _div_a_id)):
		_refresh_hp()

func _refresh_hp() -> void:
	var div_a = GameState.get_division(_div_a_id)
	var div_b = GameState.get_division(_div_b_id)
	if div_a == null or div_b == null:
		return
	var hp_a := float(div_a.get("hp", 100)) / 100.0
	var hp_b := float(div_b.get("hp", 100)) / 100.0
	update_hp(hp_a, hp_b)
