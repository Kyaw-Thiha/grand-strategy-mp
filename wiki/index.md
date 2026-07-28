# Grand Strategy Multiplayer Wiki

This wiki explains what each part of the game does, how the parts cooperate, and where the current implementation still differs from the intended design.

Authoritative design sources define the intended game and roadmap. Component notes describe
the current code first, with future work and implementation gaps labelled explicitly.

# Wiki

- [[docs/index|Authoritative Design Sources]] — confirmed designs, implementation requirements, roadmap state, and completion checklists.
- [[api-server/index|API Server]] — account and game-independent backend data, lobby coordination, and trusted persistence calls.
- [[game-server/index|Game Server]] — authoritative multiplayer rooms, live game state, and simulation resolution.
- [[client/index|Client]] — Godot presentation, input, local UI state, and the read-only mirror of live game state.
- [[map/index|Map Production]] — geographic source data, validation, and generated map assets.

# Future Works

Features designed but deferred pending missing mechanics. Each note captures locked-in
design decisions so the feature can be implemented correctly when its dependencies land.

- [[future-works/air-fleet-relocate|RELOCATE_FLEET]] — Air fleet relocation to a new front; deferred until airbase levels (economy buildings) are implemented.
- [[future-works/air-fleet-command|Air Fleet Command]] — Named theater groupings for batch-assigning missions to air wings; deferred pending multi-select UI design.
- [[future-works/multi-select-ui|Multi-Unit Selection UI]] — Reusable box-select + batch-action panel for air wings, divisions, flotillas; prerequisite for Air Fleet design decision.
- [[future-works/binary-schema-sync|Binary Schema Sync]] — Migrate from custom JSON broadcasts to Colyseus binary schema + StateView AOI; deferred until Phase 14 (Economy Integration) is complete so all major schema classes exist before migrating once.

# Related Notes
