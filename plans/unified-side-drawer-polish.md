# Unified Side Drawer Polish

## Summary
Keep the four side drawer panels separate, but make them mutually exclusive and visually consistent. Each drawer uses the same frame, margin, header structure, and icon-only close button.

## Implementation
- Update `HUDManager` so opening a side-docked panel hides other open side-docked panels first.
- Preserve full-center panel behavior, including research tree restore behavior.
- Add `close_requested` signals to each side drawer and wire them from `GameHUD` to `HUDManager.hide_panel()`.
- Standardize drawer scene structure as `Margin -> VBox -> Header + ContentBody`.
- Use `res://assets/icons/xmark-solid-full.svg` for the top-right close button.

## Verification
- Validate affected scenes load.
- Click side drawer buttons in different orders and confirm only one drawer is visible.
- Confirm drawer close icons hide the active drawer.
- Confirm shortcuts still toggle side drawers.
- Confirm research full tree still opens and restores the side drawer state.
