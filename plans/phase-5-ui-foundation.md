# Phase 5 — UI Foundation Subphases

## feat/ui-p5a-hud-manager
Core `HUDManager` singleton — panel registry, `show/hide/toggle/close_all`, `panel_opened/panel_closed` signals. No panel content.
Verification: mock panel registers and opens/closes.

## feat/ui-p5b-panel-orchestration
Open/close rules enforced in `HUDManager` — same-hotkey closes, different-hotkey swaps, no stacking. Tab dual-context (sub-tab cycle vs. notification cycle). Escape state machine (move-mode → panel → settings → open settings). Builds directly on p5a.

## feat/ui-p5c-layout-shells
Reusable two-column layout shell (fixed left / context-sensitive right). Side-dock vs. center-overlay placement mode as panel property. Bottom selection panel container with 4-state switching (friendly div / province / stack / enemy div) — container only, no content yet. `UnitProfile` component scaffolded empty.

## feat/ui-p5d-input-map
`InputMap` fully populated with finalized keybind scheme from `UI_UX_DESIGN.md §9`. Left-handed mirror as second named preset. Reserved-but-unbound actions registered (Z, V, U, I). No UI yet — just the map.

## feat/ui-p5e-keybind-settings
Settings keybind remapping UI — list bindings, rebind single action, reset to default/left-handed preset, persist to local config. Minimum viable only; full audio/graphics stay in Phase 15.
