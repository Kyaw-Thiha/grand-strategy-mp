# Rendering, Camera, and Interaction

Map presentation lets players read national control and terrain, move around the world, inspect provinces, and point army or air actions at map locations.

# Details

## Province and overlay rendering

`MapRenderer`, implemented by `client/src/systems/map/map_renderer.gd`, owns display only. It colors province polygons, rebuilds national borders, highlights selections, shows cover or elevation layers, and switches nation labels and city markers as zoom changes.

Political mode reads the current province owner through the scene-provided data source. Cover and elevation presentation comes from layers already present in the generated map scene. A province capture refreshes the affected fill and rebuilt boundaries after `GameState` has received the server result.

Map cartography and runtime nation labels render below the combined visibility fog.
World-space division, route, combat, aircraft, and naval marker roots render above it.
This draw-order boundary keeps markers readable without per-item lighting materials.

## Province interaction

`MapInteraction`, implemented by `client/src/systems/map/map_interaction.gd`, connects to the generated `Area2D` click regions after the map loads. It reports hover, left-click selection, right-click intent, and selection clearing; it does not change province ownership or resolve an order.

The shared map composition gives air-wing input first chance to consume a mouse action, then military input. A plain province click clears army selection, highlights the province, and emits `EventBus.province_selected`.

## Camera controls

`CameraSystem`, implemented by `client/src/systems/map/camera_system.gd`, owns the `Camera2D`. Players can pan with WASD or arrow keys, edge-scroll, zoom with the wheel, or use Ctrl with plus/minus. Movement accelerates while a direction is held, zoom is smoothed, and the camera is clamped to generated map bounds.

At match entry, the shared map scene looks up the selected nation’s capital in `nations.json`, centers the camera there, and gives the HUD the nation name and flag.

## Input blocking

Pause, chat focus, UI pointer hover, and text-entry focus stop the relevant map or camera controls. The UI publishes those states through `EventBus`; map systems do not reach into HUD nodes to inspect them.

Opening full-screen division, tactical, bombing, or air-combat panels also disables province interaction through the scene-provided `MapInteraction` service. This prevents clicks intended for a panel from becoming map orders underneath it.

# Related Notes

- [[client/map/index|Client Map]]
- [[client/map/map-data-and-loading|Map Data and Loading]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/air/wings-missions-and-movement|Wings, Missions, and Movement]]
