# Subprovince Capture System Implementation Plan

> **For agentic workers:** Implement this plan batch-by-batch. Each batch ends with automated verification and a manual verification gate. Do not start the next batch until the current batch is reviewed.

**Goal:** Replace the obsolete frontline-influence model with authoritative raster-derived subprovinces supporting capture, supply, retreat, encirclement, and readable map visualization.

**Architecture:** Generate exact subprovince polygons at map-build time. The server loads those polygons and one adjacency graph, owns subprovince state, and emits authoritative ownership and supply-route results. The client only renders server state and never calculates gameplay ownership or supply.

**Tech Stack:** Python, GeoPandas, Shapely, Rasterio, NumPy, TypeScript, Colyseus, Godot 4, GDScript.

## Global Constraints

- Subprovince geometry is authoritative raster-derived geometry.
- Raster detail creates naturally irregular borders; do not add independent post-vectorization edge noise.
- Capital, town, road, water, and `cover_combat` boundaries are hard masks.
- Every generated province must have complete coverage and no overlaps within documented tolerance.
- The server remains authoritative for ownership, movement, combat, supply, retreat, and encirclement.
- Client `GameState` remains read-only; client gameplay code does not call `NetManager` directly.
- The client preserves province-level interaction unless a later design explicitly adds subprovince selection.
- Province adjacency and subprovince adjacency are separate graphs.
- Any unit, including recon, can capture by literal polygon occupancy.
- `2D` remains the default map mode and must remain functional throughout.
- Generated assets are written under `client/assets/data/<map_id>/`.
- New game-server tests use `getTestPort()` and a documented `lane:<name> | ` top-level `describe()` prefix.
- Tier 3 and Tier 4 terrain-rendering work is unrelated and must not be started here.

## Decisions

- Captured cells remain owned while the attacking nation has a living unit anywhere in the province.
- When that nation leaves the province, its captured cells revert in one pass.
- City capture cascades except for cells occupied by surviving former defenders and one valid route to another supply hub.
- If no valid supply route exists, city capture preserves only occupied former-defender cells.
- The urban capture cascade is one graph hop: an urban/city cell capture flips its adjacent road cells, and the hinterland cells adjacent to the urban cell and to those newly captured roads; no hinterland-to-hinterland or road-to-road chaining. (Planned server behavior in Batch 4/5; current server capture is province-level only.)
- Combat-frozen cells retain their authoritative owner and render with a contested tint.
- Roads are preferred for supply; off-road routes are allowed at reduced throughput.
- An enemy-owned occupied cell may supply only the unit occupying that cell.
- Own selected-unit routes are visible end-to-end through fog.
- Visible foreign-unit routes are inspectable end-to-end while the unit remains visible.
- Multiple selected units show all routes; the active unit is emphasized.
- Subprovince borders are soft gray, close-zoom-only, below fog, and non-interactive.

## Batch 0: Contract and Design Reconciliation

**Phases:** Phase 0

**Purpose:** Make the maintained documents unambiguous before implementation.

**Files:**

- Modify: `docs/MAP_DATA_CONTRACT.md`
- Modify: `docs/STRATEGIC_COMBAT.md`
- Modify: `docs/DEV_PHASES.md`
- Modify: `plans/subprovince/HANDOFF.md` if the handoff needs the resolved decisions recorded

**Work:**

1. Correct all generated-output references to `client/assets/data/<map_id>/`.
2. Replace roads-exclusive supply wording with road-preferred routing, reduced-throughput off-road fallback, and the occupied enemy-cell exception.
3. Document city-cascade preservation rules.
4. Document route payload fields and route visibility rules.
5. Define the raster working CRS, extent, resolution, pixel-center convention, and nodata handling.
6. Define 4-connected or 8-connected labeling and use it consistently.
7. Define deterministic Dijkstra tie-breaking and stable seed ordering.
8. Define river barriers and explicit bridge exceptions.
9. Define the no-independent-simplification rule for authoritative vectorized geometry.
10. Keep density, corridor, radius, sliver, and fade values configurable for playtesting.

**Automated verification:**

```bash
python3 scripts/check-docs.py
```

**Manual verification:**

- Review the updated contracts.
- Confirm city-cascade and supply-route rules are unambiguous.
- Confirm no document leaves ownership or supply calculation to the client.

