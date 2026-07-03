# Diplomacy Direct Relations V1

## Summary
Implement the first diplomacy step as server-authoritative direct relation changes, not proposal/voting diplomacy yet. This includes the Diplomacy panel's Nations and Alliance pages, direct buttons (`Quit`, `Kick`, `Invite`, `War`, `Peace`), relation updates for both sides, affected-player notifications, and gameplay semantics so allies do not fight and peace stops active combat.

Out of scope for this step: voting, accept/reject invitations, map sharing, transit rights, research/general technology, and pre-game custom initial diplomacy setup. Initial match diplomacy defaults to every nation alone and neutral; custom setup comes later.

## Key Changes
- Add a server command `DIPLOMACY_ACTION` with payload `{ action: "invite" | "declare_war" | "make_peace" | "quit_alliance" | "kick", target_nation_id?: string }`.
- Server owns all relation mutation:
  - Initial relations: every nation pair starts as `neutral`.
  - `invite`: selected target nation is pulled out of its current alliance, joins the actor's alliance, and adopts the actor alliance's stance toward outside groups.
  - `declare_war`: actor alliance and target alliance become enemies.
  - `make_peace`: actor alliance and target alliance become neutral.
  - `quit_alliance`: actor leaves its alliance, becomes singleton, and becomes neutral toward all other alliances.
  - `kick`: target ally leaves the actor alliance, becomes singleton, and becomes neutral toward all other alliances.
  - Max alliance size of 5 is displayed in UI only; do not reject oversized invites yet.
- Normalize stance strings to `"alliance"`, `"neutral"`, and `"war"` everywhere.
- Combat must only start between nations whose relation is `"war"`. When diplomacy changes make active combat invalid, clear those engagements immediately and broadcast division/combat updates.

## Client/UI Changes
- Add a lightweight `DiplomacySystem` client module that submits `DIPLOMACY_ACTION` through `CommandQueue`; the panel emits action requests and never mutates `GameState`.
- Update `GameState._apply_relations_updated()` to treat server relation data as the full relation snapshot and emit relation-change UI signals so the Diplomacy panel refreshes.
- Rework `DiplomacyPanel`:
  - Nations page has sections: `ALLIANCE`, `NEUTRAL`, `ENEMY`.
  - Alliance page groups countries by current alliance set.
  - Neutral alliance groups show `War` at group level and `Invite` beside each member.
  - Enemy alliance groups show `Peace` at group level.
  - Keep the panel side-docked and visually consistent with existing HUD panels.
- Add server-to-client diplomacy notifications for affected online players only, including the actor. Use the existing notification feed via `EventBus.notification_requested`.

## Test Plan
- Server tests cover neutral start, invite, war, peace, quit, kick, affected notifications, ally combat suppression, and peace stopping active combat.
- Godot tests cover panel rendering/action submission from mocked `GameState.relations`, relation-refresh behavior, and existing HUD smoke checks.
- Verification:
  - `godot --headless --path client --scene res://scenes/test/test_hud_manager.tscn --quit-after 10`
  - Existing relation sync Godot test, updated for alliance/neutral behavior.
  - `npm test` in `game-server`.
  - Report root `npm test` / `npm run typecheck` availability.

## Assumptions
- Initial diplomacy is neutral now; pre-game custom initial state is step 3.
- Voting and accept/reject flows are future work.
- Alliance cap is displayed but not enforced yet.
- Alliance-page `Invite` is per-member for multi-member neutral groups because invite pulls one nation, not the whole group.
