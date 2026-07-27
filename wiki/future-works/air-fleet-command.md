---
tags: [future-work, air-combat, phase-12, ui]
status: deferred
dependency: multi-select-ui design (see [[multi-select-ui]])
---

# Air Fleet Command (Branch I)

## What It Does

Groups air wings into named **Air Fleets** representing a theater or front (e.g. "Eastern
Front Fleet"). A fleet is a persistent grouping container — it holds no mission state itself;
wings hold their own missions. The fleet provides a single point to batch-assign missions to
all wings in a theater.

## Why Deferred

The value of persistent fleet groupings depends on whether the alternative — ad-hoc
multi-select — covers the same use case with less overhead. If a player can box-select all
wings in an area and batch-assign a mission in two clicks, a named fleet with its own
membership management may not be worth the friction. This question needs to be settled by
designing and testing multi-select UI first.

If multi-select alone is sufficient: fleet may not be needed.  
If players need stable named groupings they return to repeatedly: fleet is the right answer.

## Full Design (locked in during Phase 12 brainstorming)

- Fleet = grouping container only. No mission stored on fleet. No fleet tick.
- Fleets are **front-based and mixed-type** — fighters + bombers + heavy fighters together.
  Players think "Eastern Front Fleet," not "all my fighters."
- `SET_FLEET_MISSION` is a one-shot batch operation: eligible wings get the mission, ineligible
  wings get IDLE. No directive persistence.
- New wings added to fleet keep their current mission until player re-assigns.

**Escort spread logic for `SET_FLEET_MISSION` with ESCORT mission:**
- Heavy fighters → strategic/tactical bombers first; fall back to CAS/dive/naval if none
- Fighters → CAS/dive/naval bombers first; fall back to strategic/tactical if none
- Spread round-robin within class — no bomber double-covered while another is open
- Excess heavy fighters (no bomber to escort) → keep current mission
- Excess fighters (no bomber to escort) → AIR_SUPERIORITY

**Planned schema:** `AirFleetState` (fleet_id, nation_id, wing_ids[], name)  
**Planned handlers:** `CREATE_AIR_FLEET`, `DISBAND_AIR_FLEET`, `ASSIGN_WINGS_TO_FLEET`, `SET_FLEET_MISSION`  
**Planned system:** `AirFleetCommandSystem`

**RELOCATE_FLEET** is a separate deferred feature — see [[air-fleet-relocate]].

## Further Context

- `old-docs/AIR_COMBAT.md` → "Command Layer — Air Fleets"
- `plans/phase-12/phase-12-air-combat.md` → Branch I section
