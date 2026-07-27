# Game Server

The game server runs each live multiplayer match. It owns the authoritative room state for players, nations, provinces, divisions, diplomacy, and air wings; validates player commands; resolves the simulation; and broadcasts the resulting state and events to connected clients.

Its state is temporary. A room exists for one session, and the server reports the minimal completed-session result to the API server before the room is discarded.

# Wiki

- [[game-server/overview|Role and Boundaries]]
- [[game-server/room-lifecycle|Room Lifecycle]]
- [[game-server/game-state|Authoritative Game State]]
- [[game-server/commands-and-events|Commands and Events]]
- [[game-server/maps-and-starting-state|Maps and Starting State]]
- [[game-server/testing-and-operations|Testing and Operations]]
- [[game-server/simulation/index|Simulation]]

# Related Notes

- [[api-server/index|API Server]]
- [[docs/ARCHITECTURE|Architecture]]
- [[docs/MODULES|Module Contracts]]
- [[docs/DATA_CONTRACTS|Data Contracts]]
- [[docs/DEV_PHASES|Development Phases]]
