# Time Feature: Session Timer

## Goal

Make the top-right `SessionTimer` in `res://scenes/game/game_hud.tscn` start at `00:00:00` when the game HUD starts and display elapsed time as `hh:mm:ss`.

## Phase 1: Inspect Existing HUD Wiring

- Confirm `SessionTimer` is available as a unique label in `game_hud.tscn`.
- Confirm `game_hud.gd` already owns the HUD display behavior.
- Verify the timer can be handled locally as UI-only elapsed session display without mutating `GameState`.

## Phase 2: Implement Timer

- Initialize the timer display to `00:00:00` in `_ready()`.
- Track elapsed seconds from HUD startup.
- Update the label once per displayed second using `_process(delta)`.
- Keep `set_session_time(seconds)` as the single formatting path.

## Phase 3: Verify

- Run the existing Godot HUD test scene headlessly if available.
- Run repository verification commands where possible and report any sandbox or dependency blockers.
- For the UI, manually check that the top-right label starts at `00:00:00` and advances once per second.
