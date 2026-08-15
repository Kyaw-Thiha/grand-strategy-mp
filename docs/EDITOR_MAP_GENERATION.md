# Editor Map Generation

Reference doc for the stage-one Godot editor map generator.

---

## What Was Added

`client/src/utils/map-generator.gd` is an `EditorScript` that generates a static Godot scene from processed map assets.

Default input:

```text
res://assets/data/western_europe_6
```

Default output directory:

```text
res://scenes/map
```

The generated scene filename is derived from the input folder name. With the default input, the output path is:

```text
res://scenes/map/western_europe_6.scn
```

Generated map scenes are saved as binary `.scn` files because the generated polygon arrays are large. The source of truth stays in the reviewable map data under `res://assets/data/<map_id>`.

---

## Generated Scene Contents

The generated root is a `Node2D` named after the map folder. It stores the source asset folder in metadata as `map_asset_root`.

The script generates these layers:

| Layer | Source file | Notes |
|---|---|---|
| `WaterLayer` | `base_water.json` | Always visible when present |
| `Provinces` | `map_data.json` | Visual province fills, borders, labels, and markers |
| `CollisionLayer` | `map_data.json` | Hidden by default; generated province click areas |
| `CoverLayer` | `cover.json` | Hidden combined `MeshInstance2D` |
| `ElevationLayer` | `elevation.json` | Hidden combined `MeshInstance2D` |
| `RiversLayer` | `rivers.json` | Always visible when present |
| `RoadsLayer` | `roads.json` | Always visible when present |

Province nodes preserve the same structure used by runtime map loading:

```text
ProvinceNode
├─ Fill
├─ Border
├─ CityLabel
├─ CityIcon
└─ UnitAnchor
```

The generator also adds city marker dots, port marker dots, and province metadata.

Cover and elevation features are projected and triangulated during generation. Each
overlay is stored as one indexed, vertex-coloured `ArrayMesh` surface under its
`MeshInstance2D`, preserving source feature order and the existing 0.7-alpha palette
without retaining one canvas item per source polygon.

Generated visual CanvasItems require no per-item fog material or light mask. Runtime
cartography stays below the combined fog overlay as a layer-order contract; collision
shapes and non-drawing anchors remain unaffected.

Generated collision is separated from the visual province tree:

```text
CollisionLayer
└─ <province_id> (Area2D)
   └─ Shape (CollisionPolygon2D)
```

Multi-part provinces use deterministic suffixes like `FillPart01`, `BorderPart01`, and `<province_id>_part_01`. Each collision area has `province_id`, `polygon_index`, and `source_layer = "province_clickbox"` metadata. `CollisionLayer` is hidden by default so selecting or inspecting visual map layers does not cover the editor viewport with collision debug polygons.

Province fills are baked with initial political colors from each province's `nation_id`, using the same palette as the runtime political overlay. This lets the generated map scene preview the political map directly in the editor.

Before saving, polygon fills, overlay triangles, and collision shapes are checked with Godot triangulation. Rings that cannot be triangulated are skipped for visual/collision output, while province borders are still generated. This prevents editor spam like `Invalid polygon data, triangulation failed` when opening generated maps.

---

## Projection And Visual Match

The generator copies the current `MapLoader` projection behavior:

- WGS84 longitude/latitude input
- Web Mercator projection
- 4096 x 3000 target canvas
- Y-axis flipped for Godot 2D coordinates

This keeps generated map scenes visually aligned with the runtime JSON-loaded map.

---

## Runtime Use

The generated `.scn` scene is now used by runtime map loading.

- The generator does not automatically run during import, build, or project startup.
- `MapLoader` instances `res://scenes/map/<map_id>.scn` for visual and collision geometry.
- `MapLoader` still reads `map_data.json`, `terrain_lookup.json`, and `waypoints.json` for metadata, adjacency, projection, camera focus, pathfinding, and UI data.
- Missing optional visual layers are skipped with warnings.
- Missing or invalid `map_data.json` stops generation.
- Binary `.scn` serialization is not guaranteed to be byte-identical across repeated
  generations; validate the loaded scene structure and behavior rather than file hashes.

---

## Verification

The editor script was checked with Godot 4.7:

```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp/godot-config XDG_DATA_HOME=/tmp/godot-data \
godot --headless --path client --check-only --script res://src/utils/map-generator.gd
```

Generated overlay mesh structure is checked with:

```bash
godot --headless --path client test/test_generated_map_overlay_meshes.tscn
```

The project also loads headlessly with isolated Godot user data. Existing `.env` and Godot doc parser warnings may still appear.