**Gate:** Do not begin generation until the reconciled rules are approved.

## Batch 1: Generation Core

**Phases:** Phase 1

**Purpose:** Convert the prototypes into production-quality, independently testable generation code.

**Files:**

- Create: `map/tools/map_pipeline/subprovince_generator.py`
- Create: `map/tools/map_pipeline/subprovince_raster.py`
- Create: `map/tools/map_pipeline/subprovince_validation.py`
- Create: `map/tools/map_pipeline/test_subprovince_generator.py`
- Create: `map/tools/map_pipeline/test_subprovince_raster.py`

**Interfaces:**

- `generate_subprovinces(province, terrain_patches, roads, rivers, cities, config) -> list[SubprovincePolygon]`
- `split_oversized_patch(patch, elevation, rivers, seeds, config) -> list[PolygonLabel]`
- `build_subprovince_adjacency(polygons, tolerance) -> dict[str, list[str]]`
- `validate_subprovince_partition(province, polygons, tolerance) -> None`, raising a pipeline error on failure

**Work:**

1. Normalize source geometry into one projected working CRS.
2. Carve the capital ring.
3. Carve town cells.
4. Buffer and split road corridors using jittered seeds.
5. Subtract carved geometry from the remaining province.
6. Intersect the remaining geometry with `cover_combat` patches.
7. Preserve small patches as single cells.
8. Rasterize each oversized patch using the contract-defined grid.
9. Compute `1 / (cover_move * elevation_move)` cost per pixel.
10. Stamp rivers as barriers while preserving explicit bridge gaps.
11. Run deterministic multi-source Dijkstra inside the patch mask.
12. Vectorize all labels together, never one label at a time.
13. Clip vectorized output back to its source patch.
14. Merge slivers through shared-edge topology.
15. Restore `subprovince_id`, `province_id`, `kind`, `cover_combat`, `elevation_type`, and `is_capital` metadata.
16. Validate geometry, coverage, overlaps, hard boundaries, IDs, rivers, and adjacency.

**Required tests:**

- Synthetic province has complete coverage.
- Synthetic province has no overlaps.
- Cells do not cross cover-combat patch boundaries.
- Capital, town, road, and hinterland metadata is correct.
- IDs are deterministic and use `{province_id}_sp_{index}`.
- Adjacency is symmetric, has no self-links, and excludes corner-only contact.
- Sliver merging preserves total area.
- River barriers split cells except at bridge gaps.
- Incomplete coverage raises an error instead of printing a warning.
- Repeated generation produces equivalent geometry and IDs.

**Automated verification:**

```bash
python3 -m pytest map/tools/map_pipeline/test_subprovince_generator.py -v
python3 -m pytest map/tools/map_pipeline/test_subprovince_raster.py -v
```

**Manual verification:**

- Inspect synthetic generated geometry.
- Confirm borders are irregular but not broken.
- Confirm raster-derived borders follow elevation detail.
- Confirm no post-vectorization smoothing or independent edge noise exists.

**Gate:** Approve the synthetic GeoJSON and diagnostic images before real-map integration.

## Batch 2: Real Province Pipeline

**Phases:** Phases 2–3

**Purpose:** Integrate the generator with real map data and validate one real province before scaling.

**Files:**

- Modify: `map/tools/map_pipeline/pipeline.py`
- Modify: `map/tools/map_pipeline/validate.py`
- Modify: `map/tools/map_pipeline/requirements.txt`
- Create: `map/tools/map_pipeline/subprovince_io.py`
- Create: `map/tools/map_pipeline/test_pipeline_subprovinces.py`
- Create: `map/tools/map_pipeline/test_subprovince_real_fixture.py`
- Create: `map/tools/map_pipeline/inspect_subprovinces.py`

**Work:**

1. Adapt real province, cover, elevation, roads, rivers, and city fields to generator inputs.
2. Add generation after source validation and waypoint generation.
3. Write `subprovinces.geojson` and `subprovince_adjacency.geojson` under `client/assets/data/<map_id>/`.
4. Generate stable per-province IDs.
5. Generate adjacency from shared final polygon edges.
6. Make coverage and overlap failures terminate the pipeline.
7. Print subprovince, adjacency, and validation counts in the pipeline summary.
8. Add a real-province fixture and visual inspection command.

