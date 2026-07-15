extends RefCounted


static func get_remaining_endpoints(path_data: Dictionary, elapsed_ms: float) -> Array:
	var path_type: String = path_data.get("path_type", "")
	if path_type == "LOITER":
		return []

	var segments: Array = path_data.get("segments", [])
	if segments.is_empty():
		return []

	var speed: float  = path_data.get("speed_deg_per_ms", 0.001)
	var total: float  = path_data.get("total_length_deg", 1e9)
	var dist: float   = clampf(elapsed_ms * speed, 0.0, total)
	var results: Array = []
	var found := false

	for seg in segments:
		var seg_len: float = seg.get("length_deg", 0.0)
		if not found:
			if dist >= seg_len:
				dist -= seg_len
				continue
			found = true

		if seg.get("type", "") == "arc":
			var clng: float  = seg.get("center_lng", 0.0)
			var clat: float  = seg.get("center_lat", 0.0)
			var r: float     = seg.get("radius_deg", 0.0)
			var end_a: float = seg.get("start_angle_rad", 0.0) + seg.get("sweep_rad", 0.0)
			results.append(Vector2(clng + cos(end_a) * r, clat + sin(end_a) * r))
		else:
			results.append(Vector2(seg.get("end_lng", 0.0), seg.get("end_lat", 0.0)))

	return results


static func evaluate_position(path_data: Dictionary, elapsed_ms: int) -> Vector2:
	if path_data.is_empty():
		return Vector2.INF

	# LOITER paths are infinite loops — wrap elapsed so the wing keeps circling
	if path_data.get("path_type", "") == "LOITER":
		var speed: float = float(path_data.get("speed_deg_per_ms", 0.0))
		var total_length: float = float(path_data.get("total_length_deg", 0.0))
		if speed > 0.0 and total_length > 0.0:
			var period_ms: float = total_length / speed
			elapsed_ms = int(fmod(float(elapsed_ms), period_ms))

	var segments: Array = path_data.get("segments", [])
	var start_point: Vector2 = _get_path_start_point(path_data)
	var end_point: Vector2 = _get_path_end_point(path_data)
	if segments.is_empty():
		if start_point == Vector2.INF or end_point == Vector2.INF:
			return Vector2.INF
		return start_point.lerp(end_point, _clamp_elapsed_fraction(path_data, elapsed_ms))

	var speed_deg_per_ms: float = float(path_data.get("speed_deg_per_ms", 0.0))
	var total_length_deg: float = float(path_data.get("total_length_deg", 0.0))
	var distance_covered: float = clampf(float(elapsed_ms) * speed_deg_per_ms, 0.0, total_length_deg)
	var remaining: float = distance_covered
	var last_point: Vector2 = start_point

	for segment_variant: Variant in segments:
		if not segment_variant is Dictionary:
			continue
		var segment: Dictionary = segment_variant
		var segment_length: float = float(segment.get("length_deg", 0.0))
		if remaining <= segment_length:
			if str(segment.get("type", "straight")) == "arc":
				return _evaluate_arc_segment(segment, remaining)
			return _evaluate_straight_segment(segment, last_point, remaining)
		remaining -= segment_length
		last_point = _get_segment_end_point(segment, last_point)

	if end_point != Vector2.INF:
		return end_point
	return last_point


static func _evaluate_straight_segment(segment: Dictionary, fallback_start: Vector2, remaining: float) -> Vector2:
	var start_point: Vector2 = _get_segment_start_point(segment)
	if start_point == Vector2.INF:
		start_point = fallback_start
	var end_point: Vector2 = _get_segment_end_point(segment, start_point)
	var length_deg: float = float(segment.get("length_deg", 0.0))
	var t: float = 1.0 if length_deg <= 0.0 else clampf(remaining / length_deg, 0.0, 1.0)
	return start_point.lerp(end_point, t)


static func _evaluate_arc_segment(segment: Dictionary, remaining: float) -> Vector2:
	var radius_deg: float = float(segment.get("radius_deg", 0.0))
	var start_angle_rad: float = float(segment.get("start_angle_rad", 0.0))
	var sweep_rad: float = float(segment.get("sweep_rad", 0.0))
	if radius_deg <= 0.0 or sweep_rad == 0.0:
		return _get_segment_end_point(segment, Vector2.INF)

	var travelled_rad: float = remaining / radius_deg
	var signed_travel_rad: float = travelled_rad if sweep_rad >= 0.0 else -travelled_rad
	var angle: float = start_angle_rad + signed_travel_rad
	var center_point: Vector2 = Vector2(float(segment.get("center_lng", 0.0)), float(segment.get("center_lat", 0.0)))
	return center_point + Vector2(cos(angle), sin(angle)) * radius_deg


static func _clamp_elapsed_fraction(path_data: Dictionary, elapsed_ms: int) -> float:
	var speed_deg_per_ms: float = float(path_data.get("speed_deg_per_ms", 0.0))
	var total_length_deg: float = float(path_data.get("total_length_deg", 0.0))
	if speed_deg_per_ms <= 0.0 or total_length_deg <= 0.0:
		return 0.0
	return clampf(float(elapsed_ms) * speed_deg_per_ms / total_length_deg, 0.0, 1.0)


static func _get_path_start_point(path_data: Dictionary) -> Vector2:
	if path_data.has("start_lng") and path_data.has("start_lat"):
		return Vector2(float(path_data.get("start_lng", 0.0)), float(path_data.get("start_lat", 0.0)))
	var segments: Array = path_data.get("segments", [])
	if segments.is_empty():
		return Vector2.INF
	return _get_segment_start_point(segments[0])


static func _get_path_end_point(path_data: Dictionary) -> Vector2:
	if path_data.has("end_lng") and path_data.has("end_lat"):
		return Vector2(float(path_data.get("end_lng", 0.0)), float(path_data.get("end_lat", 0.0)))
	var segments: Array = path_data.get("segments", [])
	if segments.is_empty():
		return Vector2.INF
	return _get_segment_end_point(segments.back(), Vector2.INF)


static func _get_segment_start_point(segment: Dictionary) -> Vector2:
	if segment.has("start_lng") and segment.has("start_lat"):
		return Vector2(float(segment.get("start_lng", 0.0)), float(segment.get("start_lat", 0.0)))
	return Vector2.INF


static func _get_segment_end_point(segment: Dictionary, fallback_start: Vector2) -> Vector2:
	if segment.has("end_lng") and segment.has("end_lat"):
		return Vector2(float(segment.get("end_lng", 0.0)), float(segment.get("end_lat", 0.0)))
	return fallback_start
