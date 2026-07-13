shader_type canvas_item;

uniform int map_fill_mode = 0;

void fragment() {
	vec4 fill_color = COLOR;
	if (map_fill_mode == 1) {
		fill_color = vec4(0.55, 0.55, 0.55, 0.35);
	} else if (map_fill_mode == 2) {
		fill_color = vec4(0.0);
	}
	COLOR = fill_color;
}
