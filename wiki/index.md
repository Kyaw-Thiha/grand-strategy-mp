# Grand Strategy Multiplayer Wiki

This wiki explains what each part of the game does, how the parts cooperate, and where the current implementation still differs from the intended design.

Pages describe the current code first. Future work and legacy design notes are labelled explicitly.

# Wiki

- [[api-server/index|API Server]] — account and game-independent backend data, lobby coordination, and trusted persistence calls.
- [[game-server/index|Game Server]] — authoritative multiplayer rooms, live game state, and simulation resolution.
- [[client/index|Client]] — Godot presentation, input, local UI state, and the read-only mirror of live game state.

# Related Notes
