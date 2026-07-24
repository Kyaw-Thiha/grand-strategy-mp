# HUD Panels and Input

The HUD gives players the match clock, nation identity, map modes, selected-unit details, and the drawers and full-screen panels used to manage the war.

# Details

## HUD composition

`GameHUD`, implemented by `client/src/ui/hud/game_hud.gd`, composes the top bar, dock rail, political/cover/elevation buttons, side drawers, centered panels, selection panels, chat, and notifications.

The shared map scene injects the active map, military, province-interaction, air-wing, and renderer services through `setup_game_context()`. This keeps HUD actions tied to the current composition without assuming a MapDebug root.

## Panel management

`HUDManager` registers panels as side-docked or full-center. It owns open/close state, keyboard shortcuts, dimming, sub-tab cycling, and restoration of a previous side drawer after a centered panel closes. It is forbidden from changing game state or making network calls.

Current side drawers cover research, economy, military, and diplomacy. Full-center panels cover the research tree, division builder, division template viewer, tactical combat, bombing detail, and air-combat detail.

Economy content, military air/naval tabs, the dedicated stack panel, and several profile elements contain explicit placeholder or later-phase behavior. Their visible presence does not mean those game systems are complete.

## Selection panels

Province, friendly/enemy division, and friendly air-wing panels populate from `GameState` after `EventBus` selection signals. Buttons emit local intent or submit named commands through the owning system and `CommandQueue`; panels do not edit the mirror.

## Input ownership

`GameHUD` tracks visible interactive rectangles and focused `LineEdit`/`TextEdit` controls. It publishes aggregate pointer and text-focus states through `EventBus`.

Map interaction, camera movement, military input, chat, pause, and `HUDManager` combine those signals so a click, wheel event, shortcut, or movement key belongs to one visible interface layer. Escape first cancels move mode, then closes an open panel, then opens settings/pause behavior.

## Required manual checks

Panel changes require manual checks for dock/center placement, overlay dimming, previous-panel restoration, Escape and Tab behavior, shortcuts, selection changes, pointer blocking, text focus, and layout at supported window sizes. Headless scenes can check logic but not visual overlap, animation, readability, or input feel.

# Related Notes

- [[client/ui/index|Client User Interface]]
- [[client/ui/menus-pause-and-settings|Menus, Pause, and Settings]]
- [[client/ui/chat-and-notifications|Chat and Notifications]]
- [[client/map/rendering-camera-and-interaction|Rendering, Camera, and Interaction]]
- [[client/military/stacks-engagements-and-tactical-ui|Stacks, Engagements, and Tactical UI]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]

