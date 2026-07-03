# Strategic Combat — Branch Tasks

## feat/combat-state-machine
Full Engaged → Suppressed → Retreat → Destroyed state machine. Currently only auto-retreat thresholds exist; the formal state enum and transitions aren't wired up.

## feat/meeting-battle
Meeting battle detection and distinct icon/event. Two divisions advancing into each other needs its own engagement classification separate from standard attacker/defender.

## feat/stack-supply-and-encirclement
Two stack-level rules: supply priority flowing to first division first, and encirclement applying to the whole stack (not per-division). The stack rotation mechanic is checked off but these two sub-rules aren't.

## feat/combat-events
Emit the full set: `COMBAT_STARTED`, `COMBAT_RESULT`, `MEETING_BATTLE_STARTED`, `PROVINCE_CAPTURED`, `UNIT_DESTROYED`, `STACK_ROTATION`, `FRONTLINE_UPDATED`. These are the server→client event contracts that tie everything together.

## feat/pathfinding-improvements
Hierarchical A* query on top of existing two-phase routing, plus Catmull-Rom path smoothing post-processor.