**Automated verification:**

```bash
python3 -m pytest map/tools/map_pipeline/test_pipeline_subprovinces.py -v
python3 -m pytest map/tools/map_pipeline/test_subprovince_real_fixture.py -v
```

**Manual verification:**

- Generate one real province.
- Overlay generated borders against cover and elevation source layers.
- Check capital, town, road, and hinterland cells.
- Check rivers and bridge gaps.
- Check for gaps, overlaps, slivers, or excessive pixel noise.
- Run the export twice and compare IDs, adjacency, and geometry.

**Gate:** Do not scale to the full map until the real-province output is visually approved.

## Batch 3: Full Assets and Loaders

**Phases:** Phase 4

**Purpose:** Make the full generated graph available to the server and client.

**Files:**

- Modify: `map/tools/map_pipeline/pipeline.py`
- Modify: `game-server/src/data/map_loader.ts`
- Modify: `game-server/src/data/map_cache.ts` if needed by the loader
- Modify: `client/src/systems/map/map_loader.gd`
- Modify: `client/src/utils/map-generator.gd` only for shared projection support
- Test: server map-loader tests
- Test: `client/test/test_generated_map_overlay_meshes.gd`

**Server interface:**

```ts
type SubprovinceDefinition = {
  id: string;
  provinceId: string;
  kind: "road" | "hinterland" | "town" | "capital";
  coverCombat: string | null;
  elevationType: string | null;
  isCapital: boolean;
  /** Outer ring(s): one ring for a simple Polygon, several for a MultiPolygon. */
  polygon: Array<Array<[number, number]>>;
};

type SubprovinceGraph = {
  nodes: Map<string, SubprovinceDefinition>;
  neighbors: Map<string, string[]>;
};
```

**Work:**

1. Generate the full map assets after the real-province gate passes.
2. Load subprovince definitions and adjacency once per server room.
3. Load and project subprovince polygons through `MapLoader` on the client.
4. Add province-to-subprovince and ID-to-polygon lookups.
5. Preserve province-level collision and click handling.
6. Fail clearly on missing, malformed, or mismatched assets.

**Automated verification:**

```bash
cd game-server
npm run build
npm test
```

```bash
godot --headless --path client client/test/test_generated_map_overlay_meshes.tscn
```

**Manual verification:**

- Load the full generated map.
- Confirm client and server see matching IDs and polygon counts.
- Confirm existing province-level map loading and interaction remain functional.
- Check load time and memory use.

**Gate:** Approve full asset loading before adding ownership state.

## Batch 4: Basic Server Capture

**Phases:** Phases 5–6

**Purpose:** Add authoritative occupancy capture and ownership synchronization.

**Files:**

