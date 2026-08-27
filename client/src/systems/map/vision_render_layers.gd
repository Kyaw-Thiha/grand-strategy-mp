extends RefCounted
## Shared world-space draw ordering for combined-mask fog presentation.

const OCEAN_BACKGROUND_Z: int = -3
const MAP_OCEAN_Z: int = -2
## Subprovince preview fills (Batch 6). Strictly below province Fill Polygon2D nodes,
## which have no explicit z-index (implicit sibling z=0), and strictly below FOG_OVERLAY_Z.
## Also strictly ABOVE MAP_OCEAN_Z: that layer is a large opaque Polygon2D covering the
## full map bounds (vision_system.gd's _map_ocean_background) — sharing its z-index would
## make same-z tree-order tie-breaking decide whether the ocean draws over the subprovince
## layer, which it did before this constant was separated out (regression, fixed here).
const SUBPROVINCE_FILL_Z: int = -1
## Subprovince preview borders. Same numeric layer as SUBPROVINCE_FILL_Z (both strictly
## above MAP_OCEAN_Z, below province fills' implicit z=0, and below FOG_OVERLAY_Z); the
## border Node2D is added as a later sibling of the fill Node2D in SubprovinceRenderer, so
## within this shared layer borders still draw above fills via canvas-item tree order.
const SUBPROVINCE_BORDER_Z: int = -1
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
