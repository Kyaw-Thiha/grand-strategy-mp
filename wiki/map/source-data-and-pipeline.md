# Source Data and Pipeline

The map pipeline converts authored geographic data into a playable world with stable
province identities, terrain, cities, routes, adjacency, and client assets.

# Details

## Current source data

`map/europe_1938_6/` contains the complete GeoJSON source set for the current Western Europe
map. Province, city, cover, elevation, water, road, river, and port files use WGS84
longitude/latitude coordinates. Its `map.json` supplies the map identity, bounds, and
pipeline configuration.

`map/europe_1939_6/` currently contains only partial map metadata and terrain lookup data; it
is not a second complete playable pipeline input.

## Generation and validation

`pipeline.py` validates the selected source directory before processing it. It builds
province records, adjacency and movement data, passes through required terrain sources, and
writes generated client data under `client/assets/data/<map-id>/`. DEM processing can be
skipped when only non-heightmap outputs need regeneration.

The validator rejects missing required fields, duplicate or unknown province references,
invalid geometry types, invalid terrain categories, and out-of-range authored values.
Focused tests cover boundary nodes, HPA clusters, and nation tagging.

Generated Godot scenes are a separate editor-generation step. The Python source pipeline
owns geographic data; the client generator owns Godot-native scene composition.

## Implementation anchors

- `map/tools/map_pipeline/pipeline.py` — source-to-client generation entry point.
- `map/tools/map_pipeline/validate.py` — source schema and relationship validation.
- `map/tools/map_pipeline/test_boundary_nodes.py` — generated boundary-node checks.
- `map/tools/map_pipeline/test_hpa_clusters.py` — hierarchical pathfinding cluster checks.
- `map/europe_1938_6/HANDOFF.md` — current map-data handoff and output summary.

# Related Notes

- [[map/index|Map Production]]
- [[client/map/map-data-and-loading|Map Data and Loading]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [Map Production Design](../../docs/MAP_PRODUCTION_DOCS.md)
- [Map Data Contract](../../docs/MAP_DATA_CONTRACT.md)
- [Editor Map Generation](../../docs/EDITOR_MAP_GENERATION.md)
