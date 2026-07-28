# Rendering, Camera, and Interaction

Map presentation lets players read national control and terrain, move around the world, inspect provinces, and point army or air actions at map locations.

# Details

## Province and overlay rendering

`MapRenderer`, implemented by `client/src/systems/map/map_renderer.gd`, owns display only. It colors province polygons, highlights selections, shows cover or elevation layers, and switches nation labels and city markers as zoom changes.

Political fills read the current province owner through the scene-provided data source when
the map initializes and remain current underneath every view. Political mode also keeps
both pre-triangulated terrain meshes visible as subtle context: cover uses 0.35 whole-mesh
alpha and elevation uses 0.25, leaving nation colors visually dominant. Dedicated cover
and elevation modes show only the selected mesh at full modulation.

Switching modes changes visibility and modulation on those two combined mesh nodes; it
does not traverse or recolor every province or propagate visibility through individual
terrain polygons. The meshes crossfade over 250 ms with sine in/out easing. Repeated input
interrupts the active tween from its current opacity values, so the latest selection wins
without a visual reset; initial map hydration remains immediate. A province capture
refreshes only the affected political fill after `GameState` has received the server
result.

Map cartography and runtime nation labels render below the combined visibility fog.
World-space division, route, combat, aircraft, and naval marker roots render above it.
This draw-order boundary keeps markers readable without per-item lighting materials.

## Province interaction

`MapInteraction`, implemented by `client/src/systems/map/map_interaction.gd`, connects to the generated `Area2D` click regions after the map loads. It reports hover, left-click selection, and selection clearing; it does not change province ownership or resolve an order.

The shared map composition classifies the right mouse button as either a camera drag or a stationary gameplay click. A stationary release gives air-wing input first chance to consume the click, then military input. A drag never becomes an order. A plain left-click on a province clears army selection, highlights the province, and emits `EventBus.province_selected`.

## Camera controls

`CameraSystem`, implemented by `client/src/systems/map/camera_system.gd`, owns the `Camera2D`. Players pan by right-dragging the map or using WASD and arrow keys, zoom with the wheel, or use Ctrl with plus/minus. Mouse-wheel zoom keeps the world point beneath the cursor anchored throughout smooth zoom-in and zoom-out; keyboard zoom remains centered. Right-drag movement remains one-to-one at every zoom level and suppresses gameplay orders after crossing its drag threshold. Keyboard movement accelerates gently to a fixed cap, and the camera is clamped to generated map bounds.

At match entry, the shared map scene looks up the selected nation’s capital in `nations.json`, centers the camera there, and gives the HUD the nation name and flag.

## Input blocking

Pause, chat focus, UI pointer hover, and text-entry focus stop the relevant map or camera controls. A right-drag cannot begin over blocking UI; a drag that began on the map remains captured until release. The UI publishes blocking states through `EventBus`; map systems do not reach into HUD nodes to inspect them.

Opening full-screen division, tactical, bombing, or air-combat panels also disables province interaction through the scene-provided `MapInteraction` service. This prevents clicks intended for a panel from becoming map orders underneath it.

# Related Notes

- [[client/map/index|Client Map]]
- [[client/map/map-data-and-loading|Map Data and Loading]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[client/military/divisions-and-selection|Divisions and Selection]]
- [[client/air/wings-missions-and-movement|Wings, Missions, and Movement]]
