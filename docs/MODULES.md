# Grand Strategy Multiplayer — Module Contracts

> Feed the relevant module contract(s) to Claude Code alongside the source file being worked on.
> Last updated: May 2026.

---

## What Is a Module

A module is a self-contained unit of game behaviour that:
- **Owns** a specific slice of state — no other module may write to it
- **Communicates** only through defined signals or explicit method calls
- **Forbids** a named list of concerns it must never touch

Each module maps to one primary `.gd` script and optionally one `.tscn` scene.
Each lives in its own subfolder under `src/systems/` or `src/core/`.

---

## Module Contract Format

```
MODULE: <name>
PURPOSE: <one sentence — what problem this solves>
OWNS: <what data/state lives here and nowhere else>
EXPOSES:
  signals: <what events it broadcasts>
  methods: <what other modules may call>
CONSUMES:
  signals: <what signals it listens to from EventBus or other autoloads>
  reads: <what state/methods it may read from other modules>
FORBIDDEN FROM:
  <explicit list of what it must never touch>
AUTOLOAD: yes/no
FILE: src/<path>/<name>.gd
```

---

## Priority Tags

- `[CORE]` — must exist from day 1, game cannot run without it
- `[MVP]` — needed for a playable session loop
- `[LATER]` — post-launch or late polish
- `[OPTIONAL]` — cut if scope is too wide

---

## Infrastructure — Autoloads

These are always running. Registered in Project Settings → Autoloads.

---

### EventBus `[CORE]`

```
MODULE: EventBus
PURPOSE: Global signal dispatcher so modules never hold direct references to each other.
OWNS: Nothing — pure relay, no state.
EXPOSES:
  signals:
    province_changed(province_id: String)
    unit_changed(unit_id: String)
    player_changed(user_id: String)
    relation_changed(from_id: String, to_id: String)
    phase_changed(phase: String)
    combat_started(province_id: String)
    combat_resolved(province_id: String, outcome: Dictionary)
    province_captured(province_id: String, new_owner_id: String)
    diplo_proposal_received(proposal: Dictionary)
    diplo_resolved(proposal_id: String, accepted: bool)
    player_eliminated(user_id: String)
    notification_requested(message: String, type: String)
  methods: (none — emit signals directly via EventBus.emit_signal())
CONSUMES:
  signals: none
  reads: nothing
FORBIDDEN FROM: game logic, state storage, any decision-making
AUTOLOAD: yes
FILE: src/core/event_bus.gd
```

---

### GameState `[CORE]`

```
MODULE: GameState
PURPOSE: Read-only client mirror of Colyseus server state. Single source of truth for all
         in-game data on the client. Updated only by NetManager.
OWNS: Local copy of: players dict, provinces dict, units dict, relations dict,
      proposals dict, game_id, map_id, phase, tick, game_speed.
EXPOSES:
  signals: (fires via EventBus, not directly)
  methods:
    get_province(province_id: String) -> Dictionary
    get_unit(unit_id: String) -> Dictionary
    get_player(user_id: String) -> Dictionary
    get_relation(from_id: String, to_id: String) -> Dictionary
    get_my_player() -> Dictionary
    get_my_provinces() -> Array[String]
    get_my_units() -> Array[String]
    get_phase() -> String
    get_tick() -> int
    _apply_server_delta(delta: Dictionary)  # ONLY called by NetManager
CONSUMES:
  signals: none
  reads: AuthManager.get_user_id() to resolve "my" player
FORBIDDEN FROM: any mutation except via _apply_server_delta(),
                combat resolution, economic calculation, diplomatic decisions
AUTOLOAD: yes
FILE: src/core/game_state.gd
```

---

### ConfigManager `[CORE]`

```
MODULE: ConfigManager
PURPOSE: Single source of truth for game constants, balance values, and feature flags.
         Loaded from config JSON at startup. Keeps magic numbers out of game logic.
OWNS: All configuration dictionaries loaded from res://data/config.json.
EXPOSES:
  signals: config_loaded()
  methods:
    get(key: String) -> Variant
    get_map_config(map_id: String) -> Dictionary
    get_balance(key: String) -> Variant
    get_feature_flag(key: String) -> bool
CONSUMES:
  signals: none
  reads: nothing
FORBIDDEN FROM: game logic, network calls, state mutation
AUTOLOAD: yes
FILE: src/core/config_manager.gd
```

