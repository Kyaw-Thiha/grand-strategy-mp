# Local Two-Instance Testing Guide

How to run and test the full session loop (lobby → game → end) locally using two Godot instances.

---

## Prerequisites

Both servers must be running. Open two terminals from the repo root:

```bash
# Terminal 1 — api-server (DEV_MODE grants has_host_pass to all accounts)
cd api-server && DEV_MODE=true bun run src/index.ts

# Terminal 2 — game-server
cd game-server && npm start
```

---

## Test Accounts

These accounts are created automatically by the E2E test (`scripts/e2e-session-loop.sh`) and persist in your local Supabase:

| Account | Email | Password | Notes |
|---|---|---|---|
| Bot A | `e2e-bot-a@example.com` | `password123` | Gets `has_host_pass=true` when DEV_MODE=true |
| Bot B | `e2e-bot-b@example.com` | `password123` | Joiner |

If accounts don't exist yet, run `bash scripts/e2e-session-loop.sh` once to create them.

---

## Running Two Godot Instances

1. Open the `client/` project in the Godot editor
2. **Debug → Run Multiple Instances → 2**
3. Press **F5** — two game windows open

The login form auto-fills `e2e-bot-a@example.com` / `password123` in debug builds.  
Change the `a` → `b` in one window before logging in.

---

## Full Walkthrough

**Instance 1 (host):**
1. Email pre-filled as `e2e-bot-a` → **Login**
2. **Create Game** button appears (host pass from DEV_MODE)
3. Click **Create Game** → transitions to lobby screen
4. Note the 6-character join code shown in the lobby header

**Instance 2 (joiner):**
1. Change email to `e2e-bot-b@example.com` → **Login**
2. Type the join code from Instance 1 → **Join**
3. Both instances are now in the lobby

**Both instances:**
1. Click a nation button to claim it (Ready Up is disabled until a nation is selected)
2. Click **Ready Up** (turns to "Cancel Ready")
3. Instance 1 (host): **Start** button appears → click it
4. Both windows transition to the map debug scene

---

## Automated E2E Test

The TypeScript bot script exercises the same flow headlessly:

```bash
bash scripts/e2e-session-loop.sh
```

This starts both servers (with DEV_MODE=true), runs all 11 steps, and tears down. Use this for CI or quick regression checks without opening Godot.

---

## Debugging Gotchas

Issues discovered during Phase 3 development — kept here so future contributors don't repeat the same debugging.

### Godot: `%NodeName` nodes not found (`unique_name_in_owner`)
**Symptom:** `ERROR: Node not found: "%EmailField"` on scene load, everything null.  
**Cause:** `unique_name_in_owner=true` placed as an attribute in the `[node]` header of a `.tscn` file is invalid. It must be a body property on its own line.  
**Fix:**
```
# Wrong
[node name="EmailField" type="LineEdit" parent="..." unique_name_in_owner=true]

# Correct
[node name="EmailField" type="LineEdit" parent="..."]
unique_name_in_owner = true
```

### Godot: WebSocket connects but client is stuck at "Connecting..."
**Symptom:** Colyseus logs show the room created then immediately disposed. Client never transitions.  
**Cause 1 — Wrong WebSocket URL:** Colyseus 0.17 requires `/{processId}/{roomId}?sessionId=...`. The `processId` comes from the matchmake HTTP response and must be included in the path.  
**Cause 2 — Lambda closure captures primitives by value:** GDScript 4 lambdas do NOT share primitive variables (`bool`, `String`, `int`) with the outer scope — they capture a copy. Use a `Dictionary` (reference type) to share mutable state between a lambda and a `while` loop.

```gdscript
# Wrong — 'done' in the lambda is a separate copy
var done := false
var cb := func(): done = true   # modifies its own copy
while not done: await ...       # outer 'done' never changes → infinite loop

# Correct — Dictionary is a reference type, shared by both sides
var state := {"done": false}
var cb := func(): state["done"] = true
while not state["done"]: await ...
```

**Cause 3 — Missing JOIN_ROOM ACK:** Colyseus 0.17 requires the client to send `[10]` back after receiving the JOIN_ROOM packet (byte 10). Without the ACK the connection is accepted but unstable.

### Godot: Lobby UI doesn't update when players join / select nations
**Symptom:** Nations list stays empty after another player joins.  
**Cause:** `LOBBY_STATE_UPDATE` messages are consumed by `NetManager` and routed to `GameState._apply_server_delta()` — they are never forwarded to `server_event_received`. UI must connect to `EventBus.lobby_state_updated` (emitted by `GameState` after applying a delta), not to `server_event_received`.
