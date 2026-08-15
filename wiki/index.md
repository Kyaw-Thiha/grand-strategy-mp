# Grand Strategy Multiplayer Wiki

This wiki explains what each part of the game does, how the parts cooperate, and where the current implementation still differs from the intended design.

Authoritative design sources define the intended game and roadmap. Component notes describe
the current code first, with future work and implementation gaps labelled explicitly.

# Wiki

- [Maintained Documentation](../docs/index.md) — confirmed designs, implementation requirements, roadmap state, and completion checklists.
- [[api-server/index|API Server]] — account and game-independent backend data, lobby coordination, and trusted persistence calls.
- [[game-server/index|Game Server]] — authoritative multiplayer rooms, live game state, and simulation resolution.
- [[client/index|Client]] — Godot presentation, input, local UI state, and the read-only mirror of live game state.
- [[map/index|Map Production]] — geographic source data, validation, and generated map assets.

# Maintained Future Work

Features designed but deferred pending missing mechanics. Each note captures locked-in
design decisions so the feature can be implemented correctly when its dependencies land.

- [Air Fleet Relocation](../docs/future-works/air-fleet-relocate.md)
- [Air Fleet Command](../docs/future-works/air-fleet-command.md)
- [Multi-Unit Selection UI](../docs/future-works/multi-select-ui.md)
- [Binary Schema Sync](../docs/future-works/binary-schema-sync.md)

# Related Notes
