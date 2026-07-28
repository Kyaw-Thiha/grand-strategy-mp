extends RefCounted
## Shared world-space draw ordering for combined-mask fog presentation.

const OCEAN_BACKGROUND_Z: int = -2
const MAP_OCEAN_Z: int = -1
const CARTOGRAPHY_MAX_Z: int = 20
const FOG_OVERLAY_Z: int = 25
const WORLD_MARKER_Z: int = 30


## Places a root marker layer above the fog overlay.
## Parameters:
## - layer: root containing world-space gameplay markers.
## Returns: nothing.
static func configure_world_marker_layer(layer: CanvasItem) -> void:
	layer.z_as_relative = false
	layer.z_index = WORLD_MARKER_Z
