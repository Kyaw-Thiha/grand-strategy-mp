extends Node2D
## Smooth unit-influence overlay for the frontline visualization.
## Each division projects two concentric circles in its nation's color.
## Set this node's CanvasItem material to a CanvasItemMaterial with Blend Mode = Add
## so overlapping circles from different nations mix additively rather than occluding each other.

const NATION_COLORS: Dictionary = {
	"germany":        Color(0.29, 0.29, 0.29),
	"france":         Color(0.0,  0.14, 0.58),
	"united_kingdom": Color(0.0,  0.07, 0.41),
	"italy":          Color(0.0,  0.57, 0.27),
	"spain":          Color(0.78, 0.04, 0.12),
	"algeria":        Color(0.0,  0.38, 0.20),
}
const NEUTRAL_COLOR := Color(0.5, 0.5, 0.5)

const INFLUENCE_RADIUS := 180.0
const ALPHA_INNER      := 0.30
const ALPHA_OUTER      := 0.08

var _map_loader: Node = null
var _divisions: Dictionary = {}  # div_id → { nation_id, hp }
var _icons_ref: Dictionary = {}  # reference to MilitarySystem._icons (DR positions)


func setup(map_loader: Node) -> void:
	_map_loader = map_loader

	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = mat

	EventBus.division_added.connect(_on_division_changed)
	EventBus.division_updated.connect(_on_division_changed)
	EventBus.division_removed.connect(_on_division_removed)

	# Catch up with divisions that already exist
	for div_id: String in GameState.divisions:
		_on_division_changed(div_id)


func set_icons_ref(icons: Dictionary) -> void:
	_icons_ref = icons


func _on_division_changed(div_id: String) -> void:
	var data: Dictionary = GameState.get_division(div_id)
	if data.is_empty() or data.get("combat_state", "") == "destroyed":
		_divisions.erase(div_id)
	else:
		_divisions[div_id] = {
			"nation_id": data.get("nation_id", ""),
			"hp":        float(data.get("hp", 100.0)),
		}
	queue_redraw()


func _on_division_removed(div_id: String) -> void:
	_divisions.erase(div_id)
	queue_redraw()


func _process(_delta: float) -> void:
	if not _icons_ref.is_empty():
		queue_redraw()


func _draw() -> void:
	if _map_loader == null:
		return
	for div_id: String in _divisions:
		var d: Dictionary = _divisions[div_id]
		var icon := _icons_ref.get(div_id) as Node2D
		if icon == null:
			continue
		var col: Color = NATION_COLORS.get(d["nation_id"], NEUTRAL_COLOR)
		var hp_frac: float = clampf(float(d["hp"]) / 100.0, 0.0, 1.0)
		var pos: Vector2 = icon.position
		draw_circle(pos, INFLUENCE_RADIUS,       Color(col.r, col.g, col.b, ALPHA_OUTER * hp_frac))
		draw_circle(pos, INFLUENCE_RADIUS * 0.5, Color(col.r, col.g, col.b, ALPHA_INNER * hp_frac))
