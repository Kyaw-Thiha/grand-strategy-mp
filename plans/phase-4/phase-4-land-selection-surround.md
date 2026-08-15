# Plan: Land Selection Surround Redesign

## Status

Stages 3 and 4 are complete and approved. Stage 5 implementation, client verification, and manual
approval are complete; its core server runner remains blocked by the documented Node 26 workerpool
incompatibility. Stage 6 implementation and automated verification are complete; targeted viewport
interaction and visual approval remain open. Former Stages 2, 3, and 4 were combined into the
single-selection visuals stage; the remaining roadmap was renumbered consecutively.
Do not proceed from one stage to the next without explicit user approval.

This plan supersedes the current contextual land popover presentation once implementation is
complete. It does not change server authority, selection semantics, or the rule that gameplay
commands pass through `CommandQueue`.

## Goal

Replace the detached land-division popover with a compact screen-space command surface that is
visually joined to the selected land-division icon.

For a single selection, the surface consists of:

- A hollow translucent surround around the selected division icon, leaving its status indicators
  unobscured.
- A connected rounded action tray, preferably above and to the right.
- Universal actions first, followed by actions valid for the division's current state.
- No division name, metadata, or other inspector text in the tray.

The eventual multi-selection presentation uses a rounded screen-space boundary around the
selected divisions with a connected action tray. Exact dispersed-selection behavior remains a
later design decision.

## Approved Decisions

### Presentation

- Remove the 300 ms owned-division hover preview.
- Use desaturated navy translucent glass without real backdrop blur.
- Keep the action surface compact and button-only. Do not show the division name or metadata.
- Implement the surround and tray in a `CanvasLayer` screen-space overlay.
- Keep division icons as world-space `Node2D` objects and project their positions into the HUD.
- Draw the entire connected surround in one coordinate space; do not split the circle and tray
  between world and screen space.
- Prefer the tray above and to the right of the selection.
- Because the surface is screen-space, allow viewport-aware repositioning or mirroring. The
  exact fallback order is finalized during the single-selection hardening stage.
- Replace the current yellow selection ring with the new surround.
- Preserve combat, supply, observation, scouting, engagement, HP, and suppression indicators.
- Do not source, generate, or choose final action icons. Ask the user for each required icon
  before integrating it.
- Composition uses the user-confirmed
  `client/assets/icons/table-cells-solid-full.svg`.
- Center Camera uses the user-confirmed matching asset
  `client/assets/icons/arrows-to-dot-solid-full.svg`.
- Hold will use the user-confirmed `client/assets/icons/hand-regular-full.svg` when Stage 4 begins.
- Retreat uses the user-confirmed `client/assets/icons/person-running-solid-full.svg`.

### Division Opacity

- Apply the eventual baseline opacity treatment to all currently visible land divisions,
  friendly and enemy. Air and naval units are out of scope.
- The ordinary-state dimming must be slight. Its purpose is smooth selection emphasis, not loss
  of battlefield information.
- Selected divisions remain fully emphasized.
- Fog-of-war and observation visibility remain authoritative; opacity styling must never reveal
  concealed divisions.
- Exact opacity values are selected through manual visual review rather than fixed by this plan.

### Single-Selection Actions

Universal actions appear first:

1. Composition
2. Center Camera

State-specific actions follow:

| Division state | State-specific action |
|---|---|
| Idle | None |
| Moving | Hold |
| Engaged | Retreat |
| Suppressed | Retreat |
| Retreating | None; retreating divisions are out of player control |
| Destroyed | No selection surface |

- Reposition is omitted for this version.
- Center Camera uses a short smooth pan and toggles between 1.75 close zoom and 0.75 strategic zoom.
- Composition opens the existing full composition/template viewer and preserves selection.
- The UI recomputes available actions when division state or movement state changes.

### Multi-Selection

- Multi-selection remains part of the staged redesign, but follows completion and approval of
  single-selection behavior.
- Universal Composition and Center Camera actions are not shown for multi-selection in this
  version.
- Show Hold if at least one selected division is moving.
- Show Retreat if at least one selected division is engaged or suppressed.
- Each group action applies only to selected divisions eligible for that action.
- Hovering a partial-applicability action emphasizes eligible selected divisions and returns
  ineligible members to ordinary unselected opacity.
- Automatic camera framing or zooming on action hover is deferred.
- Exact geometry for highly dispersed selections, off-screen members, an idle-only selection,
  and whether the boundary changes during action hover are intentionally deferred to the
  multi-selection stages.

## Architecture Direction

Use a dedicated screen-space `Control` under `GameHUD`'s `CanvasLayer`:

