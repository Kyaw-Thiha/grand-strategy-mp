# Plan: Phase 6 — Division Template Assignment & Composition Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Save this plan to:** `plans/phase-6-division-template-assignment.md`

**Goal:** Wire the client-side `DivisionTemplateStore` to actual strategic-map divisions, so players can assign a division template to a unit and see its composition. Adds a mini 5×5 composition grid to the existing bottom selection panel, plus a new `DivisionTemplateViewerPanel` center overlay for viewing and assigning templates.

**Architecture:**
- New production server message `ASSIGN_TEMPLATE` sets `template_id` + populates grid cells + recomputes derived fields (`division_type`, `engagement_radius`, `movement_profile_json`).
- Client reads `template_id` from the Colyseus-synced `DivisionState` and looks up cell layout in `DivisionTemplateStore` (local).
- Mini-comp grid in `friendly_division_panel.gd` renders 25 `ColorRect` cells by unit class color. Clicking opens `DivisionTemplateViewerPanel`.
- `DivisionTemplateViewerPanel` is a `FULL_CENTER` overlay (same pattern as `DivisionBuilderPanel`). Left = read-only 5×5 grid reusing `UnitGlyphCell`. Right = two states: View (overview) and Select (template list + Confirm).
- Phase 8 migration path: only `DivisionTemplateStore._load_presets()` changes — all downstream code stays the same.

**Tech Stack:** TypeScript + Mocha/tsx (server), GDScript 4 + Godot 4 (client).

---

## Global Constraints

- All GDScript: `class_name`, fully typed variables (`var x: String = ""`), `@onready` where applicable
- Theme on PanelContainers: `load("res://assets/themes/hud_dark.tres")`
- Server test runner: `NODE_ENV=test npx mocha -r tsx <test_file> --exit --timeout 180000`
- Do NOT use SET_CELL from production client code — it is test-only (`NODE_ENV === "test"` guard)
- Division template cannot be changed while `combat_state` is `"engaged"`, `"retreating"`, or `"suppressed"` — server rejects, client shows locked UI
- `template_id = ""` means no template assigned — mini-grid shows all-empty cells, viewer right-side shows "NO TEMPLATE ASSIGNED" notice
- `UnitGlyphCell` scene: `res://scenes/game/panels/unit_glyph_cell.tscn` (already exists from G-Builder)
- `DivisionTemplateStore` autoload already exists with `get_template(id)`, `get_templates()` methods
- Client sends commands via `CommandQueue.submit(type, payload)` — do not call NetManager directly

---

## Key Existing Files (DO NOT recreate)

| File | Purpose |
|---|---|
| `client/src/ui/hud/friendly_division_panel.gd` | Bottom panel to modify (add mini-comp grid) |
| `client/scenes/game/panels/friendly_division_panel.tscn` | Bottom panel scene to modify |
| `client/src/ui/hud/unit_glyph_cell.gd` | Reuse for read-only grid in viewer |
| `client/scenes/game/panels/unit_glyph_cell.tscn` | Reuse for read-only grid in viewer |
| `client/src/ui/hud/division_builder_panel.gd` | Reference for viewer layout (copy grid-panel and right-panel patterns) |
| `client/src/core/division_template_store.gd` | Source of template data (`get_template(id)` → `{id, name, cells[25]}`) |
| `client/src/core/event_bus.gd` | Add 2 new signals |
| `client/src/ui/hud/game_hud.gd` | Register new panel with HUDManager |
| `game-server/src/rooms/GameRoom.ts` | Add ASSIGN_TEMPLATE production handler **and** add `template_id` to `serializeDivision()` |
| `game-server/src/rooms/schema/GameRoomState.ts` | DivisionState — `template_id` already `@type("string")` synced |
| `game-server/src/systems/movement_system.ts` | `computeMovementProfile()`, `classifyDivisionType()`, `computeEngagementRadius()` |
| `game-server/src/data/maps/western_europe_6/default_template.ts` | Reference for template cell format used by movement system |

---

## ASCII Reference Diagrams

The execution agent MUST use these diagrams for all UI decisions. Do not deviate.

### Diagram 1 — Bottom Panel (idle) with mini-comp grid

The existing `HBox` has: `IdentityBlock | BarsBlock | ActionsBlock | Spacer`.
Insert a new `CompBlock` between `BarsBlock` and `ActionsBlock`.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                    COMP                                 │
│  [▣] germany_div_04    HP              100%     ┌─────────┐                            │
│      TEMPLATE · INF    ████████████████████████  │I · I · ·│  [Move]      [Hold [G]]  │
│      STATE · IDLE      SUPPRESSION          0%   │I A I · ·│                           │
│                        ░░░░░░░░░░░░░░░░░░░░░░░   │R S · · ·│  [Cancel]                │
│                                                  │I · · · ·│                           │
│                                                  │· · · · ·│                           │
│                                                  └─────────┘                           │
│                                                  (click to open template viewer)        │
└─────────────────────────────────────────────────────────────────────────────────────────┘

