shader_type canvas_item;

uniform vec2 surface_size = vec2(160.0, 110.0);
uniform vec2 icon_center = vec2(36.0, 72.0);
uniform float outer_radius = 32.0;
uniform float inner_radius = 26.0;
uniform vec2 tray_center = vec2(104.0, 31.0);
uniform vec2 tray_half_size = vec2(46.0, 23.0);
uniform float tray_corner_radius = 10.0;
uniform float selection_pop = 0.0;
uniform float selection_emphasis = 0.0;
uniform vec2 shadow_offset = vec2(0.0, 3.0);
uniform vec4 fill_color : source_color = vec4(0.047, 0.082, 0.125, 0.64);
uniform vec4 border_color : source_color = vec4(0.48, 0.63, 0.74, 0.42);
uniform vec4 shadow_color : source_color = vec4(0.005, 0.012, 0.022, 0.42);

float rounded_box_distance(vec2 point, vec2 center, vec2 half_size, float radius) {
	vec2 offset = abs(point - center) - half_size + vec2(radius);
	return min(max(offset.x, offset.y), 0.0) + length(max(offset, vec2(0.0))) - radius;
}

float surround_distance(vec2 point) {
	float circle = length(point - icon_center) - (outer_radius + selection_pop);
	float tray = rounded_box_distance(point, tray_center, tray_half_size, tray_corner_radius);
	float outer_union = min(circle, tray);
	float icon_cutout = length(point - icon_center) - (inner_radius + selection_pop);
	return max(outer_union, -icon_cutout);
}

void fragment() {
	vec2 point = UV * surface_size;
	float distance_to_surface = surround_distance(point);
	float antialias = max(fwidth(distance_to_surface), 0.75);
	float fill_mask = 1.0 - smoothstep(-antialias, antialias, distance_to_surface);
	float border_mask = 1.0 - smoothstep(0.35, 1.35 + antialias, abs(distance_to_surface));

	float shadow_distance = surround_distance(point - shadow_offset);
	float shadow_mask = (1.0 - smoothstep(-antialias, antialias, shadow_distance)) * (1.0 - fill_mask);

	float fill_alpha = fill_mask * fill_color.a;
	float border_alpha = border_mask * min(border_color.a + selection_emphasis * 0.28, 1.0);
	float surface_alpha = max(fill_alpha, border_alpha);
	float shadow_alpha = shadow_mask * shadow_color.a * (1.0 - surface_alpha);
	vec3 surface_rgb = mix(fill_color.rgb, border_color.rgb, border_mask);
	vec3 result_rgb = mix(shadow_color.rgb, surface_rgb, surface_alpha);
	COLOR = vec4(result_rgb, surface_alpha + shadow_alpha);
}