- A full-viewport visual root draws selection geometry and uses `MOUSE_FILTER_IGNORE`.
- Only the tightly sized action tray and its buttons stop pointer input.
- `MilitarySystem` remains the owner of selection and action eligibility.
- UI emits intent through `EventBus`; it does not mutate gameplay state or division visuals.
- `MilitarySystem` publishes projected positions for all selected visible divisions as needed.
- `CameraSystem` owns the smooth Center Camera operation.
- Action eligibility is shared by UI visibility, hover emphasis, keyboard shortcuts, and command
  execution so those paths cannot disagree.

The single-selection implementation uses an SDF shader to union the circle and tray without
doubled seams while subtracting a transparent icon cutout. Native Godot buttons remain separate
interactive controls aligned over the drawn tray.

## Stage 1: Tactical Glass Foundation

Create the reusable tactical-overlay theme/resource separately from `hud_dark.tres`.

Scope:

- Desaturated navy translucent surfaces.
- Subtle translucent border and restrained highlight.
- Compact neutral button normal, hover, pressed, disabled, and focus states.
- Restrained Hold and Retreat semantic variants.
- Tooltip styling where it can be isolated cleanly.
- An isolated showcase scene over representative bright land, dark ocean, fog, and busy map
  backgrounds.
- Text placeholders only; no icon artwork.

Out of scope:

- Connected selection geometry.
- Gameplay integration.
- Counter opacity changes.
- Hover-preview removal.
- Action behavior.

Verification gate:

- Run the isolated showcase headlessly.
- Run the smallest relevant HUD/theme check.
- Run `git diff --check`.
- Manually approve readability, opacity, border, button states, semantic colors, and focus style.

## Stage 2: Single-Selection Visuals

Build and integrate the connected surround visual, including the slight land-counter emphasis
transition and replacement of the old committed-selection presentation.

Scope:

- Hollow circular icon enclosure with a transparent counter cutout.
- Connected neck and top-right rounded tray.
- Two-, three-, and four-button variants.
- Stable screen-space stroke, corner radius, and button sizing.
- No duplicate border or dark seam where enclosure and tray meet.
- Exercise the approved tactical-overlay resource.
- Apply slight ordinary-state emphasis to every visible friendly and enemy land division while
  selected, hovered, and drag-preview divisions remain fully emphasized.
- Integrate the surround for one selected owned land division using the existing projected
  screen-position path.
- Remove the committed yellow selection ring and owned-division hover preview while preserving
  drag-preview, range, combat, supply, HP, and suppression indicators.
- Use two disabled neutral placeholders for the future Composition and Center Camera positions.

Decision gate:

- Approve silhouette proportions, connection geometry, translucency, and interaction density.
- Decide whether custom drawing is sufficient or compound polygon/SDF rendering is necessary.

## Stage 3: Universal Single-Unit Actions

Add universal controls in fixed order:

1. Composition
2. Center Camera

Before implementing this stage, request the corresponding icon assets from the user.

Implementation status: complete and manually approved.

Composition behavior:

- Open `DivisionTemplateViewerPanel`.
- Preserve selection.
- Suspend or hide the selection surface while the viewer is open.
- Restore it when the viewer closes.

Center Camera behavior:

- Smoothly pan to the selected division.
- Do not alter selection.
- Do not change zoom.

Verification gate:

- Verify both actions independently and ensure clicks do not fall through to the map.

## Stage 4: Moving-State Hold

Add the first state-specific action using the approved
`client/assets/icons/hand-regular-full.svg` asset.

Implementation status: complete and manually approved.

Scope:

- Moving layout: Composition, Center Camera, Hold.
- Hold operates only on an eligible moving division.
- Hold disappears when movement ends or combat changes eligibility.
- Universal action order remains stable.
- Dynamic layout changes cannot retarget an in-progress click to another button.
- Button and keyboard eligibility use the same rule.

Verified implementation details:

- Hold eligibility requires an owned idle division with a non-empty waypoint route or active
  final-position target.
- `MilitarySystem` owns and publishes that eligibility for the HUD, keyboard path, legacy action,
  and command execution.
- Hold uses remappable `unit_hold` input and captures the action, division, and layout revision so
  a state transition cannot retarget an in-progress click.
- Position refreshes preserve surround visibility while selection remains valid so Godot retains
  button hover and press state.
- New single selections play a 120 ms ease-out entrance that contracts both ring radii by 8 px and
  settles border/control emphasis without moving interactive hitboxes; routine refreshes do not
  replay it.
- The server independently revalidates eligibility, clears both the waypoint route and final target,
  and sends the stopped division through visibility-filtered updates.

Verification gate:

- Start movement, observe Hold appear, execute it, and observe Hold disappear when the route is
  cleared.

## Stage 5: Combat-State Retreat

