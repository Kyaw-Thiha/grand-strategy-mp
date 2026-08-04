---
tags: [future-work, ui, air-combat, land-combat, naval-combat]
status: deferred
blocks: [Air Fleet Command](air-fleet-command.md)
---

# Multi-Unit Selection UI

## What It Does

Allows the player to select multiple units at once (air wings, land divisions, naval
flotillas) and issue batch commands to all selected units, or to a subset.

This is a **cross-domain reusable UI component** — the same selection panel and batch action
bar should work for any unit type, adapting its available actions to what's selected.

## Why It Matters

Without multi-select, commanding many units requires clicking each one individually.
This becomes unmanageable in the mid-to-late game when a player has 15+ air wings, 20+
divisions, and several flotillas. Multi-select is the floor-level solution; Air Fleet
(persistent named groupings) is an optional layer on top for players who want it.

## Design Considerations (from Phase 12 brainstorming)

**Selection methods to consider:**
- Box drag on the map (click and drag to select all units in area)
- Shift-click to add individual units to an existing selection
- Panel list with checkboxes (for when units are off-screen or buried)
- "Select all in fleet" shortcut (if Air Fleet is implemented)

**Selection panel behaviour:**
- Appears when 2+ units are selected
- Shows a list of selected units with key stats (type, count/strength, mission/state)
- Individual rows are clickable — click to deselect that unit or drill into it
- Batch action bar at top: available actions adapt to the unit types selected
  - Air wings selected → "Assign Mission", "Retreat", "Redeploy"
  - Divisions selected → "Move", "Attack", "Dig In"
  - Mixed selection → only cross-type common actions (e.g. "Deselect All")

**Reusability target:** the selection panel and batch action dispatch should be a single
component usable for all unit types. Unit-type-specific panels (wing detail, division detail)
remain separate and appear when a single unit is selected.

## Relationship to Air Fleet

If multi-select is well-designed (fast box-select + persistent until explicitly cleared), the
need for Air Fleet as a separate persistent concept may be reduced or eliminated. Players can
achieve the same result by:
1. Box-selecting all wings on the eastern front
2. Assigning mission in one click

The difference: a named fleet lets you recall the same selection later with one click, without
re-selecting. Whether that benefit outweighs the membership-management overhead is the open
question that should be answered during multi-select design and playtesting.

## When to Design

Before implementing Air Fleet (Branch I). The multi-select design may change or eliminate the
need for fleet entirely. Tackle multi-select UI design first, then revisit fleet.