- Create: `game-server/src/systems/subprovince_system.ts`
- Create: `game-server/src/data/subprovince_loader.ts`
- Modify: `game-server/src/rooms/schema/GameRoomState.ts`
- Modify: `game-server/src/rooms/GameRoom.ts`
- Modify: `game-server/src/systems/combat_system.ts`
- Modify: `game-server/src/systems/server_visibility_system.ts`
- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/net/net_manager.gd`
- Modify: `client/src/systems/session/session_manager.gd`
- Create: `game-server/test/subprovince-capture.test.ts`

**Interfaces:**

- `SubprovinceSystem.getSubprovinceAtPosition(position) -> string | null`
- `SubprovinceSystem.checkCaptureAfterMovement(division) -> CaptureDelta[]`
- `SubprovinceSystem.revertNationCaptureIfProvinceEmpty(nationId, provinceId) -> CaptureDelta[]`
- `SubprovinceSystem.isCombatFrozen(subprovinceId) -> boolean`
- `CaptureDelta = { subprovinceId: string, newOwner: string | null }`

**Work:**

1. Load the graph during room initialization.
2. Initialize each subprovince owner from its province owner.
3. Resolve division position against authoritative polygons.
4. Run capture checks immediately after authoritative movement.
5. Allow all unit types, including recon, to capture.
6. Skip cells with active tactical combat.
7. Preserve captured cells while the attacker has a living unit in the province.
8. Revert the complete captured set when the attacker leaves.
9. Emit one `SUBPROVINCE_CAPTURED` event per changed cell.
10. Filter detailed events for belligerents and aggregate information for neutrals.
11. Keep existing province capture behavior separate.

**Automated verification:**

- Literal occupancy captures a cell.
- Radius-only presence does not capture.
- Recon captures.
- Sticky ownership works.
- Complete revert works.
- Combat freeze works.
- One event is emitted per changed cell.
- Neutral observers do not receive detailed cell events.

Run with the repository’s server test command and ensure the new suite uses `getTestPort()` and a `lane:<name> | ` top-level describe prefix.

**Manual verification:**

- Move a unit across several subprovinces in a multiplayer match.
- Observe event timing and ownership changes.
- Leave the province and confirm captured cells revert.
- Start combat on a cell and verify the owner stays frozen.
- Test a recon unit explicitly.

**Gate:** Capture behavior must be stable before supply and city cascade are added.

## Batch 5: Supply Graph and City Cascade

**Phases:** Phase 7

**Purpose:** Implement the shared route query needed by supply and city capture.

**Files:**

- Create: `game-server/src/systems/supply_graph.ts`
- Modify: `game-server/src/systems/supply_system.ts`
- Modify: `game-server/src/systems/subprovince_system.ts`
- Modify: `game-server/src/rooms/GameRoom.ts`
- Modify: `game-server/src/rooms/schema/GameRoomState.ts`
- Modify: `game-server/src/systems/server_visibility_system.ts`
- Create: `game-server/test/subprovince-supply.test.ts`
- Create: `game-server/test/subprovince-city-cascade.test.ts`

**Interfaces:**

```ts
type SupplyRoute = {
  divisionId: string;
  sourceHubId: string | null;
  subprovinceIds: string[];
  status: "open" | "degraded" | "cut_off" | "encircled";
  throughputRatio: number;
  blockedSubprovinceId: string | null;
};
```

**Work:**

1. Use subprovince adjacency as the single graph.
2. Assign lower route cost to road cells and reduced throughput to off-road cells.
3. Permit an enemy-owned cell only when occupied by the requesting player’s unit.
4. Restrict that enemy-cell exception to the occupying unit.
5. Return ordered subprovince IDs, source hub, status, throughput, and blocked segment.
6. Make route selection deterministic with cost and ID tie-breakers.
7. On city capture, identify surviving former-defender units.
8. Preserve the cells occupied by those units.
9. Select and preserve one valid route to another supply hub.
10. Preserve only occupied cells when no route exists.
11. Apply the one-hop urban cascade: flip enemy road cells adjacent to the urban cell, then flip
    enemy hinterland cells adjacent to the urban cell and to those newly flipped roads. Do not
    chain hinterland-to-hinterland or road-to-road. Skip enemy-occupied and combat-frozen cells.
12. Emit one event per changed cell.
13. Filter route payloads: own units always receive routes; foreign routes are sent only while the unit is visible.

**Automated verification:**

- A road route wins over an equivalent off-road route.
- Off-road fallback is valid with reduced throughput.
- An enemy-owned occupied cell supplies only its occupying unit.
- An enemy-owned unoccupied cell cannot carry that supply.
- One route is deterministic.
- City cascade preserves occupied former-defender cells.
- City cascade preserves the selected supply route.
- City cascade does not preserve unrelated cells.
- Urban capture flips adjacent road cells (one hop).
- Urban capture flips hinterland adjacent to the urban cell.
- Captured-road capture flips hinterland adjacent to it.
- No hinterland-to-hinterland or road-to-road chaining.
- Cascade skips enemy-occupied and combat-frozen cells.
- One event is emitted per changed cell.
- Own routes are available through fog.
- Foreign routes are available only while the unit is visible.

**Manual verification:**

- Capture a city with enemy units still inside.
- Confirm occupied enemy cells remain protected.
- Confirm one supply route remains when available.
- Remove the route and confirm only occupied cells remain.
- Test road and off-road alternatives.
- Test a contested enemy-owned occupied cell.
- Test an enemy unit entering and leaving vision.

**Gate:** Approve route behavior before implementing the visual supply-line overlay.

## Batch 6: 2D Subprovince Renderer

**Phases:** Phase 8

**Purpose:** Render authoritative subprovince ownership without changing gameplay state.

**Files:**

- Create: `client/src/systems/map/subprovince_renderer.gd`
- Modify: `client/src/systems/map/map_loader.gd`
- Modify: `client/src/game/map_scene.gd`
- Modify: `client/scenes/game/game.tscn`
- Modify: `client/scenes/debug/map_debug.tscn`
- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/core/game_state.gd`
- Retire: `client/src/systems/frontline/frontline_overlay.gd` after replacement coverage exists
- Create: `client/test/test_subprovince_renderer.gd`
- Create: `client/test/test_subprovince_renderer.tscn`