Add Retreat after requesting the Retreat icon from the user.

Implementation status: implemented, client-verified, and manually approved; core server automation
remains blocked by Node 26's workerpool incompatibility.

Scope:

- Engaged and suppressed divisions show Retreat.
- Retreating divisions show no state-specific action.
- Transition from moving to engaged replaces Hold with Retreat.
- Starting retreat removes Retreat.
- Destroying/removing the division clears the surface safely.
- Button and keyboard paths apply the same eligibility filtering.
- Reposition remains omitted.

Verified implementation details:

- Retreat uses the approved running-person icon and the restrained `TacticalRetreatButton` style in
  the third tray position.
- `MilitarySystem` owns one eligibility rule for owned engaged/suppressed divisions and applies it
  to specific tray intent, remappable `unit_retreat`, and legacy selected-set execution.
- Hold-to-Retreat and Retreat-to-unavailable transitions invalidate an armed press through the
  existing captured action, division, and layout revision.
- The server independently requires ownership, an engaged/suppressed state, and a live opposing
  engagement before starting withdrawal, then visibility-filters changed division snapshots.
- Focused client verification passes 12 MilitarySystem checks and 161 HUD checks. The core server
  suite is currently blocked before test execution by Node 26's workerpool incompatibility.

Verification gate:

- Manually exercise moving, engaged, suppressed, retreating, and destroyed transitions while the
  selection remains active.

## Stage 6: Single-Selection Hardening

Resolve lifecycle and placement edge cases after the core single-selection interaction is
visually approved.

Implementation status: implemented and automated-verified; targeted viewport interaction and visual
approval remain open.

Scope:

- Viewport-edge placement and tray mirroring.
- Top bar, left dock, chat, and other reserved HUD areas.
- Unit moving off-screen and returning.
- Major panel suspension.
- Rapid selection changes.
- Division removal while a control is hovered or pressed.
- Camera zoom interpolation.
- Tooltips near viewport edges.
- Drag selection and map clicks adjacent to the surround.

Recommended placement fallback for evaluation:

1. Prefer top-right.
2. Slide along the surround for small corrections.
3. Mirror to top-left.
4. Use lower-right or lower-left only if both upper placements fail.
5. Hide without clearing selection when the selected icon is off-screen.

Verified implementation details:

- The surface supports top-right, top-left, lower-right, and lower-left geometry while preserving the
  exact projected counter anchor and transparent cutout.
- Placement prefers top-right, applies up to 20 px of minimum inward tray correction, then checks
  top-left, lower-right, and lower-left. The current valid layout is retained until a better layout
  gains an 8 px clearance margin, preventing camera interpolation from oscillating at thresholds.
- Complete surface bounds stay within an 8 px viewport margin and avoid the visible top bar, left
  dock, map-mode controls, and minimized or maximized chat by 4 px. Transient notifications do not
  move the surface.
- Any managed HUD panel suspends the surface. Off-screen, reserved-area, and panel suspension hide it
  without clearing selection or replaying the entrance animation when it returns.
- Selection-set membership, division removal, and placement changes invalidate stale armed actions;
  removal also clears cached projection data.
- Visual geometry remains pointer-transparent. Only native action-button bounds stop map input, and
  native tooltips retain Godot's viewport clamping.
- Focused verification passes 204 HUD checks, the camera suite, 6 Hold checks, and 12 Retreat checks.
  The HUD coverage exercises all four fallbacks, the `960x540`, `1280x720`, and `1920x1080`
  viewport bounds, persistent-HUD reservations, transient-toast exclusion, off-screen restoration,
  interpolation hysteresis, rapid selection, removal, and adjacent input ownership. The
  four-orientation showcase and debug map both initialize headlessly.

Verification gate:

- Approve the fallback behavior through targeted manual tests at common viewport sizes.

Automated commands:

```bash
godot --headless --path client scenes/test/test_hud_manager.tscn
godot --headless --path client scenes/test/test_camera_system.tscn
godot --headless --path client scenes/test/test_military_hold.tscn
godot --headless --path client scenes/test/test_military_retreat.tscn
godot --headless --path client --quit-after 2 scenes/debug/land_selection_surround_showcase.tscn
godot --headless --path client --quit-after 2 scenes/debug/map_debug.tscn
python3 scripts/check-docs.py
git diff --check
git diff --cached --check
```

Manual acceptance procedure:

1. Run `scenes/debug/map_debug.tscn` at `960x540`, `1280x720`, and `1920x1080`.
2. Select an owned land division and pan it through the center, each edge, and each corner. Confirm
   top-right preference, bounded inward sliding, top-left mirroring, lower fallbacks, fixed counter
   anchoring, and no clipping.
