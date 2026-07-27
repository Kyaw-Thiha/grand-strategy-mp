---
tags: [future-work, networking, performance, infrastructure]
status: deferred
dependency: Phase 14 Economy Integration complete (schema surface stable before migrating once)
---

# Binary Schema Sync + StateView AOI

## What It Does

Replaces the current custom JSON message protocol with Colyseus binary schema sync,
then enables StateView for per-client visibility filtering (Area of Interest).

## Current Architecture vs Target

**Current:** when a division moves, the server calls:
```
broadcast("DIVISION_UPDATES", { divisions: [{ division_id, position_lng, position_lat, ... }] })
```
A full JSON payload is sent to every connected client, every tick, with all field names
spelled out in text.

**After migration:** the server mutates the schema object directly:
```ts
division.position_lng = newLng;   // already happening — server already does this
division.position_lat = newLat;
```
Colyseus tracks which fields changed and sends a tiny binary patch — only changed fields,
encoded by position index (no field name strings). A 3-field change is ~15 bytes vs ~300
bytes JSON. Clients that saw no changes for an entity receive nothing for it.

## Why It Matters

**Bandwidth** — field-level binary delta vs full JSON envelope every tick. With 20+ wings
and 30+ divisions all updating 10× per second each, the difference is roughly 10–20×
reduction in outgoing bytes per client. This is the main optimization for large maps and
end-game unit counts.

**StateView AOI** — once the client uses binary schema, `StateView` becomes available:
```ts
client.view = new StateView();      // assigned in onJoin
client.view.add(division);          // division updates now flow to this client
client.view.remove(division);       // division updates stop flowing
```
This replaces Branch J's manual `broadcastToNationSet()` filtering cleanly. The
`ServerVisibilitySystem` visibility computation logic stays unchanged — only the action
layer swaps (JSON broadcast → `client.view.add/remove`).

**Removes boilerplate** — `serializeWing()` (27 fields manually copied to a dict),
`DIVISION_UPDATES`, `AIR_WING_UPDATES`, and similar state broadcast calls all go away.
Event broadcasts (`WING_RTB`, `UNIT_DESTROYED`, combat notifications) stay as-is —
mixing `broadcast()` with binary schema is fully supported and the standard Colyseus
pattern.

## Current State

**Server: already correct.** Every `DivisionState`, `AirWingState`, `ProvinceState`, etc.
extends Colyseus `Schema` with `@type()` decorators on every field. The systems already
mutate these objects at runtime (`wing.fuel = ...`, `division.combat_state = ...`).
Colyseus is already generating binary deltas from those mutations. They are currently
dropped because the client does not listen to schema packets.

**Client: the missing piece.** `net_manager.gd` handles WebSocket packets manually.
Packets 14 (`ROOM_STATE`) and 15 (`ROOM_STATE_PATCH`) are the binary schema messages —
they are explicitly skipped with a `# handled in Phase 4+` comment. There is no official
Colyseus Godot addon in the project; `msgpack.gd` exists for room message framing but
the `@colyseus/schema` binary format is a separate, distinct encoding that needs its own
decoder.

## Migration Scope

### Server (minimal)
- Schema mutations already happen — no changes needed there
- Once client is ready: remove the redundant JSON state broadcast calls
  (`DIVISION_UPDATES`, `AIR_WING_UPDATES`, etc.)
- Replace `ServerVisibilitySystem.broadcastToNationSet()` calls with
  `client.view.add(entity)` / `client.view.remove(entity)` per client

### Client (significant)
1. Write GDScript `@colyseus/schema` binary decoder in `net_manager.gd`:
   - Handle packets 14 (full encode) and 15 (delta patch)
   - Field index decoding (fields identified by position, not name)
   - `MapSchema` / `ArraySchema` add and remove events
2. Define mirror schema classes in GDScript matching `GameRoomState.ts` field layout and
   declaration order exactly (binary format is position-indexed — order must match)
3. Rewrite `session_manager.gd` + `game_state.gd`: replace JSON message handlers with
   schema `listen()` / `onAdd` / `onRemove` callbacks
4. Assign `client.view = new StateView()` in `GameRoom.onJoin()` and wire
   `ServerVisibilitySystem` to call `add()`/`remove()` instead of broadcasting

## Constraints

- **64 fields per schema class** — hard limit. Workaround: nest sub-schemas. Current
  classes are well under this (DivisionState ~27 fields).
- **Field order is permanent** — fields are identified by declaration index. Add new
  fields at the end only; deprecate with `@deprecated()` instead of deleting. Never
  reorder. This is a forever maintenance discipline.
- **Client and server schema declarations must match exactly** — a mismatch silently
  corrupts decoding with no obvious error.

## Why Deferred Until After Phase 14

All major schema classes need to exist before migrating once:
- Divisions (Phase 4+) ✅
- Air wings (Phase 12) ✅
- Ships / flotillas (Phase 13 — Naval Combat)
- Economy buildings on ProvinceState (Phase 14 — Economy Integration)

Migrating before naval and economy are complete risks migrating again when new schema
classes land. After Phase 14, the schema surface is stable enough to migrate cleanly in
one pass.

The migration cost grows linearly with schema size (not exponentially), so waiting does
not make it significantly harder — it just ensures one migration instead of two.

## Further Context

- `old-docs/DEV_PHASES.md` → Phase 16 `NetworkScalingSystem` entry
- `game-server/src/rooms/schema/GameRoomState.ts` — all schema class definitions
- `client/src/net/net_manager.gd` — packet handler with the `# Phase 4+` comment
- Branch J (`feat/air-networking-aoi`) — implements `ServerVisibilitySystem` with manual
  JSON filtering; this migration replaces only the transport action layer of that system