**Work:**

1. Create one `Polygon2D` per subprovince initially.
2. Render ownership fills below province borders.
3. Render soft-gray subprovince borders only at close zoom.
4. Keep the boundary layer below fog.
5. Keep province borders visually stronger.
6. Render contested tint while combat freezes ownership.
7. Animate old owner to contested tint to resolved owner.
8. Restart interrupted transitions from the current interpolated color.
9. Keep province-level click collision unchanged.
10. Ensure the renderer does not mutate gameplay state.

**Automated verification:**

```bash
godot --headless --path client client/test/test_subprovince_renderer.tscn
```

Required cases:

- Geometry projection.
- Initial ownership.
- Single-cell ownership update.
- Fade transition.
- Interrupted transition restart.
- Contested tint.
- Fog layering.
- Province-border precedence.
- Close-zoom visibility.

**Manual verification:**

- Zoom from strategic to close view.
- Confirm subprovince lines appear only at closer zoom.
- Confirm lines remain soft gray and subordinate.
- Confirm fog hides enemy administrative structure.
- Confirm contested cells differ without implying ownership changed.
- Confirm 2D ownership matches server events.

**Gate:** Approve visual density and boundary treatment before adding route visualization.

## Batch 7: Supply-Line Visualization

**Phases:** Phase 9

**Purpose:** Show authoritative supply routes attractively when units are selected or inspected.

**Files:**

- Create: `client/src/systems/military/supply_line_overlay.gd`
- Modify: `client/src/game/map_scene.gd`
- Modify: `client/scenes/game/game.tscn`
- Modify: `client/src/core/event_bus.gd` if route update signals are required
- Modify: `client/src/ui/hud/land_selection_popover.gd`
- Modify: `client/src/systems/map/vision_render_layers.gd` only if a layer constant is required
- Create: `client/test/test_supply_line_overlay.gd`
- Create: `client/test/test_supply_line_overlay.tscn`

**Work:**

1. Draw all selected own-unit routes.
2. Draw visible foreign-unit routes.
3. Emphasize the active selected unit.
4. Remove foreign routes when their unit leaves vision.
5. Draw normal routes as cool teal/blue animated pulses.
6. Draw off-road fallback as amber with a slower pulse.
7. Draw cut-off routes as broken lines with a red interruption marker.
8. Draw encircled remnants alongside the existing unit indicator.
9. Keep own routes visible end-to-end through fog.
10. Place routes above fog and below unit icons.
11. Avoid full-map route clutter.
12. Add a compact route status to the land-selection popover.
13. Use server-provided route IDs and statuses; never recalculate supply on the client.

**Automated verification:**

- Selection creates routes.
- Multiple selection displays every route.
- The active route is emphasized.
- Deselecting clears routes.
- Route updates after supply-state changes.
- Own routes persist through fog.
- Foreign routes disappear when hidden.
- Animation does not change gameplay state.
- Overlapping routes remain readable.

**Manual verification:**

- Select one supplied unit.
- Select multiple supplied units.
- Compare road and off-road styling.
- Break a route and inspect the interruption marker.
- Test an encircled unit.
- Inspect a visible enemy unit’s route.
- Move that enemy unit into fog and confirm its route disappears.
- Confirm the overlay looks attractive without becoming map clutter.

**Gate:** Approve the supply-line visual language before deeper system migration.

## Batch 8: Supply, Retreat, and Encirclement Migration

**Phases:** Phase 10

**Purpose:** Replace remaining waypoint/influence-based mechanics with subprovince graph queries.

**Files:**

- Modify: `game-server/src/systems/supply_system.ts`
- Modify: `game-server/src/systems/movement_system.ts`
- Modify: `game-server/src/systems/combat_system.ts`
- Modify: `game-server/src/rooms/GameRoom.ts`
- Modify: existing supply, encirclement, retreat, and movement tests