---

### SceneManager `[CORE]`

```
MODULE: SceneManager
PURPOSE: Handles all scene transitions and manages loading screens between game states.
OWNS: Current scene reference, transition state, loading progress.
EXPOSES:
  signals:
    scene_changed(scene_name: String)
    loading_started()
    loading_complete()
  methods:
    goto_main_menu()
    goto_lobby()
    goto_game()
    goto_postgame()
CONSUMES:
  signals: SessionManager.session_ended, AuthManager.logged_out
  reads: nothing
FORBIDDEN FROM: game state, network calls, any game logic
AUTOLOAD: yes
FILE: src/core/scene_manager.gd
```

---

### CommandQueue `[CORE]`

```
MODULE: CommandQueue
PURPOSE: The single conduit for all player commands to the server. Nothing sends to
         NetManager except this module. Handles validation, rate limiting, and queuing.
OWNS: Pending command queue, per-command-type rate limit state.
EXPOSES:
  signals:
    command_rejected(type: String, reason: String)
  methods:
    submit(type: String, payload: Dictionary)  # called by all game systems
CONSUMES:
  signals: SessionManager.session_ended (clears queue)
  reads:
    AuthManager.is_authenticated()
    SessionManager.get_phase()
    NetManager.get_connection_state()
FORBIDDEN FROM: game logic, interpreting command results, UI, reading GameState
AUTOLOAD: yes
FILE: src/core/command_queue.gd
```

---

## Network Layer

---

### NetManager `[CORE]`

```
MODULE: NetManager
PURPOSE: Owns the WebSocket connection to Colyseus. Sends commands, receives state
         deltas and server events, updates GameState on broadcast.
OWNS: WebSocket peer, connection state enum, reconnect timer.
EXPOSES:
  signals:
    connected()
    disconnected()
    reconnecting(attempt: int)
    server_event_received(type: String, data: Dictionary)
  methods:
    send_command(type: String, payload: Dictionary)  # called by CommandQueue only
    get_connection_state() -> String
CONSUMES:
  signals: AuthManager.auth_complete (triggers connect with JWT)
  reads: AuthManager.get_jwt()
FORBIDDEN FROM: game logic, UI, direct GameState mutation
                (updates GameState only via GameState._apply_server_delta())
AUTOLOAD: yes
FILE: src/net/net_manager.gd
```

---

### APIClient `[CORE]`

```
MODULE: APIClient
PURPOSE: HTTP REST client for the Hono backend. Attaches JWT to all requests.
         Handles auth errors and token refresh.
OWNS: Base URL config, request queue, in-flight request handles.
EXPOSES:
  signals:
    request_failed(path: String, code: int, error: String)
  methods:
    get_async(path: String) -> Dictionary
    post_async(path: String, body: Dictionary) -> Dictionary
    put_async(path: String, body: Dictionary) -> Dictionary
    delete_async(path: String) -> Dictionary
CONSUMES:
  signals: AuthManager.auth_complete, AuthManager.logged_out
  reads: AuthManager.get_jwt()
FORBIDDEN FROM: game logic, interpreting response semantics (callers do that)
AUTOLOAD: yes
FILE: src/net/api_client.gd
```

---

### SupabaseClient `[CORE]`

```
MODULE: SupabaseClient
PURPOSE: Direct Supabase reads for own player data using anon key + RLS.
         Wraps the supabase-community/godot addon.
OWNS: Supabase connection handle, cached session.
EXPOSES:
  signals:
    profile_fetched(data: Dictionary)
    realtime_update(table: String, payload: Dictionary)
  methods:
    get_own_profile_async() -> Dictionary
    get_own_cosmetics_async() -> Array
    subscribe_realtime(table: String, filter: String)
CONSUMES:
  signals: AuthManager.auth_complete
  reads: AuthManager.get_user_id()
FORBIDDEN FROM: writes of any kind (those go via APIClient → Hono),
                reading other players' private data
AUTOLOAD: yes
FILE: src/net/supabase_client.gd
```