3. Repeat beside the top bar, left dock, map-mode controls, minimized chat, and maximized chat. A
   counter covered by reserved HUD should hide without deselection; transient notifications should
   not alter placement.
4. Pan and zoom slowly across fallback thresholds, then rapidly. Confirm the surface follows the
   projected counter without orientation oscillation, and that an off-screen round trip does not
   replay the entrance animation.
5. Open and close side-docked and full-center managed panels, rapidly change selected divisions,
   and exercise moving, engaged, suppressed, retreating, and removal transitions. Confirm safe
   suspension, restoration, action order, and stale-press cancellation.
6. Hover every action near viewport edges and confirm tooltips remain visible. Click each action,
   then click and drag from the hollow center, tray gaps, and pixels beside the buttons. Only native
   button bounds should block map input.

Approval criteria:

- No surface clipping, reserved-HUD overlap, fallback oscillation, accidental deselection, stale
  action, tooltip truncation, or map-input obstruction occurs in the manual matrix.
- Keep Stage 6 open if any physical hover, click, drag, tooltip, or visual check cannot be completed.
- Record explicit user approval before proceeding to Stage 7.

## Stage 7: Multi-Selection Geometry

Implement geometry without group commands first.

Initial direction:

- Use the smallest axis-aligned screen-space rounded rectangle around visible selected icon
  extents, not a rotated mathematical minimum-area rectangle.
- Keep the large enclosed area almost transparent; emphasize the outline and attached tray.
- Only the action tray may stop pointer input.

Design decisions to make during this stage:

- Compact versus highly dispersed selections.
- Off-screen selected members.
- Stacked divisions.
- Padding and corner radius.
- Whether an idle-only multi-selection shows only a boundary or no surface.
- Whether large dispersed selections use one boundary or individual member surrounds.

Verification gate:

- Manually compare compact, stacked, partially off-screen, and widely dispersed selections before
  approving a fallback policy.

## Stage 8: Multi-Selection State Actions

Add state-specific group actions only.

Scope:

- Hold appears when at least one selected division is moving.
- Retreat appears when at least one is engaged or suppressed.
- Each action executes only for its eligible selected subset.
- Universal actions remain hidden.
- Idle-only and retreating-only selections have no state action.
- Tooltips state applicability, for example `Applies to 2 of 5 selected divisions`.
- Eligibility changes reactively as selected divisions change state.

Verification gate:

- Exercise idle + moving, moving + engaged, engaged + suppressed, and retreating + idle mixes.

## Stage 9: Multi-Selection Action Focus

Add responsive hover feedback without camera movement.

Scope:

- Hovering Hold keeps eligible moving divisions emphasized and returns other selected members to
  ordinary opacity.
- Hovering Retreat keeps engaged/suppressed divisions emphasized and deemphasizes the rest.
- Leaving the action restores the entire selected set.
- Moving directly between actions replaces the subset atomically without flashing.
- Stale exit events cannot cancel the newer hover state.
- State changes, selection changes, action execution, suspension, and unit removal always clear
  transient focus safely.

Deferred decision:

- Whether the outer multi-selection boundary remains stable or contracts to the eligible subset.
  Start by keeping it stable unless manual review favors contraction.

Explicitly out of scope:

- Automatic camera pan, zoom, framing, or restoration on action hover.

## Stage 10: Finalization

After all visual and interaction stages are approved:

- Replace any remaining placeholders with user-provided icons.
- Complete keyboard-focus and tooltip checks.
- Test common viewport sizes and map zoom levels.
- Add targeted automated checks for eligibility, filtered execution, reactive state, and input
  ownership.
- Run relevant HUD tests and the debug map headlessly.
- Remove obsolete popover code and resources only after confirming they have no remaining users.
- Reconcile `docs/UI_UX_DESIGN.md`, `docs/PANEL_WIREFRAME_BRIEF.md`, `docs/MODULES.md`,
  `docs/DEV_PHASES.md`, and the scoped multi-select future-work entry with verified behavior.
- Run `python3 scripts/check-docs.py` and `git diff --check`.

## Deferred Work

- Automatic camera framing or zooming for eligible multi-selection subsets.
- Universal multi-selection controls.
- Cross-domain reuse for air wings and naval flotillas.
- Player-created frontline orders or army-level planning controls.
- Final behavior for highly dispersed multi-selections until Stage 7 review.
- Actual backdrop blur.

## General Verification Rules

For every stage:

- Run the smallest relevant automated/headless check.
- Report pre-existing warnings separately from new failures.
- Run `git diff --check`.
- Provide the exact scene and interaction steps for manual verification.
- Stop and wait for explicit user approval before beginning the next stage.
- Preserve unrelated worktree changes and do not commit unless explicitly requested.
