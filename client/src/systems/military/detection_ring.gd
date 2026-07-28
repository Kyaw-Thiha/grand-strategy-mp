extends Node2D
var _radius := 0.0
var _alpha  := 1.0

func _ready() -> void:
	var tw := create_tween().set_parallel(true)
	tw.tween_property(self, "_radius", 30.0, 0.6)
	tw.tween_property(self, "_alpha",  0.0,  0.6)
	tw.chain().tween_callback(queue_free)
	set_process(true)

func _process(_delta: float) -> void:
	queue_redraw()

func _draw() -> void:
	draw_arc(Vector2.ZERO, _radius, 0.0, TAU, 32, Color(0.2, 0.9, 1.0, _alpha), 2.0)