---

## Auth + Steam

---

### SteamManager `[CORE]`

```
MODULE: SteamManager
PURPOSE: GodotSteam wrapper. Initialises the Steam SDK, manages auth ticket lifecycle,
         exposes Steam identity and overlay.
OWNS: Steam initialisation state, active auth ticket handles (must cancel when done).
EXPOSES:
  signals:
    steam_ready()
    auth_ticket_ready(ticket_hex: String)
    auth_ticket_failed()
    overlay_activated(active: bool)
  methods:
    get_steam_id() -> String
    get_steam_display_name() -> String
    request_auth_ticket(identity: String)   # triggers auth_ticket_ready callback
    cancel_auth_ticket()
    open_overlay(url: String)
CONSUMES:
  signals: none
  reads: nothing
FORBIDDEN FROM: network calls to backend, game logic, UI decisions
AUTOLOAD: yes
FILE: src/auth/steam_manager.gd
```

---

### AuthManager `[CORE]`

```
MODULE: AuthManager
PURPOSE: Orchestrates the full Steam → Hono → JWT auth flow. Owns the JWT token.
         Single source of truth for "is this player authenticated".
OWNS: JWT string (memory only, never written to disk), user_id, auth phase.
EXPOSES:
  signals:
    auth_complete(user_id: String)
    auth_failed(error: String)
    logged_out()
  methods:
    login()              # triggers full flow
    logout()
    get_jwt() -> String
    get_user_id() -> String
    is_authenticated() -> bool
    has_host_pass() -> bool
CONSUMES:
  signals:
    SteamManager.steam_ready  (triggers login flow)
    SteamManager.auth_ticket_ready  (sends ticket to Hono)
  reads: uses APIClient.post_async() internally
FORBIDDEN FROM: UI decisions, game logic, direct Steam SDK calls (uses SteamManager),
                writing JWT to disk or any persistent storage
AUTOLOAD: yes
FILE: src/auth/auth_manager.gd
```

---

## Session + Lobby

---

### LobbySystem `[MVP]`

```
MODULE: LobbySystem
PURPOSE: Creates and joins Colyseus rooms. Manages the pre-game lobby state:
         player list, nation selections, ready states.
OWNS: Current lobby room reference, lobby player list, nation selection map.
EXPOSES:
  signals:
    lobby_created(room_id: String, join_code: String)
    lobby_joined(room_id: String)
    lobby_join_failed(error: String)
    player_joined_lobby(player_info: Dictionary)
    player_left_lobby(user_id: String)
    nation_selected(user_id: String, nation_id: String)
    all_players_ready()
  methods:
    create_lobby(settings: Dictionary)   # requires has_host_pass()
    join_public_game()
    join_by_code(code: String)
    select_nation(nation_id: String)
    set_ready(ready: bool)
    leave_lobby()
CONSUMES:
  signals: NetManager.connected, NetManager.disconnected
  reads:
    AuthManager.get_jwt()
    AuthManager.has_host_pass()
    ConfigManager.get("lobby_settings")
FORBIDDEN FROM: game simulation, combat, economy, any in-game state
AUTOLOAD: no
FILE: src/systems/session/lobby_system.gd
```

---

### SessionManager `[MVP]`

```
MODULE: SessionManager
PURPOSE: Owns the game session lifecycle from connection through to post-game.
         Triggers scene transitions and broadcasts lifecycle events.
OWNS: Session phase (connecting / in_lobby / in_game / paused / ended), session metadata.
EXPOSES:
  signals:
    session_started(game_id: String)
    session_paused(requested_by: String)
    session_resumed()
    session_ended(winner_id: String, reason: String)
    speed_changed(speed: int)
  methods:
    request_pause()                       # submits via CommandQueue
    vote_speed(speed: int)                # submits via CommandQueue
    get_phase() -> String
    get_game_id() -> String
CONSUMES:
  signals:
    NetManager.server_event_received  (GAME_STARTED, GAME_PAUSED, GAME_RESUMED,
                                       GAME_ENDED, SPEED_CHANGED)
  reads: GameState.get_phase()
FORBIDDEN FROM: game logic, combat resolution, economic decisions
AUTOLOAD: no
FILE: src/systems/session/session_manager.gd
```

