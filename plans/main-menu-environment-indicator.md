# Main Menu Environment Indicator

## Goal

Show whether the active client endpoint configuration is using local development servers or deployed online servers.

## Phase 1 - Config Helper

- Add a helper to `client/src/core/config.gd` that returns `true` when the active API or Colyseus endpoint is not localhost/loopback.
- Add a label helper that returns `Online` or `Local`.

## Phase 2 - Main Menu Display

- Update `client/src/ui/main_menu/main_menu.gd` to append the environment label beside the title.
- Keep the scene layout unchanged.

## Phase 3 - Verification

- Run Godot headless check.
- Confirm the title logic uses the same active URLs as networking.