**Work:**

1. Replace old supply corridor sampling.
2. Replace old distance-based encirclement logic.
3. Implement graph-based retreat pathing.
4. Reuse the same graph, ownership, route-cost, and throughput rules.
5. Remove duplicated adjacency and territory representations.
6. Preserve province adjacency for systems that still require province-level targeting.

**Automated verification:**

```bash
cd game-server
npm test
npm run build
npm run test:full
```

Required cases:

- Supply connectivity.
- Road preference.
- Off-road fallback.
- Enemy occupied-cell exception.
- Exact-hop encirclement.
- Ownership-aware retreat.
- Supply route changes after capture.

**Manual verification:**

- Create road and off-road supply scenarios.
- Cut a road corridor.
- Capture a subprovince along a supply route.
- Test retreat through friendly, enemy, and contested cells.
- Test encirclement using graph distance.

**Gate:** Full supply and movement behavior must be stable before cleanup.

## Batch 9: Frontline Retirement and Final Reconciliation

**Phases:** Phase 11

**Purpose:** Remove obsolete behavior and reconcile maintained project state.

**Files:**

- Modify or remove: `game-server/src/systems/frontline_system.ts`
- Modify or remove: `client/src/systems/frontline/frontline_overlay.gd`
- Modify: `client/src/core/game_state.gd`
- Modify: `client/src/core/event_bus.gd`
- Modify: `client/src/systems/session/session_manager.gd`
- Replace: obsolete frontline tests
- Modify: `docs/DEV_PHASES.md`
- Modify: `docs/STRATEGIC_COMBAT.md`
- Modify: `docs/MAP_DATA_CONTRACT.md`

**Work:**

1. Remove `FRONTLINE_BATCH` and obsolete influence-grid state.
2. Remove disabled influence assumptions that are no longer referenced.
3. Preserve compatibility only where an active external consumer requires it.
4. Mark documentation checkboxes complete only after verification.
5. Record resolved capture, supply, visibility, and rendering decisions.
6. Preserve unrelated province-level adjacency and capture behavior.

**Automated verification:**

```bash
cd game-server
npm test
npm run build
npm run test:full
```

```bash
python3 scripts/check-docs.py
```

```bash
godot --headless --path client client/test/test_subprovince_renderer.tscn
godot --headless --path client client/test/test_supply_line_overlay.tscn
```

**Manual verification:**

- Run a complete capture scenario.
- Toggle visibility and inspect ownership parity.
- Verify supply routes, city capture, retreat, and encirclement together.
- Confirm no old influence-grid behavior remains.
- Confirm 2D map readability at all zoom levels.

## Batch Execution Rules

- Each batch is independently reviewable and should receive its own implementation plan when execution begins.
- The first execution plan should cover Batches 0–2 because generation contracts and one-real-province validation are tightly coupled.
- Batches 3–5 should be planned together only if the full asset loader and server ownership work are being implemented by the same engineer; otherwise split them.
- Batches 6 and 7 should remain separate so boundary rendering can be manually approved before supply-line visual polish.
- Batches 8 and 9 are final integration work and should not begin while route semantics or capture behavior are still changing.
- After every batch, run the listed automated checks, perform the listed manual checks, record findings, and obtain approval before proceeding.

## Final Acceptance

- Subprovince boundaries are natural (coherent low-frequency noise, not pixel-jagged nor over-smooth) with zero overlaps and no visible gaps.
- Capital, town, road, and hinterland metadata is correct.
- Literal occupancy flips cells.
- Sticky ownership and complete revert behavior work.
- Combat-frozen cells show contested tint without authoritative ownership changing.
- City cascade preserves occupied former-defender cells and one valid supply route.
- Urban capture flips adjacent road and hinterland cells (one hop, no chaining) and skips occupied/combat-frozen cells.
- Roads are preferred and off-road supply is slower.
- Enemy-owned occupied cells supply only their occupying unit.
- Selected own routes remain visible through fog.
- Visible foreign routes disappear when the unit becomes hidden.
- Multiple selected routes remain readable.
- Province borders remain stronger than subprovince borders.
- Supply, retreat, and encirclement use the same graph.
- Old frontline influence behavior is absent.
- 2D remains the default and retains information parity with all new overlays.