---

## Map

---

### MapLoader `[MVP]`

```
MODULE: MapLoader
PURPOSE: Parses map_data.json (produced by CShapes GeoJSON pipeline) and instantiates
         Polygon2D province nodes into the scene tree. Runs once at game start.
OWNS: Province node registry: Dictionary[province_id → Node2D].
EXPOSES:
  signals:
    map_loaded(province_count: int)
    map_load_failed(error: String)
  methods:
    load_map(map_id: String)
    get_province_node(province_id: String) -> Node2D
    get_all_province_ids() -> Array[String]
CONSUMES:
  signals: SessionManager.session_started
  reads: ConfigManager.get_map_config(map_id)
FORBIDDEN FROM: game logic, rendering colour decisions (that is MapRenderer),
                input handling
AUTOLOAD: no
FILE: src/systems/map/map_loader.gd
```

---

### MapRenderer `[MVP]`

```
MODULE: MapRenderer
PURPOSE: Colours province Polygon2Ds based on ownership, overlay mode (political /
         terrain / supply), and selection state. Pure display layer.
OWNS: Current overlay mode enum, colour assignment cache.
EXPOSES:
  signals: (none)
  methods:
    set_overlay_mode(mode: String)   # "political" | "terrain" | "supply" | ...
    highlight_province(province_id: String, colour: Color)
    clear_highlights()
    refresh_province(province_id: String)
CONSUMES:
  signals:
    EventBus.province_changed
    EventBus.province_captured
    EventBus.phase_changed
  reads:
    GameState.get_province(id)
    GameState.get_player(user_id)
    MapLoader.get_province_node(id)
FORBIDDEN FROM: input handling, game logic, writing GameState
AUTOLOAD: no
FILE: src/systems/map/map_renderer.gd
```

---

### MapInteraction `[MVP]`

```
MODULE: MapInteraction
PURPOSE: Handles all mouse and touch input on the map. Detects province clicks and
         hovers, manages selection state. Emits signals for other systems to act on.
OWNS: Currently selected province_id, currently hovered province_id.
EXPOSES:
  signals:
    province_clicked(province_id: String)
    province_hovered(province_id: String)
    province_right_clicked(province_id: String)
    selection_cleared()
  methods:
    get_selected_province() -> String
    disable_input()
    enable_input()
CONSUMES:
  signals: (none)
  reads: MapLoader.get_all_province_ids() for click detection
FORBIDDEN FROM: game logic, rendering, writing GameState
AUTOLOAD: no
FILE: src/systems/map/map_interaction.gd
```

---

### CameraSystem `[MVP]`

```
MODULE: CameraSystem
PURPOSE: Owns the 2D map camera. Pan, zoom, zoom limits, smooth movement, edge scroll.
OWNS: Camera2D node, current zoom level, current pan position.
EXPOSES:
  signals: (none)
  methods:
    pan_to_province(province_id: String)
    pan_to_position(position: Vector2)
    set_zoom(level: float)
    get_zoom() -> float
    enable_edge_scroll(enabled: bool)
CONSUMES:
  signals: (none — input driven internally)
  reads: MapLoader.get_province_node(id) for pan_to_province()
FORBIDDEN FROM: game state, rendering, input other than camera controls
AUTOLOAD: no
FILE: src/systems/map/camera_system.gd
```

---

## Game Systems

> All simulation resolves server-side. These modules display server state and submit commands.

---

### MilitarySystem `[MVP]`