Cell color key (each cell is a tiny ColorRect ~8×8px, 2px gap):
  I = infantry class  (#6B7D2E olive)   — infantry, assault_infantry, mg, commando,
                                           flamethrower, at_infantry, sniper
  A = armor class     (#4A6FA5 blue)    — light_tank, medium_tank, heavy_tank,
                                           armoured_car, at_gun_sp, self_propelled_gun
  R = artillery class (#8B3030 dark red)— artillery, howitzer, at_gun, aa_gun
  S = recon class     (#1A8C80 teal)    — recon_infantry, cavalry, force_recon_sniper
  · = empty           (#1A1412 dark)
```

### Diagram 2 — Bottom Panel (combat) — comp grid visible but locked

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                    COMP                                 │
│  [▣] germany_div_05    HP              100%     ┌─────────┐                            │
│      TEMPLATE · INF    ████████████████████████  │I · I · ·│  [Move]      [Hold [G]]  │
│      STATE · ENGAGED   SUPPRESSION          0%   │I A I · ·│  [Retreat C] [Cancel]    │
│                        ░░░░░░░░░░░░░░░░░░░░░░░   │R S · · ·│                           │
│                                                  │I · · · ·│  [Reposition B]           │
│                                                  │· · · · ·│                           │
│                                                  └─────────┘                           │
│                                        (click → viewer opens but locked, no change)    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Diagram 3 — DivisionTemplateViewerPanel: View State

Center overlay. Left 60% = read-only 5×5 grid. Right 40% = overview + [Change Template →].

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌ DIVISION TEMPLATE   germany_div_04                                                 [X] │
├───────────────────────────────────────────────┬──────────────────────────────────────────┤
│ TEMPLATE GRID · 5×5            front-to-back↓ │ CURRENT TEMPLATE                         │
│                                               │                                          │
│         ══════ FRONT LINE ══════              │ 1st Infantry Div                         │
│                                               │ Infantry Division          ~50 km        │
│ VANGUARD  ┌─────┐ ┌╌╌╌╌╌┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                    │
│ +supp     │ [/] │ ╎  ·  ╎ │ [/] │ ╎  ·  ╎ ╎  ·  ╎ │ MOVEMENT PROFILE                   │
│           │ RCN │         │ RCN │                  │ [░░][▒▒][▓▓][▨▨][██]               │
│           └─────┘ └╌╌╌╌╌┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │ Plains Hills Forest DnsF Mtn       │
│ ASSAULT   ┌─────┐ ┌─────┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                    │
│ +HP       │ [╳] │ │ [╳] │ │ [╳] │ ╎  ·  ╎ ╎  ·  ╎ │ FILL & ROLE BALANCE    11/25 cells │
│           │ ASI │ │ ASI │ │ INF │                  │ VANGUARD  ██░░░░░░░░░  2/5          │
│           └─────┘ └─────┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │ ASSAULT   ███░░░░░░░░  3/5         │
│ SUPPORT   ┌─────┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │ SUPPORT   ██░░░░░░░░░  2/5         │
│ +resist   │ [•] │ │ [/] │ ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ │ RESERVE   █░░░░░░░░░░  1/5         │
│           │ ART │ │ ATG │                           │ REAR      ░░░░░░░░░░░  0/5         │
│           └─────┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │                                    │
│ RESERVE   ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                    │
│ +decay    │ [╳] │ ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ │                                    │
│           │ INF │                                  │                                    │
│           └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │         [Change Template →]        │
│ REAR      ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                    │
│           ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ ╎  ·  ╎ │ (if locked: "Template cannot be   │
│           └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │  changed while div is engaged")    │
└───────────────────────────────────────────────┴──────────────────────────────────────────┘
  Cells are DISPLAY-ONLY — clicking does nothing
  If template_id = "" → all cells empty; right shows "NO TEMPLATE ASSIGNED"
  If combat_state = engaged/retreating/suppressed → [Change Template →] is hidden;
    locked notice shown instead
```

### Diagram 4 — DivisionTemplateViewerPanel: Select State

After clicking `[Change Template →]`. Right side becomes scrollable template list.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌ DIVISION TEMPLATE   germany_div_04                                                 [X] │
├───────────────────────────────────────────────┬──────────────────────────────────────────┤
│ TEMPLATE GRID · 5×5            front-to-back↓ │ SELECT TEMPLATE               [← Back]  │
│                                               │                                          │
│  (left grid updates live as templates         │ ┌──────────────────────────────────────┐ │
│   are hovered in the list — shows a           │ │ [★] 1st Infantry Div  [CURRENT]      │ │
│   PREVIEW of that template's cells.           │ │     Infantry Division  · ~50 km      │ │
│   Grid reverts to current template on         │ └──────────────────────────────────────┘ │
│   mouse-exit from card.)                      │ ┌──────────────────────────────────────┐ │
│                                               │ │     3rd Mechanized                   │ │
│ VANGUARD  ┌─────┐ ...                         │ │     Combined-Arms  ·  ~40 km         │ │
│ ASSAULT   ...                                 │ └──────────────────────────────────────┘ │
│ SUPPORT   ...                                 │ ┌──────────────────────────────────────┐ │
│ RESERVE   ...                                 │ │     Armoured Spearhead               │ │
│ REAR      ...                                 │ │     Armoured Assault  ·  ~30 km      │ │
│                                               │ └──────────────────────────────────────┘ │
│                                               │ ──────────────────────────────────────── │
│                                               │  [Confirm — apply to germany_div_04]     │
└───────────────────────────────────────────────┴──────────────────────────────────────────┘
  Hover card → left grid previews it (mouse_entered on card)
  Mouse leaves card → left grid reverts to _current_template_id (mouse_exited)
  Click card → teal border (selected); Confirm becomes active
  [Confirm] → sends ASSIGN_TEMPLATE → closes panel
  [← Back] → reverts grid to current template; returns to View state
  [X] → closes without applying any change
```

---

## Files to Create

- `game-server/test/6-assign-template.test.ts` — server integration tests
- `client/src/ui/hud/division_template_viewer_panel.gd` — new center overlay script
- `client/scenes/game/panels/division_template_viewer_panel.tscn` — new center overlay scene

## Files to Modify

- `game-server/src/rooms/GameRoom.ts` — add `ASSIGN_TEMPLATE` production handler
- `client/src/core/event_bus.gd` — add 2 signals
- `client/src/ui/hud/friendly_division_panel.gd` — add mini-comp grid
- `client/scenes/game/panels/friendly_division_panel.tscn` — add CompBlock node
- `client/src/ui/hud/game_hud.gd` — register DivisionTemplateViewerPanel

---

## Task 1: Server — ASSIGN_TEMPLATE production handler + tests

**Files:**
- Create: `game-server/test/6-assign-template.test.ts`
- Modify: `game-server/src/rooms/GameRoom.ts`

**Background:**
- `ASSIGN_TEMPLATE` must be a PRODUCTION handler — NOT inside the `if (process.env.NODE_ENV === "test")` block
- `SET_CELL` already exists inside the test block — DO NOT touch it
- `DivisionState.template_id` is schema-synced (`@type("string")`)
- `DivisionState.grid` is server-side only (no `@type`) — cells are populated but not sent to client
- First grep for the exact DEFAULT_TEMPLATE format and movement system function signatures:

```bash
cat game-server/src/data/maps/western_europe_6/default_template.ts
grep -n "computeMovementProfile\|classifyDivisionType\|computeEngagementRadius" \
  game-server/src/systems/movement_system.ts | head -20
```

Use the DEFAULT_TEMPLATE format as the exact input format for movement system calls.

- [ ] **Step 1: Write the test file (RED)**

Create `game-server/test/6-assign-template.test.ts`:

```typescript
import assert from "assert";
import { describe, it, before, after, beforeEach } from "mocha";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { SignJWT } from "jose";
import appConfig from "../src/app.config.js";
import type { GameRoomState } from "../src/rooms/schema/GameRoomState.js";
import {
  setRoundTicksForTesting,
  setCombatGraceTicksForTesting,
} from "../src/systems/combat_system.js";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const jwtSecret = new TextEncoder().encode(JWT_SECRET);

async function makeToken(sub = "test-user") {
  return new SignJWT({ sub, steam_id: "dev_steam", has_host_pass: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
}

describe("ASSIGN_TEMPLATE handler", function () {
  this.timeout(60_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => {
    setRoundTicksForTesting(3);
    setCombatGraceTicksForTesting(1);
    colyseus = await boot(appConfig);
  });
  after(async () => {
    setRoundTicksForTesting(20);
    setCombatGraceTicksForTesting(10);
    await new Promise(r => setTimeout(r, 300));
    await colyseus.shutdown();
  });
  beforeEach(async () => { await colyseus.cleanup(); });

  async function startGame() {
    const token = await makeToken();
    const room = await colyseus.createRoom<GameRoomState>("game_room", {});
    const client = await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();
    await (room as any).startGame();
    await room.waitForNextPatch();
    const divId = [...room.state.divisions.keys()][0];
    return { room, client, divId };
  }

  it("sets template_id on the division", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [
        { cell_index: 0, unit_type: "recon_infantry" },
        { cell_index: 5, unit_type: "infantry" },
        { cell_index: 6, unit_type: "infantry" },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    assert.strictEqual(div!.template_id, "preset_infantry");
  });

  it("populates grid cells from the message", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_combined_arms",
      cells: [
        { cell_index: 0,  unit_type: "recon_infantry" },
        { cell_index: 5,  unit_type: "medium_tank"    },
        { cell_index: 10, unit_type: "artillery"       },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    const grid = (div as any).grid;
    assert.strictEqual(grid.cells[0].unit_type,  "recon_infantry");
    assert.strictEqual(grid.cells[5].unit_type,  "medium_tank");
    assert.strictEqual(grid.cells[10].unit_type, "artillery");
    assert.strictEqual(grid.cells[1].unit_type,  "");
  });

  it("clears previously-set cells when new template is assigned", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_combined_arms",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [{ cell_index: 5, unit_type: "recon_infantry" }],
    });
    await room.waitForNextPatch();
    const grid = (room.state.divisions.get(divId) as any).grid;
    assert.strictEqual(grid.cells[0].unit_type, "");
    assert.strictEqual(grid.cells[5].unit_type, "recon_infantry");
  });

  it("recomputes division_type based on assigned cells", async () => {
    const { room, client, divId } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_armoured",
      cells: [
        { cell_index: 0,  unit_type: "heavy_tank"   },
        { cell_index: 1,  unit_type: "heavy_tank"   },
        { cell_index: 5,  unit_type: "medium_tank"  },
        { cell_index: 6,  unit_type: "medium_tank"  },
        { cell_index: 10, unit_type: "armoured_car" },
      ],
    });
    await room.waitForNextPatch();
    const div = room.state.divisions.get(divId);
    assert.strictEqual(div!.division_type, "armoured");
  });

  it("is rejected when division is engaged", async () => {
    const { room, client, divId } = await startGame();
    const div = room.state.divisions.get(divId);
    (div as any).combat_state = "engaged";
    const originalId = div!.template_id;
    client.send("ASSIGN_TEMPLATE", {
      division_id: divId,
      template_id: "preset_infantry",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    assert.strictEqual(div!.template_id, originalId);
  });

  it("is a no-op for non-existent division", async () => {
    const { room, client } = await startGame();
    client.send("ASSIGN_TEMPLATE", {
      division_id: "nonexistent-div",
      template_id: "preset_infantry",
      cells: [{ cell_index: 0, unit_type: "infantry" }],
    });
    await room.waitForNextPatch();
    // passes if no crash
  });
});
```

- [ ] **Step 2: Run tests — expect RED**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/game-server
NODE_ENV=test npx mocha -r tsx test/6-assign-template.test.ts --exit --timeout 60000 2>&1 | tail -30
```

- [ ] **Step 3: Grep movement system signatures before writing handler**

```bash
grep -n "export function computeMovementProfile\|export function classifyDivisionType\|export function computeEngagementRadius" \
  game-server/src/systems/movement_system.ts
cat game-server/src/data/maps/western_europe_6/default_template.ts | head -40
```

Note the exact function signatures and what input shape they expect (e.g., `Array<{unit_type: string}>` or similar). Adapt the handler's `.map()` call below to match.

- [ ] **Step 4: Add ASSIGN_TEMPLATE production handler to `GameRoom.ts`**

Open `game-server/src/rooms/GameRoom.ts`. Find the production `this.onMessage(...)` block (non-test-guarded). The last production handler is `REORDER_STACK`. Add AFTER it, BEFORE any `if (process.env.DEV_MODE ...)` block:

```typescript
this.onMessage("ASSIGN_TEMPLATE", (_client, msg: {
  division_id: string;
  template_id: string;
  cells: Array<{ cell_index: number; unit_type: string }>;
}) => {
  const div = this.state.divisions.get(msg.division_id);
  if (!div) return;
  if (["engaged", "retreating", "suppressed"].includes(div.combat_state)) return;

  div.template_id = msg.template_id;

  // Clear all grid cells then populate from message
  if (div.grid) {
    for (const cell of div.grid.cells) {
      cell.unit_type = "";
    }
    for (const { cell_index, unit_type } of msg.cells) {
      if (cell_index >= 0 && cell_index < div.grid.cells.length && unit_type !== "") {
        div.grid.cells[cell_index].unit_type = unit_type;
      }
    }
  }

  // Recompute derived fields.
  // TemplateCell requires {unit_type, row, col} — derive row/col from cell_index.
  const templateCells = msg.cells
    .filter(c => c.unit_type !== "")
    .map(c => ({
      unit_type: c.unit_type,
      row: Math.floor(c.cell_index / 5),
      col: c.cell_index % 5,
    }));

  div.division_type = this.movementSystem.classifyDivisionType(templateCells);
  div.engagement_radius = this.movementSystem.computeEngagementRadius(templateCells);
  div.movement_profile_json = JSON.stringify(
    this.movementSystem.computeMovementProfile(templateCells)
  );
});
```

> **Note:** If the movement system functions are not on `this.movementSystem`, grep for where they are called in `spawnDivisions()` in `GameRoom.ts` (around line 487-510) and copy the same call pattern.

- [ ] **Step 4b: Add `template_id` to `serializeDivision()` in `GameRoom.ts`**

`template_id` has `@type("string")` on `DivisionState` but is NOT included in `serializeDivision()` (verified at line 583–605). The client receives division updates via `DIVISION_UPDATES` broadcasts using this function, so without this fix every `data.get("template_id", "")` on the client returns `""` regardless of server state.

Find `serializeDivision` in `GameRoom.ts`. Add `template_id` to the returned object:

```typescript
// FIND inside serializeDivision return block:
      engagement_radius: div.engagement_radius,

// REPLACE with:
      engagement_radius: div.engagement_radius,
      template_id: div.template_id,
```

> This must be done before any client-side code reads `template_id` from division data (Steps 9, 12, 16, 20 all depend on it).

- [ ] **Step 5: Run tests — expect GREEN**

```bash
NODE_ENV=test npx mocha -r tsx test/6-assign-template.test.ts --exit --timeout 60000 2>&1 | tail -30
```

Expected: `5 passing`

- [ ] **Step 6: Run full server test suite — no regressions**

```bash
NODE_ENV=test npx mocha -r tsx "test/**/*.test.ts" --exit --timeout 180000 2>&1 | tail -30
```

- [ ] **Step 7: Commit**

```bash
git add game-server/src/rooms/GameRoom.ts game-server/test/6-assign-template.test.ts
git commit -m "feat: add ASSIGN_TEMPLATE production handler with grid population and movement profile recompute"
```

---

## Task 2: Client — EventBus signals + GameState template_id tracking

**Files:**
- Modify: `client/src/core/event_bus.gd`
- Verify: `client/src/core/game_state.gd`

- [ ] **Step 8: Add 2 signals to EventBus**

Open `client/src/core/event_bus.gd`. After the last existing signal, append:

```gdscript
# ── Division Template Viewer ─────────────────────────────────────────────
signal division_template_viewer_open_requested(division_id: String)
signal division_template_viewer_closed()
```

- [ ] **Step 9: Add `template_id` to GameState division data**

Open `client/src/core/game_state.gd`. Find the function that builds the division Dictionary from incoming `DIVISION_UPDATES` data (search for where `"division_type"` or `"engagement_radius"` are copied into the dict — that is the right place).

Add `template_id` alongside the other fields being copied:
```gdscript
entry["template_id"] = data.get("template_id", "")
```

> `template_id` is now sent by the server (Step 4b). This step maps it into the local data dict that `get_division()` returns to UI code.

The existing `division_updated` signal fires on any field change — no new signal needed.

- [ ] **Step 10: Commit**

```bash
git add client/src/core/event_bus.gd client/src/core/game_state.gd
git commit -m "feat: add division_template_viewer EventBus signals and ensure template_id in GameState"
```

---

## Task 3: Client — Mini-comp grid in FriendlyDivisionPanel

**Files:**
- Modify: `client/scenes/game/panels/friendly_division_panel.tscn`
- Modify: `client/src/ui/hud/friendly_division_panel.gd`

Insert a `CompBlock` VBoxContainer in the `.tscn` `HBox`, between `BarsBlock` and `ActionsBlock`. It contains a "COMP" label + a `GridContainer` (5 columns) for 25 `ColorRect` nodes.

### Unit class → color mapping

```
infantry, assault_infantry, mg, commando, flamethrower, at_infantry, sniper
  → Color(0.42, 0.49, 0.18, 1.0)   [olive]

light_tank, medium_tank, heavy_tank, armoured_car, at_gun_sp, self_propelled_gun
  → Color(0.29, 0.43, 0.65, 1.0)   [steel blue]

artillery, howitzer, at_gun, aa_gun
  → Color(0.55, 0.19, 0.19, 1.0)   [dark red]

recon_infantry, cavalry, force_recon_sniper
  → Color(0.10, 0.55, 0.50, 1.0)   [teal]

"" (empty)
  → Color(0.10, 0.08, 0.07, 1.0)   [very dark brown]
```

- [ ] **Step 11: Add CompBlock to friendly_division_panel.tscn**

Open `client/scenes/game/panels/friendly_division_panel.tscn`. In the `Margin/HBox` node, add a new `VBoxContainer` named `CompBlock` between `BarsBlock` and `ActionsBlock`:

```
[node name="CompBlock" type="VBoxContainer" parent="Margin/HBox"]
layout_mode = 2
alignment = 1
custom_minimum_size = Vector2(62, 0)
theme_override_constants/separation = 2

[node name="CompLabel" type="Label" parent="Margin/HBox/CompBlock"]
layout_mode = 2
text = "COMP"
horizontal_alignment = 1
theme_override_font_sizes/font_size = 9

[node name="CompGrid" type="GridContainer" parent="Margin/HBox/CompBlock"]
layout_mode = 2
columns = 5
theme_override_constants/h_separation = 2
theme_override_constants/v_separation = 2
mouse_filter = 0
```

The 25 `ColorRect` children will be added in GDScript `_ready()` (see Step 12) — do NOT add them manually to the .tscn.

- [ ] **Step 12: Update friendly_division_panel.gd**

Open `client/src/ui/hud/friendly_division_panel.gd`.

**Addition 1:** After existing variable declarations, add the following. **Skip `_current_div_id` — it already exists at line 20 of the file. Do not redeclare it.**

```gdscript
var _comp_grid: GridContainer
var _comp_cells: Array = []  # Array[ColorRect], 25 elements
# NOTE: _current_div_id already declared at line 20 — do NOT add it again

const UNIT_CLASS_COLOR: Dictionary = {
    "infantry": Color(0.42, 0.49, 0.18, 1.0),
    "assault_infantry": Color(0.42, 0.49, 0.18, 1.0),
    "mg": Color(0.42, 0.49, 0.18, 1.0),
    "commando": Color(0.42, 0.49, 0.18, 1.0),
    "flamethrower": Color(0.42, 0.49, 0.18, 1.0),
    "at_infantry": Color(0.42, 0.49, 0.18, 1.0),
    "sniper": Color(0.42, 0.49, 0.18, 1.0),
    "light_tank": Color(0.29, 0.43, 0.65, 1.0),
    "medium_tank": Color(0.29, 0.43, 0.65, 1.0),
    "heavy_tank": Color(0.29, 0.43, 0.65, 1.0),
    "armoured_car": Color(0.29, 0.43, 0.65, 1.0),
    "at_gun_sp": Color(0.29, 0.43, 0.65, 1.0),
    "self_propelled_gun": Color(0.29, 0.43, 0.65, 1.0),
    "artillery": Color(0.55, 0.19, 0.19, 1.0),
    "howitzer": Color(0.55, 0.19, 0.19, 1.0),
    "at_gun": Color(0.55, 0.19, 0.19, 1.0),
    "aa_gun": Color(0.55, 0.19, 0.19, 1.0),
    "recon_infantry": Color(0.10, 0.55, 0.50, 1.0),
    "cavalry": Color(0.10, 0.55, 0.50, 1.0),
    "force_recon_sniper": Color(0.10, 0.55, 0.50, 1.0),
}
const UNIT_CLASS_EMPTY_COLOR := Color(0.10, 0.08, 0.07, 1.0)
```

**Addition 2:** In `_ready()`, after existing `get_node_or_null` calls:

```gdscript
_comp_grid = get_node_or_null("Margin/HBox/CompBlock/CompGrid") as GridContainer
_build_comp_cells()
if _comp_grid != null:
    _comp_grid.gui_input.connect(_on_comp_grid_input)
```

**Addition 3:** `_current_div_id = div_id` already exists at line 48 of `populate()` — verify it is there, do not add a duplicate.

**Addition 4:** In `_refresh_stats(data)`, at the end of the method:
```gdscript
_refresh_comp_grid(data)
```

**Addition 5:** Add new methods:

```gdscript
func _build_comp_cells() -> void:
    if _comp_grid == null:
        return
    _comp_cells.clear()
    for i: int in range(25):
        var rect := ColorRect.new()
        rect.custom_minimum_size = Vector2(8, 8)
        rect.color = UNIT_CLASS_EMPTY_COLOR
        _comp_grid.add_child(rect)
        _comp_cells.append(rect)


func _refresh_comp_grid(data: Dictionary) -> void:
    if _comp_cells.is_empty():
        return
    var template_id: String = data.get("template_id", "")
    var cells: Array = []
    if template_id != "":
        var template: Dictionary = DivisionTemplateStore.get_template(template_id)
        cells = template.get("cells", [])
    for i: int in range(25):
        var rect: ColorRect = _comp_cells[i] as ColorRect
        var unit_type: String = cells[i] if i < cells.size() else ""
        rect.color = UNIT_CLASS_COLOR.get(unit_type, UNIT_CLASS_EMPTY_COLOR)


func _on_comp_grid_input(event: InputEvent) -> void:
    var mb := event as InputEventMouseButton
    if mb and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
        EventBus.division_template_viewer_open_requested.emit(_current_div_id)
```

- [ ] **Step 13: Manual test — mini-comp grid**

Launch the game. Select a division. Verify:
- "COMP" label + 5×5 dark grid appears between bars and action buttons
- No crash when clicking the comp grid
- After Task 4 and 5 are done, clicking opens the viewer

- [ ] **Step 14: Commit**

```bash
git add client/scenes/game/panels/friendly_division_panel.tscn \
        client/src/ui/hud/friendly_division_panel.gd
git commit -m "feat: add mini composition grid to FriendlyDivisionPanel bottom bar"
```

---

## Task 4: Client — DivisionTemplateViewerPanel

**Files:**
- Create: `client/scenes/game/panels/division_template_viewer_panel.tscn`
- Create: `client/src/ui/hud/division_template_viewer_panel.gd`

Reference patterns from `division_builder_panel.gd` (copy `_build_grid_panel()` structure) and `division_builder_panel.tscn` (copy PanelContainer shell).

**Key difference from builder:** UnitGlyphCell nodes in the left grid have NO signals connected (display-only). No editing.

- [ ] **Step 15: Create division_template_viewer_panel.tscn**

Copy the PanelContainer shell structure from `division_builder_panel.tscn`. Change script to `division_template_viewer_panel.gd`. Keep minimum size `1100×680`. The scene tree:

```
DivisionTemplateViewerPanel (PanelContainer, script attached)
  Margin (MarginContainer, margins 12px all sides)
    VBox (VBoxContainer, separation 8)
      TopBar (HBoxContainer, unique_name_in_owner = true)
      Body (HBoxContainer, unique_name_in_owner = true, size flags fill+expand both axes)
```

All further child nodes are built in GDScript `_ready()`.

- [ ] **Step 16: Create division_template_viewer_panel.gd**

Create `client/src/ui/hud/division_template_viewer_panel.gd`. The structure is:

```gdscript
class_name DivisionTemplateViewerPanel
extends PanelContainer

signal close_requested()

const _CELL_SCENE: PackedScene = preload("res://scenes/game/panels/unit_glyph_cell.tscn")

const ROW_NAMES: Array[String] = ["VANGUARD", "ASSAULT", "SUPPORT", "RESERVE", "REAR"]
const ROW_COLORS: Array = [
    Color(0.80, 0.15, 0.15, 1.0),   # VANGUARD — red
    Color(0.85, 0.45, 0.10, 1.0),   # ASSAULT — orange
    Color(0.75, 0.65, 0.10, 1.0),   # SUPPORT — yellow
    Color(0.15, 0.60, 0.25, 1.0),   # RESERVE — green
    Color(0.20, 0.40, 0.75, 1.0),   # REAR — blue
]
const ROW_PERK_HINTS: Array[String] = ["+supp dealt", "+HP damage", "+supp resist", "↑ supp decay", "—"]
const ARMOR_TYPES := ["light_tank","medium_tank","heavy_tank","armoured_car","at_gun_sp","self_propelled_gun"]
const ARTY_TYPES  := ["artillery","howitzer","at_gun","aa_gun"]
```

**State variables:**

```gdscript
var _division_id: String = ""
var _current_template_id: String = ""
var _preview_template_id: String = ""
var _is_locked: bool = false

var _cells: Array = []         # Array[String], 25 elements, currently shown in left grid
var _cell_nodes: Array = []    # Array[UnitGlyphCell], 25 nodes

var _div_title_label: Label
var _view_container: VBoxContainer
var _select_container: VBoxContainer
var _template_name_label: Label
var _division_type_label: Label
var _engagement_radius_label: Label
var _fill_bars: Array = []     # Array[ProgressBar], 5 elements
var _fill_labels: Array = []   # Array[Label], 5 elements
var _template_list_container: VBoxContainer
var _confirm_btn: Button
var _change_btn: Button
var _locked_notice: Label
```

**`_ready()`:**

```gdscript
func _ready() -> void:
    _cells.resize(25)
    _cells.fill("")
    _build_top_bar()
    _build_body()
```

**Public API:**

```gdscript
func open_for_division(division_id: String) -> void:
    _division_id = division_id
    var data: Dictionary = GameState.get_division(division_id)
    _current_template_id = data.get("template_id", "")
    _preview_template_id = _current_template_id
    var combat_state: String = data.get("combat_state", "idle")
    _is_locked = combat_state in ["engaged", "retreating", "suppressed"]
    _in_select_mode = false
    _div_title_label.text = "DIVISION TEMPLATE   %s" % division_id
    _load_cells_from_template(_current_template_id)
    _refresh_grid()
    _show_view_state()

var _in_select_mode: bool = false
```

**`_build_top_bar()`:** Adds teal accent bar (3px wide ColorRect), `_div_title_label` (expanding), close button `[✕]` that emits `close_requested`.

**`_build_body()`:** Splits `%Body` HBox into two PanelContainers:
- Left: stretch_ratio 0.6 → calls `_build_grid_panel(left)`
- Right: stretch_ratio 0.4 → calls `_build_right_panel(right)`

**`_build_grid_panel(parent)`:** Copy the grid-panel build code from `division_builder_panel.gd`:
- Header row with "TEMPLATE GRID · 5×5" and "front-to-back ↓"
- "══════ FRONT LINE ══════" label
- HBox: left = row label column (VBoxContainer per row with name label + perk hint), right = GridContainer (5 cols)
- 25 `UnitGlyphCell` instances added to GridContainer — do NOT connect any signals
- Store cells in `_cell_nodes`

**`_build_right_panel(parent)`:** Contains a ScrollContainer → MarginContainer → VBox with two children:
1. `_view_container` (visible initially) — see View state below
2. `_select_container` (hidden initially) — see Select state below

**View state (`_view_container`):**
- "CURRENT TEMPLATE" label
- `_template_name_label` (large)
- Row with `_division_type_label` (expand) + `_engagement_radius_label`
- "MOVEMENT PROFILE" header + 5 colored swatches (Plains/Hills/Forest/DnsF/Mtn)
- "FILL & ROLE BALANCE" header + 5 rows of (row name label, ProgressBar 0–5, count label)
- `_locked_notice` (visible only when locked)
- `_change_btn` ("Change Template →", hidden when locked)

**Select state (`_select_container`):**
- Header row: "SELECT TEMPLATE" label + "← Back" button
- ScrollContainer → `_template_list_container` (VBoxContainer)
- HSeparator
- `_confirm_btn` ("Confirm — apply template", disabled initially)

**`_show_view_state()`:** Shows `_view_container`, hides `_select_container`, calls `_refresh_right_view()`.

**`_enter_select_mode()`:** Hides `_view_container`, shows `_select_container`, resets `_confirm_btn.disabled = true`, calls `_rebuild_template_list()`.

**`_exit_select_mode()`:** Reverts grid to `_current_template_id`, calls `_show_view_state()`.

**`_refresh_right_view()`:**
- `_locked_notice.visible = _is_locked`
- `_change_btn.visible = not _is_locked`
- If `_current_template_id == ""`: shows "NO TEMPLATE ASSIGNED", clears bars
- Else: calls `DivisionTemplateStore.get_template(_current_template_id)`, sets name, type (`_derive_division_type(cells)`), radius from `data.get("engagement_radius", 25)` as `"~%d km" % engagement_radius` (use the real server value — do NOT call `_derive_engagement_radius`), fill bars

**`_rebuild_template_list()`:** Clears `_template_list_container`, then for each template from `DivisionTemplateStore.get_templates()`, calls `_make_template_card(template)` and adds to list.

**`_make_template_card(template)`:** Returns a `PanelContainer` with:
- Name row: star icon if current + template name + "[CURRENT]" badge if current
- Sub-label: `_derive_division_type(cells)` · `_derive_engagement_radius(cells)` — local approximations are fine here since these are unconfirmed templates with no server-computed value yet
- `mouse_entered` → preview in left grid (no commit to `_preview_template_id` selection yet)
- `mouse_exited` → revert left grid to `_preview_template_id` (last clicked or current)
- `gui_input` click → set `_preview_template_id = tid`, enable Confirm, update grid

**`_confirm_template()`:**
- Gets template from `DivisionTemplateStore.get_template(_preview_template_id)`
- Maps cells to `Array<{cell_index, unit_type}>`
- Calls `CommandQueue.submit("ASSIGN_TEMPLATE", { division_id, template_id, cells })`
- Emits `close_requested`

**Helpers:**
```gdscript
func _load_cells_from_template(tid: String) -> void:
    _cells.fill("")
    if tid == "": return
    var template: Dictionary = DivisionTemplateStore.get_template(tid)
    var t_cells: Array = template.get("cells", [])
    for i: int in range(min(25, t_cells.size())):
        _cells[i] = t_cells[i]

func _refresh_grid() -> void:
    for i: int in range(25):
        if i < _cell_nodes.size():
            (_cell_nodes[i] as UnitGlyphCell).unit_type = _cells[i]

static func _derive_division_type(cells: Array) -> String:
    var armor := 0; var arty := 0; var total := 0
    for unit_type: String in cells:
        if unit_type == "": continue
        total += 1
        if unit_type in ARMOR_TYPES: armor += 1
        elif unit_type in ARTY_TYPES: arty += 1
    if total == 0: return "Empty"
    if armor >= 3: return "Armoured Assault"
    if armor >= 2 and (total - armor - arty) >= 2: return "Combined-Arms"
    if arty >= 2 and (total - armor - arty) >= 3: return "Supported Infantry"
    if (total - armor - arty) >= 5: return "Infantry Division"
    return "Mixed"

static func _derive_engagement_radius(cells: Array) -> String:
    # Approximation used ONLY for template cards in the select list (no server value available yet).
    # The VIEW state uses the real server value: "~%d km" % int(data.get("engagement_radius", 25))
    var armor := 0
    for unit_type: String in cells:
        if unit_type in ARMOR_TYPES: armor += 1
    if armor >= 3: return "~30 km"
    if armor >= 1: return "~40 km"
    return "~50 km"
```

- [ ] **Step 17: Manual test — viewer**

To test before full wiring, emit from Godot remote inspector or a debug button:
```
EventBus.division_template_viewer_open_requested.emit("some-div-id")
```

Verify all states work per Diagrams 3 and 4.

- [ ] **Step 18: Commit**

```bash
git add client/scenes/game/panels/division_template_viewer_panel.tscn \
        client/src/ui/hud/division_template_viewer_panel.gd
git commit -m "feat: add DivisionTemplateViewerPanel center overlay with view and select states"
```

---

## Task 5: Client — Wire into game_hud.gd + HUDManager

**File:** `client/src/ui/hud/game_hud.gd`

Pattern: identical to how `DivisionBuilderPanel` is registered. Grep for `_DivisionBuilderScene` in `game_hud.gd` to see the exact registration block to copy.

- [ ] **Step 19: Add to game_hud.gd**

**Addition 1:** After `const _DivisionBuilderScene: PackedScene = preload(...)`, add:
```gdscript
const _DivisionTemplateViewerScene: PackedScene = preload("res://scenes/game/panels/division_template_viewer_panel.tscn")
```

**Addition 2:** After `var _division_builder_panel: Control`, add:
```gdscript
var _division_template_viewer_panel: Control
```

**Addition 3:** In `_ready()`, after the DivisionBuilderPanel registration block, add:
```gdscript
_division_template_viewer_panel = _DivisionTemplateViewerScene.instantiate()
add_child(_division_template_viewer_panel)
hud_manager.register_panel(
    "division_template_viewer",
    _division_template_viewer_panel,
    HUDManager.PlacementMode.FULL_CENTER
)
EventBus.division_template_viewer_open_requested.connect(func(div_id: String) -> void:
    (_division_template_viewer_panel as DivisionTemplateViewerPanel).open_for_division(div_id)
    hud_manager.show_panel("division_template_viewer")
)
EventBus.division_template_viewer_closed.connect(func() -> void:
    hud_manager.hide_panel("division_template_viewer")
)
_division_template_viewer_panel.connect("close_requested", func() -> void:
    EventBus.division_template_viewer_closed.emit()
)
```

- [ ] **Step 20: Verify template_id refreshes mini-comp after ASSIGN_TEMPLATE**

The Colyseus schema sync pushes `template_id` changes to the client. Verify:
1. `DivisionState.template_id` has `@type("string")` — Colyseus syncs it automatically ✓
2. The client's Colyseus listener fires `EventBus.division_updated(div_id)` on `template_id` change
3. `friendly_division_panel._on_division_updated(div_id)` calls `_refresh_stats(data)` → `_refresh_comp_grid(data)`

If `division_updated` does NOT fire on `template_id` changes, find where the Colyseus division listener is registered in `game_state.gd` or `net_manager.gd` and ensure `template_id` is one of the watched fields.

- [ ] **Step 21: End-to-end manual test**

Full flow:
1. Launch game, start session, select a division
2. Mini-comp grid shows all dark (no template)
3. Click mini-comp → DivisionTemplateViewerPanel opens
4. Right shows "NO TEMPLATE ASSIGNED"
5. Click [Change Template →] → template list shown on right
6. Hover "3rd Mechanized" → left grid previews its cells
7. Click "1st Infantry Div" → Confirm shows template name
8. Click Confirm → panel closes, server receives ASSIGN_TEMPLATE
9. Server sets `template_id`, `division_updated` fires, mini-comp grid updates with olive cells
10. Re-open viewer → shows "1st Infantry Div" as current template
11. Test locked: move division into combat → open viewer → [Change Template →] hidden, locked notice shown

- [ ] **Step 22: Commit**

```bash
git add client/src/ui/hud/game_hud.gd
git commit -m "feat: register DivisionTemplateViewerPanel with HUDManager and wire EventBus signals"
```

---

## Verification Checklist

- [ ] Server: 5 ASSIGN_TEMPLATE tests pass, full suite no regressions
- [ ] Mini-comp: visible in bottom panel when division selected
- [ ] Mini-comp: correct colors (olive infantry / blue armor / red arty / teal recon / dark empty)
- [ ] Mini-comp: all dark when `template_id = ""`
- [ ] Clicking mini-comp opens DivisionTemplateViewerPanel
- [ ] Viewer view state: "NO TEMPLATE ASSIGNED" when no template
- [ ] Viewer view state: shows name, type, radius, fill bars when template assigned
- [ ] [Change Template →] hidden + locked notice shown when division is engaged/retreating/suppressed
- [ ] Viewer select state: hover card previews cells in left grid
- [ ] Viewer select state: click card enables Confirm with template name
- [ ] [← Back] reverts grid + returns to view state
- [ ] [Confirm] sends ASSIGN_TEMPLATE, panel closes
- [ ] After Confirm: mini-comp grid updates to new template colors
- [ ] After Confirm: re-opening viewer shows new template as current
- [ ] No GDScript errors in Godot output
