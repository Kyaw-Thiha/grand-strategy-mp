extends RefCounted
## Shared world-space draw ordering for combined-mask fog presentation.

const OCEAN_BACKGROUND_Z: int = -2
const MAP_OCEAN_Z: int = -1
## Subprovince preview fills (Batch 6). Deliberately z_index = 0, the same numeric value as
## province Fill Polygon2D nodes (which have no explicit z-index at all — implicit z=0,
## z_as_relative=true). Since neither MapScene nor any ancestor sets a nonzero z_index, an
## explicit z_index=0 with z_as_relative=false resolves to the exact same absolute depth as
## "unset" — this is not a no-op choice, it reproduces the working pre-Batch-6-z-index
## configuration exactly (SubprovinceRenderer is added as MapScene's last child at runtime,
## so at equal z_index it draws on top of earlier siblings via tree-order tie-break,
## including MAP_OCEAN_Z below). A previous attempt used z_index=-1 here to sit strictly
## below province fills, which put it at the SAME z_index as MAP_OCEAN_Z (also -1 at the
## time) — same-z tree-order tie-breaking let the opaque ocean layer draw over the
## subprovince layer, hiding it entirely (a real regression, reported and reverted). Do not
## reintroduce a negative value here without re-verifying against MAP_OCEAN_Z.
const SUBPROVINCE_FILL_Z: int = 0
## Subprovince preview borders. Same z_index as SUBPROVINCE_FILL_Z; the border Node2D is
## added as a later sibling of the fill Node2D in SubprovinceRenderer, so within this shared
## layer borders still draw above fills via canvas-item tree order.
const SUBPROVINCE_BORDER_Z: int = 0
const CARTOGRAPHY_MAX_Z: int = 20
## Supply-route visualization overlay draw layer.
const SUPPLY_ROUTE_Z: int = 22
const FOG_OVERLAY_Z: int = 25
const WORLD_MARKER_Z: int = 30


## Places a root marker layer above the fog overlay.
## Parameters:
## - layer: root containing world-space gameplay markers.
## Returns: nothing.
static func configure_world_marker_layer(layer: CanvasItem) -> void:
	layer.z_as_relative = false
	layer.z_index = WORLD_MARKER_Z