```
MODULE: MilitarySystem
PURPOSE: Client-side display of unit positions and states. Submits military orders
         (move, attack, stop, deploy, disband) via CommandQueue.
OWNS: Unit icon nodes on the map (visual only), current unit selection.
EXPOSES:
  signals:
    unit_selected(unit_id: String)
    unit_deselected()
  methods:
    select_unit(unit_id: String)
    deselect()
    get_selected_unit() -> String
    move_unit(unit_id: String, target_province_id: String)
    attack(unit_id: String, target_province_id: String)
    stop_unit(unit_id: String)
    deploy_unit(template_id: String, province_id: String)
    disband_unit(unit_id: String)
CONSUMES:
  signals:
    EventBus.unit_changed
    EventBus.phase_changed
    MapInteraction.province_clicked  (for move orders when unit selected)
  reads:
    GameState.get_unit(unit_id)
    GameState.get_my_units()
FORBIDDEN FROM: resolving combat (server only), direct state mutation
AUTOLOAD: no
FILE: src/systems/military/military_system.gd
```

---

### CombatSystem `[MVP]`

```
MODULE: CombatSystem
PURPOSE: Renders ongoing and resolved combat. Shows battle icons on the map,
         attrition display, and outcome popups. All display only.
OWNS: Combat icon nodes, active combat province set.
EXPOSES:
  signals: (none)
  methods:
    show_combat_icon(province_id: String)
    hide_combat_icon(province_id: String)
CONSUMES:
  signals:
    EventBus.combat_started
    EventBus.combat_resolved
    EventBus.province_captured
  reads:
    GameState.get_province(id)
    MapLoader.get_province_node(id)
FORBIDDEN FROM: combat math, any combat decisions, writing GameState
AUTOLOAD: no
FILE: src/systems/military/combat_system.gd
```

---

### DiplomacySystem `[MVP]`

```
MODULE: DiplomacySystem
PURPOSE: Manages diplomatic proposals, active treaties, and relation state.
         Submits diplomacy commands via CommandQueue.
OWNS: Local cache of pending proposals (mirror of GameState.proposals for UI convenience).
EXPOSES:
  signals:
    proposal_received(proposal: Dictionary)
    proposal_resolved(proposal_id: String, accepted: bool)
  methods:
    propose(to_id: String, stance: String)
    respond(proposal_id: String, accept: bool)
    break_relation(with_id: String, stance: String)
    get_relation(with_id: String) -> Dictionary
    get_pending_proposals() -> Array
CONSUMES:
  signals:
    EventBus.diplo_proposal_received
    EventBus.diplo_resolved
  reads:
    GameState.get_relation(from_id, to_id)
    GameState.get_my_player()
FORBIDDEN FROM: accepting proposals on behalf of other players,
                computing diplomatic effects (server only)
AUTOLOAD: no
FILE: src/systems/diplomacy/diplomacy_system.gd
```

---

### EconomySystem `[MVP]`

```
MODULE: EconomySystem
PURPOSE: Displays resource stocks, production rates, and trade overview from server state.
         No client-side economic simulation — all numbers come from GameState.
OWNS: Nothing (pure read and display layer).
EXPOSES:
  signals:
    economy_data_updated()
  methods:
    get_my_resources() -> Dictionary
    get_province_production(province_id: String) -> Dictionary
    get_my_total_industry() -> float
CONSUMES:
  signals: EventBus.province_changed, EventBus.phase_changed
  reads:
    GameState.get_province(id)
    GameState.get_my_provinces()
    GameState.get_my_player()
FORBIDDEN FROM: computing resources or production (server only), writing GameState,
                any economic decisions
AUTOLOAD: no
FILE: src/systems/economy/economy_system.gd
```

---

## Player

---

### PlayerProfile `[MVP]`

```
MODULE: PlayerProfile
PURPOSE: Fetches and caches the local player's persistent data: profile, stats,
         cosmetics owned. Bridge between auth and UI for profile display.
OWNS: Cached profile dict, cached stats, cached cosmetics list.
EXPOSES:
  signals:
    profile_loaded()
    profile_updated()
  methods:
    get_profile() -> Dictionary
    get_stats() -> Dictionary
    get_cosmetics() -> Array[String]
    has_host_pass() -> bool
    refresh_async()
CONSUMES:
  signals: AuthManager.auth_complete
  reads:
    APIClient.get_async("/profile")
    SupabaseClient (for realtime updates)
FORBIDDEN FROM: reading other players' private data, writing game state,
                making gameplay decisions
AUTOLOAD: no
FILE: src/systems/player/player_profile.gd
```

---

### DivisionBuilder `[MVP]`

