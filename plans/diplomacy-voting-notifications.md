# Diplomacy Voting + Interactive Notifications

## Summary

Implement server-authoritative diplomacy voting and expand HUD notifications to support persistent interactive cards with yes/no buttons, vote rectangles, tooltips, and deadline progress bars.

Direct diplomacy resolution will be replaced for `invite`, `kick`, `declare_war`, and `make_peace`. `quit_alliance` remains immediate. All state changes still resolve only on the Colyseus server, with the client only displaying notifications and submitting responses through `CommandQueue`.

## Key Changes

- Add server-side pending diplomacy votes in `GameRoom`, using room timers for invite target responses and alliance voting stages.
- Add `DIPLOMACY_VOTE_RESPONSE` with payload `{ vote_id: string, accept: boolean }`.
- Add structured interactive notification events with `notification_id`, `vote_id`, message, deadline, duration, response requirement, and voter status list.
- Preserve existing `DIPLOMACY_NOTIFICATION` for final results and simple notices.
- Expand `NotificationFeed` to render persistent diplomacy cards with yes/no buttons, progress bars, and voter rectangles.

## Voting Rules

- Eligible voters are player-controlled nations only.
- A vote passes only when yes votes are more than half of eligible voters.
- Timeouts count as no; ties fail.
- If there are no eligible voters, the vote auto-passes.
- Reject overlapping diplomacy proposals involving any nation already in an active diplomacy vote.
- `quit_alliance` remains immediate and sends result notifications to affected players.

## Action Behavior

- `invite`: target gets a 10-second yes/no prompt. If accepted, the sender alliance votes for 15 seconds; sender defaults yes. If passed, target joins sender alliance.
- `kick`: sender and kicked nation do not vote. Remaining player-controlled allies vote for 15 seconds. If passed, target becomes neutral to everyone.
- `declare_war`: sender alliance votes for 15 seconds; sender defaults yes. Target alliance is not notified unless the vote passes.
- `make_peace`: sender alliance votes first; if passed, target alliance votes next. Peace applies only if both stages pass.

## Test Plan

- Server tests cover invite, target timeout, kick voter exclusion, hidden war votes, two-stage peace, timeout/tie failure, and overlap rejection.
- Client tests cover legacy notifications, interactive notification rendering, vote response submission, and vote rectangle updates.
- Verification uses available server test/typecheck commands and Godot headless HUD tests.
