# Chat and Notifications

Chat lets players exchange short room messages, while notifications call attention to errors, combat, diplomacy votes, research, and air-operation results without taking control of the match.

# Details

## Chat

`ChatPanel`, implemented by `client/src/ui/hud/chat_panel.gd`, can be minimized or expanded, shows a masked sender email and time, and opens text entry through the configured chat action. Sending submits `SEND_CHAT` through `CommandQueue`.

The server-reported `CHAT_MESSAGE` becomes `EventBus.chat_message_received`, which appends the formatted message. Text is escaped before BBCode display. Focus signals suppress map and HUD keyboard actions while the player types, and clicking outside releases chat input.

## Timed notifications

`NotificationFeed` listens for `EventBus.notification_requested`. It creates short-lived cards with type-specific colors for default, research, warning, error, combat, diplomacy, and air messages. Visible cards are capped and old non-interactive notices are removed first.

Examples include rejected movement, server errors, air-wing staging/return notices, air combat starts, wing destructions, and local research completion. The `"air"` type renders with a sky-blue accent (`Color(0.35, 0.55, 0.85, 1.0)`) and the title "AIR OPS".

## Interactive diplomacy notifications

Interactive cards show the server message, deadline progress, voter states, and optional Yes/No controls. Updates replace the existing card content so a vote can show new responses or its final passed/failed result.

The buttons call `DiplomacySystem.submit_vote_response()`. The notification feed does not change relations or resolve the proposal.

## Current metadata limitation

Voter tooltips look up nation names from `western_europe_6/nations.json`. This is part of the map-scoped metadata refactor candidate and should not be copied into new multi-map UI.

## Required manual checks

Chat or notification changes need manual checks for minimized/maximized layout, input focus, Enter/Escape behavior, BBCode-safe display, notification stacking above chat, timed removal, vote controls, and map-input blocking. There is no broad screenshot comparison suite.

# Related Notes

- [[client/ui/index|Client User Interface]]
- [[client/ui/hud-panels-and-input|HUD Panels and Input]]
- [[client/diplomacy/actions-relations-and-votes|Diplomacy Actions, Relations, and Votes]]
- [[client/networking/commands-state-and-events|Commands, State, and Events]]
- [[client/testing/test-scenes-and-workflows|Client Test Scenes and Workflows]]