```
MODULE: DivisionBuilder
PURPOSE: Pre-game deck-building screen. Player designs division templates
         (unit compositions) and saves them to Supabase via Hono.
OWNS: Local division template list, currently editing template state.
EXPOSES:
  signals:
    templates_loaded(templates: Array)
    template_saved(template: Dictionary)
    template_deleted(template_id: String)
    save_failed(error: String)
  methods:
    get_templates() -> Array
    save_template_async(name: String, composition: Array)
    delete_template_async(template_id: String)
    get_template(template_id: String) -> Dictionary
CONSUMES:
  signals: AuthManager.auth_complete (triggers initial load)
  reads: APIClient for all persistence
FORBIDDEN FROM: game balance decisions, using templates during an active game session
                (Colyseus loads templates at game start independently)
AUTOLOAD: no
FILE: src/systems/player/division_builder.gd
```

---

## UI

---

### HUDManager `[MVP]`

```
MODULE: HUDManager
PURPOSE: Orchestrates the visibility of all in-game HUD panels. Context-aware:
         shows/hides panels based on session state and user selection.
OWNS: Panel registry (name → node), panel visibility state.
EXPOSES:
  signals:
    panel_opened(panel_name: String)
    panel_closed(panel_name: String)
  methods:
    show_panel(panel_name: String)
    hide_panel(panel_name: String)
    toggle_panel(panel_name: String)
    close_all()
CONSUMES:
  signals:
    SessionManager.session_started
    SessionManager.session_ended
    MilitarySystem.unit_selected
    MapInteraction.province_clicked
  reads: nothing
FORBIDDEN FROM: game state mutation, game logic, network calls
AUTOLOAD: no
FILE: src/ui/hud/hud_manager.gd
```

---

### NotificationSystem `[MVP]`

```
MODULE: NotificationSystem
PURPOSE: In-game toast alerts, diplomatic messages, combat outcome popups, and
         event notifications. Listens to EventBus and queues display.
OWNS: Notification queue, active popup node pool.
EXPOSES:
  signals: (none)
  methods:
    show(message: String, type: String)         # type: "info"|"warn"|"combat"|"diplo"
    show_combat_result(data: Dictionary)
    show_diplo_proposal(proposal: Dictionary)
CONSUMES:
  signals:
    EventBus.combat_resolved
    EventBus.province_captured
    EventBus.diplo_proposal_received
    EventBus.player_eliminated
  reads: nothing
FORBIDDEN FROM: game decisions, writing GameState, network calls
AUTOLOAD: no
FILE: src/ui/hud/notification_system.gd
```

---

## Later / Optional Modules (summary only)

These are defined by name and priority. Full contracts written when implementation begins.

| Module | Priority | Purpose |
|---|---|---|
| `PoliticsSystem` | `[LATER]` | Nation ideology, government type, political decisions |
| `TechSystem` | `[LATER]` | Research tree display and queue management |
| `SupplySystem` | `[LATER]` | Supply line visualisation and out-of-supply display |
| `CosmeticSystem` | `[LATER]` | Apply owned cosmetics (skins, themes) to game visuals |
| `ShopSystem` | `[LATER]` | In-game cosmetic store, purchase flow |
| `MinimapSystem` | `[LATER]` | Small viewport minimap, click to pan camera |
| `AudioManager` | `[LATER]` | Music tracks, SFX pool, volume settings |
| `VFXManager` | `[LATER]` | Combat particles, province capture flash, movement trails |
| `SpectatorSystem` | `[LATER]` | Observe ongoing game sessions read-only |
| `AchievementSystem` | `[LATER]` | Unlock Steam achievements from game events |
| `WeatherSystem` | `[OPTIONAL]` | Weather overlay display, visual only |
| `AIPlayerSystem` | `[LATER]` | Server-side AI for unfilled nation slots (Colyseus module, not Godot) |

---

## Autoload Registration Order

Order matters — earlier autoloads are available to later ones.

```
1. ConfigManager
2. EventBus
3. GameState
4. SteamManager
5. AuthManager
6. NetManager
7. APIClient
8. SupabaseClient
9. CommandQueue
10. SceneManager
```
