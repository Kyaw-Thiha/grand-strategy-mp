# Plan: Phase 6 G-Builder — Division Builder Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Division Builder full-center overlay accessible from the military panel's Land tab; replace the active-division list with a template list showing 3 hardcoded presets (all nations share them for now; Phase 8 swaps in user-persisted server templates).

**Architecture:** `DivisionTemplateStore` (new autoload) owns template data in memory. `MilitaryPanel` land tab is reworked to show template cards + [+] and [Edit] buttons (old division-list code commented out, NOT deleted). `DivisionBuilderPanel` registers with `HUDManager` as `FULL_CENTER` (same pattern as `ResearchTreePanel`). The left 60% builds a 5×5 grid of `UnitGlyphCell` nodes programmatically; the right 40% switches between Overview and Cell-Selected states. Unit glyphs are drawn via `_draw()` using NATO-style geometric symbols — no art assets required.

**Tech Stack:** GDScript 4, Godot 4, `hud_dark.tres` theme, existing HUDManager/EventBus autoloads.

## Global Constraints

- All GDScript: `class_name`, `@onready`, fully typed variables (`var x: String = ""`)
- Theme on all PanelContainers: `load("res://assets/themes/hud_dark.tres")`
- Military panel border color (blue): `Color(0.18, 0.44, 0.84, 1.0)`
- Division builder accent/border color (teal): `Color(0.18, 0.62, 0.56, 1.0)`
- Register builder with HUDManager as `"division_builder"`, `PlacementMode.FULL_CENTER`
- Old division-list code in `military_panel.gd` must be **commented out** with `# DISABLED: restore when active-division list is re-enabled`
- Cell index in builder: `visual_row * 5 + col`, visual_row 0 = VANGUARD (front/top), visual_row 4 = REAR (bottom)
- Preset template IDs must start with `"preset_"` so Phase 8 can distinguish them from user-created templates

---

## ASCII Reference Diagrams

The execution agent MUST refer to these diagrams for all UI decisions. The referenced images are not available — use these exclusively.

### Diagram 1 — Military Panel Land Tab: Before vs After

```
BEFORE (current):                    AFTER (new):
┌─────────────────────────┐          ┌─────────────────────────┐
│ MILITARY            [X] │          │ MILITARY            [X] │
├─────────────────────────┤          ├─────────────────────────┤
│ [LAND]  [AIR]  [NAVAL]  │          │ [LAND]  [AIR]  [NAVAL]  │
├─────────────────────────┤          ├─────────────────────────┤
│ LAND UNITS              │          │ DIVISION TEMPLATES  [+] │
│ Stack (2)               │          ├─────────────────────────┤
│ ┌───────────────────┐   │          │ ┌─────────────────────┐ │
│ │ div_001 [Infantry]│   │          │ │ 3rd Mechanized      │ │
│ │ HP: 100%          │   │          │ │ Combined-Arms       │ │
│ └───────────────────┘   │          │ │             [Edit]  │ │
│ ┌───────────────────┐   │          │ └─────────────────────┘ │
│ │ div_002 [Armor]   │   │          │ ┌─────────────────────┐ │
│ │ HP: 85%           │   │          │ │ 1st Infantry Div    │ │
│ └───────────────────┘   │          │ │ Infantry Division   │ │
└─────────────────────────┘          │ │             [Edit]  │ │
                                     │ └─────────────────────┘ │
                                     │ ┌─────────────────────┐ │
                                     │ │ Armoured Spearhead  │ │
                                     │ │ Armoured Assault    │ │
                                     │ │             [Edit]  │ │
                                     │ └─────────────────────┘ │
                                     └─────────────────────────┘

[+] → opens builder with blank template
[Edit] → opens builder pre-loaded with that template
```

### Diagram 2 — Division Builder: Overview State (no cell selected)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌ DIVISION BUILDER   Template: 3rd Mechanized                                           [X] │
├───────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ TEMPLATE GRID · 5×5            front-to-back↓ │ DIVISION OVERVIEW                            │
│                                               │                                              │
│         ══════ FRONT LINE ══════              │ [AUTO-DERIVED]  computed from composition    │
│                                               │                                              │
│ VANGUARD ┌─────┐ ┌╌╌╌╌╌┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │ DIVISION TYPE        ENGAGEMENT RADIUS    │
│          │ [/] │ ╎  +  ╎ │ [/] │ ╎  +  ╎ ╎  +  ╎ │ Combined-Arms         ~40 km              │
│          │ RCN │ ╎     ╎ │ RCN │ ╎     ╎ ╎     ╎ │ Assault                                   │
│          └─────┘ └╌╌╌╌╌┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │                                           │
│ ASSAULT  ┌─────┐ ┌─────┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │ MOVEMENT PROFILE                          │
│          │ [○] │ │ [○] │ │ [╳] │ ╎  +  ╎ ╎  +  ╎ │ [░░] [▒▒] [▓▓] [▨▨]                       │
│          │ MTK │ │ MTK │ │ INF │ ╎     ╎ ╎     ╎ │ Fast  Nrml  Slow  Impas.                   │
│          └─────┘ └─────┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │ Plains Hills DnsF  Mtn                    │
│ SUPPORT  ┌─────┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                           │
│          │ [•] │ │ [/] │ ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ │ FILL & ROLE BALANCE     7 / 25 cells      │
│          │ ART │ │ ATG │ ╎     ╎ ╎     ╎ ╎     ╎ │ VANGUARD  ██░░░░░░░░░  2/5               │
│          └─────┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │ ASSAULT   ███░░░░░░░░  3/5               │
│ RESERVE  ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │ SUPPORT   ██░░░░░░░░░  2/5               │
│          │ [╳] │ ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ │ RESERVE   █░░░░░░░░░░  1/5               │
│          │ INF │ ╎     ╎ ╎     ╎ ╎     ╎ ╎     ╎ │ REAR      ░░░░░░░░░░░  0/5               │
│          └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │                                           │
│ REAR     ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │                                           │
│          ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ ╎  +  ╎ │                                           │
│          └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │                                           │
└───────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

### Diagram 3 — Division Builder: Cell Selected State (right panel changes)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▌ DIVISION BUILDER   Template: 3rd Mechanized    [← Overview (deselect)]               [X] │
├───────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ (grid same as above; selected cell has═══════ │ [VANGUARD]  Cell R1C1 · holds RCN            │
│  teal/cyan double-line border ═══════════════)│   hover = preview        click = place       │
│                                               │                                              │
│ VANGUARD ╔═════╗ ┌╌╌╌╌╌┐ ┌─────┐ ┌╌╌╌╌╌┐ ┌╌╌╌╌╌┐ │ ELIGIBLE UNITS · VANGUARD ROW             │
│          ║ [/] ║ ╎  +  ╎ │ [/] │ ╎  +  ╎ ╎  +  ╎ │ ┌──────────────────────────────────────┐  │
│          ║ RCN ║ ╎     ╎ │ RCN │ ╎     ╎ ╎     ╎ │ │ [/] Recon Infantry  RCN  [IN CELL](i)│  │
│          ╚═════╝ └╌╌╌╌╌┘ └─────┘ └╌╌╌╌╌┘ └╌╌╌╌╌┘ │ │      Scouts ahead, widens radius     │  │
│                                               │ └──────────────────────────────────────┘  │
│                                               │ ┌──────────────────────────────────────┐  │
│                                               │ │ [╳] Commando          CMD          (i)│  │
│                                               │ │      Specialist inf, high stealth     │  │
│                                               │ └──────────────────────────────────────┘  │
│                                               │ ┌──────────────────────────────────────┐  │
│                                               │ │ [○] Armoured Car      APC          (i)│  │
│                                               │ │      Fast scouting, anti-stealth      │  │
│                                               │ └──────────────────────────────────────┘  │
│                                               │ ──────────────────────────────────────    │
│                                               │ DETAIL  [IN THIS CELL · placed]            │
│                                               │          [/]  Recon Infantry  RCN          │
└───────────────────────────────────────────────┴──────────────────────────────────────────────┘

Row badge colors: VANGUARD=red, ASSAULT=orange, SUPPORT=yellow, RESERVE=green, REAR=blue
[← Overview (deselect)] appears in top bar ONLY when a cell is selected
Clicking a unit card in the list places it in the selected cell (replaces whatever was there)
Clicking a unit card that is already [IN CELL] removes it (clears the cell)
Right-clicking a filled cell on the grid also clears it
```

### Diagram 4 — UnitGlyphCell visual states

```
Empty:           Filled INF:      Filled ARM:      Selected:        Hovered:
┌╌╌╌╌╌╌╌╌╌┐     ┌─────────┐      ┌─────────┐      ╔═════════╗      ┌╌╌╌╌╌╌╌╌╌┐
╎         ╎     │  ╲   ╱  │      │         │      ║  ╲   ╱  ║      ╎ (lighter╎
╎    +    ╎     │   ╲ ╱   │      │   (○)   │      ║   ╲ ╱   ║      ╎   bg)   ╎
╎         ╎     │   ╱ ╲   │      │         │      ║   ╱ ╲   ║      ╎    +    ╎
╎         ╎     │  ╱   ╲  │      │         │      ║         ║      ╎         ╎
└╌╌╌╌╌╌╌╌╌┘     │   INF   │      │   MTK   │      ║   RCN   ║      └╌╌╌╌╌╌╌╌╌┘
dashed border   └─────────┘      └─────────┘      ╚═════════╝
                olive green      steel blue        teal border

Glyph symbols:
  [╳] cross  = infantry, assault_infantry, mg, commando, flamethrower, at_infantry, sniper
  [○] oval   = light_tank, medium_tank, heavy_tank, armoured_car, at_gun_sp, self_propelled_gun
  [•] dot    = artillery, howitzer
  [/] slash  = recon_infantry, cavalry, at_gun, force_recon_sniper, aa_gun

Glyph colors:
  olive  #6B7D2E = infantry class (cross)
  blue   #4A6FA5 = armor class (oval)
  red    #8B2020 = artillery class (dot)
  teal   #1A8C80 = recon class (slash — recon_infantry, force_recon_sniper)
  tan    #8B6618 = cavalry (slash)
  brown  #8B5A14 = at_gun (slash)
  purple #4D4D99 = aa_gun (slash)
```

---

## Files Overview

**Create:**
- `client/src/core/division_template_store.gd` — autoload, owns template data
- `client/tests/test_division_template_store.gd` — unit tests for store
- `client/src/ui/hud/unit_glyph_cell.gd` — reusable cell drawing widget
- `client/scenes/game/panels/unit_glyph_cell.tscn` — minimal scene for the cell
- `client/src/ui/hud/division_builder_panel.gd` — full builder panel logic
- `client/scenes/game/panels/division_builder_panel.tscn` — panel shell scene

**Modify:**
- `client/project.godot` — register `DivisionTemplateStore` autoload
- `client/src/core/event_bus.gd` — add 2 signals
- `client/src/ui/hud/military_panel.gd` — disable division list, add template list
- `client/src/ui/hud/game_hud.gd` — preload + register DivisionBuilderPanel

---

## Task 1: DivisionTemplateStore autoload + tests

**Files:**
- Create: `client/src/core/division_template_store.gd`
- Create: `client/tests/test_division_template_store.gd`
- Modify: `client/project.godot`

- [ ] **Step 1: Write the test file first (all tests will fail — RED)**

Create `client/tests/test_division_template_store.gd`:

```gdscript
extends Node

func _ready() -> void:
	test_preset_templates_exist()
	test_get_template_by_id()
	test_save_new_template()
	test_save_updates_existing()
	test_delete_template()
	print("=== test_division_template_store: all passed ===")
	get_tree().quit(0)

func test_preset_templates_exist() -> void:
	var templates: Array = DivisionTemplateStore.get_templates()
	assert(templates.size() == 3,
		"FAIL: expected 3 preset templates, got %d" % templates.size())
	var t: Dictionary = templates[0]
	assert(t.has("id"),    "FAIL: template missing 'id'")
	assert(t.has("name"),  "FAIL: template missing 'name'")
	assert(t.has("cells"), "FAIL: template missing 'cells'")
	assert((t["cells"] as Array).size() == 25,
		"FAIL: cells must have 25 entries, got %d" % (t["cells"] as Array).size())
	print("PASS test_preset_templates_exist")

func test_get_template_by_id() -> void:
	var t: Dictionary = DivisionTemplateStore.get_template("preset_combined_arms")
	assert(not t.is_empty(), "FAIL: preset_combined_arms not found")
	assert(t["name"] == "3rd Mechanized", "FAIL: wrong name '%s'" % t["name"])
	var cells: Array = t["cells"]
	assert(cells[0] == "recon_infantry",  "FAIL: cell[0] should be recon_infantry")
	assert(cells[2] == "recon_infantry",  "FAIL: cell[2] should be recon_infantry")
	assert(cells[5] == "medium_tank",     "FAIL: cell[5] should be medium_tank")
	assert(cells[6] == "medium_tank",     "FAIL: cell[6] should be medium_tank")
	assert(cells[7] == "infantry",        "FAIL: cell[7] should be infantry")
	assert(cells[10] == "artillery",      "FAIL: cell[10] should be artillery")
	assert(cells[11] == "at_gun",         "FAIL: cell[11] should be at_gun")
	print("PASS test_get_template_by_id")

func test_save_new_template() -> void:
	var initial_count: int = DivisionTemplateStore.get_templates().size()
	var cells: Array = []
	cells.resize(25)
	cells.fill("")
	cells[0] = "infantry"
	DivisionTemplateStore.save_template({"id": "test_new_001", "name": "Test", "cells": cells})
	assert(DivisionTemplateStore.get_templates().size() == initial_count + 1,
		"FAIL: save_template should add 1 template")
	var found: Dictionary = DivisionTemplateStore.get_template("test_new_001")
	assert(not found.is_empty(), "FAIL: saved template not retrievable by id")
	assert((found["cells"] as Array)[0] == "infantry", "FAIL: saved cell data wrong")
	print("PASS test_save_new_template")

func test_save_updates_existing() -> void:
	var cells: Array = []
	cells.resize(25)
	cells.fill("")
	cells[0] = "cavalry"
	DivisionTemplateStore.save_template({"id": "test_new_001", "name": "Updated", "cells": cells})
	var found: Dictionary = DivisionTemplateStore.get_template("test_new_001")
	assert(found["name"] == "Updated", "FAIL: save should update existing name")
	assert((found["cells"] as Array)[0] == "cavalry", "FAIL: save should update existing cells")
	# Should not add a duplicate
	var count: int = 0
	for t: Dictionary in DivisionTemplateStore.get_templates():
		if t.get("id", "") == "test_new_001":
			count += 1
	assert(count == 1, "FAIL: save_template should not duplicate, got %d copies" % count)
	print("PASS test_save_updates_existing")

func test_delete_template() -> void:
	var cells: Array = []
	cells.resize(25)
	cells.fill("")
	DivisionTemplateStore.save_template({"id": "test_del_001", "name": "Del", "cells": cells})
	var count_before: int = DivisionTemplateStore.get_templates().size()
	DivisionTemplateStore.delete_template("test_del_001")
	assert(DivisionTemplateStore.get_templates().size() == count_before - 1,
		"FAIL: delete_template should remove 1 template")
	assert(DivisionTemplateStore.get_template("test_del_001").is_empty(),
		"FAIL: deleted template still retrievable")
	print("PASS test_delete_template")
```

- [ ] **Step 2: Run the test — expect RED (DivisionTemplateStore not found)**

Open Godot. Run the scene `client/tests/test_division_template_store.gd` as a scene (create a minimal test runner scene that instances this script, or run via `--headless` CLI). Expected: crash with "Identifier 'DivisionTemplateStore' not declared".

Alternatively run headless:
```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/client
godot --headless --path . --script tests/test_division_template_store.gd 2>&1 | tail -20
```
Expected: error about DivisionTemplateStore.

- [ ] **Step 3: Create `client/src/core/division_template_store.gd`**

```gdscript
extends Node
## In-memory division template store.
## Hardcoded presets for Phase 6. Phase 8 swaps _load_presets() for a server fetch.
## Template dict shape: { "id": String, "name": String, "cells": Array[String] }
## cells has 25 elements; index = visual_row * 5 + col; visual_row 0 = VANGUARD (top/front).
## Empty cell = "". Preset ids start with "preset_" so Phase 8 can identify them.

signal templates_changed()

var _templates: Array = []


func _ready() -> void:
	_load_presets()


func _load_presets() -> void:
	_templates = [
		_make_preset_combined_arms(),
		_make_preset_infantry(),
		_make_preset_armoured(),
	]


## Returns a shallow copy of all templates.
func get_templates() -> Array:
	return _templates.duplicate()


## Returns a deep copy of one template by id, or {} if not found.
func get_template(id: String) -> Dictionary:
	for t: Dictionary in _templates:
		if t.get("id", "") == id:
			return t.duplicate(true)
	return {}


## Saves a template. If a template with the same id exists, it is replaced.
## Emits templates_changed.
func save_template(template: Dictionary) -> void:
	for i: int in range(_templates.size()):
		if _templates[i].get("id", "") == template.get("id", ""):
			_templates[i] = template.duplicate(true)
			templates_changed.emit()
			return
	_templates.append(template.duplicate(true))
	templates_changed.emit()


## Deletes template by id. No-op if not found. Emits templates_changed.
func delete_template(id: String) -> void:
	for i: int in range(_templates.size()):
		if _templates[i].get("id", "") == id:
			_templates.remove_at(i)
			templates_changed.emit()
			return


# ── Preset factories ──────────────────────────────────────────────────────

func _make_cells(filled: Dictionary) -> Array:
	var cells: Array = []
	cells.resize(25)
	cells.fill("")
	for idx: int in filled:
		cells[idx] = filled[idx]
	return cells


func _make_preset_combined_arms() -> Dictionary:
	return {
		"id":   "preset_combined_arms",
		"name": "3rd Mechanized",
		"cells": _make_cells({
			# visual_row 0 = VANGUARD (front)
			0: "recon_infantry", 2: "recon_infantry",
			# visual_row 1 = ASSAULT
			5: "medium_tank", 6: "medium_tank", 7: "infantry",
			# visual_row 2 = SUPPORT
			10: "artillery", 11: "at_gun",
			# visual_row 3 = RESERVE
			15: "infantry",
			# visual_row 4 = REAR — empty
		}),
	}


func _make_preset_infantry() -> Dictionary:
	return {
		"id":   "preset_infantry",
		"name": "1st Infantry Div",
		"cells": _make_cells({
			0: "recon_infantry", 1: "infantry",
			5: "assault_infantry", 6: "assault_infantry", 7: "infantry",
			10: "mg", 11: "artillery", 12: "at_gun",
			15: "infantry", 16: "infantry",
			20: "infantry",
		}),
	}


func _make_preset_armoured() -> Dictionary:
	return {
		"id":   "preset_armoured",
		"name": "Armoured Spearhead",
		"cells": _make_cells({
			0: "armoured_car", 1: "armoured_car",
			5: "heavy_tank", 6: "heavy_tank", 7: "medium_tank", 8: "medium_tank",
			10: "at_gun_sp", 11: "at_gun_sp",
			15: "infantry",
		}),
	}
```

- [ ] **Step 4: Register as autoload in `client/project.godot`**

Open `client/project.godot`. Find the `[autoload]` section (currently ends with `KeybindManager`). Add one line immediately after the last autoload entry:

```ini
DivisionTemplateStore="*res://src/core/division_template_store.gd"
```

The section should now look like:
```ini
[autoload]

Config="*res://src/core/config.gd"
...
KeybindManager="*res://src/core/keybind_manager.gd"
DivisionTemplateStore="*res://src/core/division_template_store.gd"
```

- [ ] **Step 5: Run test — expect GREEN**

```bash
cd /home/kevin/Documents/Projects/grand-strategy-mp/client
godot --headless --path . --script tests/test_division_template_store.gd 2>&1 | tail -20
```

Expected output contains:
```
PASS test_preset_templates_exist
PASS test_get_template_by_id
PASS test_save_new_template
PASS test_save_updates_existing
PASS test_delete_template
=== test_division_template_store: all passed ===
```

- [ ] **Step 6: Commit**

```bash
git add client/src/core/division_template_store.gd client/tests/test_division_template_store.gd client/project.godot
git commit -m "feat: add DivisionTemplateStore autoload with 3 hardcoded presets"
```

---

## Task 2: EventBus signals

**Files:**
- Modify: `client/src/core/event_bus.gd`

- [ ] **Step 7: Add two signals to EventBus**

Open `client/src/core/event_bus.gd`. After the last existing signal (currently `signal notification_cycle_next()` — **not** `move_mode_cancelled`, which is earlier in the file), append:

```gdscript
# ── Division Builder ───────────────────────────────────────────────────────
signal division_builder_open_requested(template_id: String)  # "" = new blank template
signal division_builder_closed()
```

- [ ] **Step 8: Commit**

```bash
git add client/src/core/event_bus.gd
git commit -m "feat: add division_builder EventBus signals"
```

---

## Task 3: Update military_panel.gd land tab

**Files:**
- Modify: `client/src/ui/hud/military_panel.gd`

The land tab currently renders active divisions. Disable that and render templates instead. The [+] button and "DIVISION TEMPLATES" header title are injected into the existing `Land/Header/HBox` node from GDScript so the .tscn does not need to be touched.

- [ ] **Step 9: Replace `military_panel.gd` entirely**

```gdscript
extends PanelContainer
## Military panel — side-docked, with Land/Air/Naval sub-tabs.
## Land tab lists division templates from DivisionTemplateStore.
## Air and Naval tabs are placeholders for Phase 12/13.
##
## NOTE: The original active-division list code is DISABLED below.
## Search for "DISABLED" to find it. Re-enable when the active-division list is restored.

signal close_requested()
# DISABLED: restore alongside the active-division list
# signal division_clicked(division_id: String)

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"

@onready var _close_button: Button = %CloseButton


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	_inject_land_header()
	_refresh_template_list()
	DivisionTemplateStore.templates_changed.connect(func() -> void: _refresh_template_list())

	# DISABLED: re-enable when active-division list is restored
	# EventBus.division_added.connect(func(_id: String) -> void: _refresh_land_list())
	# EventBus.division_updated.connect(func(_id: String) -> void: _refresh_land_list())
	# EventBus.division_removed.connect(func(_id: String) -> void: _refresh_land_list())


func _setup_tab_buttons() -> void:
	var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tc == null or tab_btns == null:
		return
	var btn_group := ButtonGroup.new()
	for i: int in range(tab_btns.get_child_count()):
		var btn: Button = tab_btns.get_child(i) as Button
		btn.button_group = btn_group
		btn.pressed.connect(_on_tab_button_pressed.bind(i))
	tc.tab_changed.connect(_sync_tab_button)


func _on_tab_button_pressed(idx: int) -> void:
	var tc: TabContainer = get_node_or_null(_CONTENT_PATH + "/TabBar") as TabContainer
	if tc != null:
		tc.current_tab = idx


func _sync_tab_button(idx: int) -> void:
	var tab_btns: HBoxContainer = get_node_or_null(_CONTENT_PATH + "/TabButtons") as HBoxContainer
	if tab_btns == null or idx >= tab_btns.get_child_count():
		return
	(tab_btns.get_child(idx) as Button).button_pressed = true


func cycle_sub_tab(forward: bool) -> void:
	var tabs_node: Node = get_node_or_null(_CONTENT_PATH + "/TabBar")
	if tabs_node == null or not tabs_node is TabContainer:
		return
	var tabs: TabContainer = tabs_node as TabContainer
	var count: int = tabs.get_tab_count()
	if count <= 1:
		return
	tabs.current_tab = posmod(tabs.current_tab + (1 if forward else -1), count)


# ── Land header injection ─────────────────────────────────────────────────

func _inject_land_header() -> void:
	var title_lbl: Label = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Header/HBox/Title") as Label
	if title_lbl != null:
		title_lbl.text = "DIVISION TEMPLATES"

	var hbox: HBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Header/HBox") as HBoxContainer
	if hbox == null:
		return
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(spacer)
	var add_btn := Button.new()
	add_btn.text = "+"
	add_btn.custom_minimum_size = Vector2(28, 28)
	add_btn.tooltip_text = "Add new division template"
	add_btn.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit("")
	)
	hbox.add_child(add_btn)


# ── Template list ─────────────────────────────────────────────────────────

func _refresh_template_list() -> void:
	var list_container: VBoxContainer = get_node_or_null(
		_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer") as VBoxContainer
	if list_container == null:
		return
	for child: Node in list_container.get_children():
		list_container.remove_child(child)
		child.queue_free()

	for template: Dictionary in DivisionTemplateStore.get_templates():
		var item: Control = _make_template_item(template)
		list_container.add_child(item)


func _make_template_item(template: Dictionary) -> Control:
	var template_id: String = template.get("id", "")
	var name_str: String   = template.get("name", "Unknown")
	var cells: Array       = template.get("cells", [])

	var container := PanelContainer.new()
	container.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 2)
	container.add_child(vbox)

	var name_lbl := Label.new()
	name_lbl.text = name_str
	name_lbl.add_theme_font_size_override("font_size", 13)
	vbox.add_child(name_lbl)

	var type_lbl := Label.new()
	type_lbl.text = _derive_division_type(cells)
	type_lbl.add_theme_font_size_override("font_size", 11)
	type_lbl.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	vbox.add_child(type_lbl)

	var edit_row := HBoxContainer.new()
	var edit_spacer := Control.new()
	edit_spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	edit_row.add_child(edit_spacer)
	var edit_btn := Button.new()
	edit_btn.text = "Edit"
	edit_btn.custom_minimum_size = Vector2(48, 24)
	edit_btn.pressed.connect(func() -> void:
		EventBus.division_builder_open_requested.emit(template_id)
	)
	edit_row.add_child(edit_btn)
	vbox.add_child(edit_row)

	return container


static func _derive_division_type(cells: Array) -> String:
	const ARMOR_TYPES := ["light_tank", "medium_tank", "heavy_tank",
		"armoured_car", "at_gun_sp", "self_propelled_gun"]
	const ARTY_TYPES  := ["artillery", "howitzer", "at_gun", "aa_gun"]
	var armor := 0
	var arty  := 0
	var inf   := 0
	var total := 0
	for unit_type: String in cells:
		if unit_type == "":
			continue
		total += 1
		if unit_type in ARMOR_TYPES:
			armor += 1
		elif unit_type in ARTY_TYPES:
			arty += 1
		else:
			inf += 1
	if total == 0:
		return "Empty"
	if armor >= 3:
		return "Armoured Assault"
	if armor >= 2 and inf >= 2:
		return "Combined-Arms"
	if arty >= 2 and inf >= 3:
		return "Supported Infantry"
	if inf >= 5:
		return "Infantry Division"
	return "Mixed"


# ── DISABLED: original active-division list ───────────────────────────────
# Re-enable this block and remove template list above when restoring
# the active-division list feature.
#
# var _division_items: Array[Dictionary] = []
#
# func _refresh_land_list() -> void:
# 	var list_container: VBoxContainer = get_node_or_null(
# 		_CONTENT_PATH + "/TabBar/Land/Scroll/ListContainer")
# 	if list_container == null:
# 		return
# 	for child: Node in list_container.get_children():
# 		list_container.remove_child(child)
# 		child.queue_free()
# 	var div_ids: Array = GameState.get_my_nation_divisions()
# 	var stacks_map: Dictionary = {}
# 	var solo: Array = []
# 	for div_id: String in div_ids:
# 		var div_data: Dictionary = GameState.get_division(div_id)
# 		if div_data.is_empty():
# 			continue
# 		if div_data.get("combat_state", "") == "destroyed":
# 			continue
# 		var sid: String = div_data.get("stack_id", "")
# 		if sid.is_empty():
# 			solo.append({ "id": div_id, "data": div_data })
# 		else:
# 			if not stacks_map.has(sid):
# 				stacks_map[sid] = []
# 			stacks_map[sid].append({ "id": div_id, "data": div_data })
# 	for sid: String in stacks_map:
# 		var members: Array = stacks_map[sid]
# 		members.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
# 			return int(a.data.get("stack_position", 0)) < int(b.data.get("stack_position", 0))
# 		)
# 		var group_lbl: Label = Label.new()
# 		group_lbl.text = "Stack (%d)" % members.size()
# 		group_lbl.add_theme_color_override("font_color", Color(0.85, 0.7, 0.2, 1))
# 		group_lbl.add_theme_font_size_override("font_size", 11)
# 		list_container.add_child(group_lbl)
# 		for member: Dictionary in members:
# 			var item: Button = _make_division_item(member.id, member.data)
# 			list_container.add_child(item)
# 	for entry: Dictionary in solo:
# 		var item: Button = _make_division_item(entry.id, entry.data)
# 		list_container.add_child(item)
#
# func _make_division_item(div_id: String, div_data: Dictionary) -> Button:
# 	var btn: Button = Button.new()
# 	btn.custom_minimum_size.y = 48
# 	btn.layout_mode = 2
# 	btn.size_flags_horizontal = 3
# 	btn.size_flags_vertical = 3
# 	var div_type: String = div_data.get("division_type", "infantry")
# 	var hp: float = float(div_data.get("hp", 100.0))
# 	var max_hp: float = float(div_data.get("max_hp", 100.0))
# 	var hp_pct: float = hp / max_hp if max_hp > 0 else 1.0
# 	var label_text: String = "%s [%s]\nHP: %.0f%%" % [div_id, div_type.capitalize(), hp_pct * 100.0]
# 	var lbl: Label = Label.new()
# 	lbl.text = label_text
# 	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
# 	lbl.layout_mode = 2
# 	lbl.size_flags_vertical = 3
# 	btn.add_child(lbl)
# 	btn.pressed.connect(func() -> void:
# 		division_clicked.emit(div_id)
# 		EventBus.division_selected.emit(div_id)
# 	)
# 	return btn
```

- [ ] **Step 10: Manual test — open military panel**

Launch the game. Press `R` to open the Military panel. Verify:
- Land tab shows "DIVISION TEMPLATES" header with [+] button
- Three template cards are listed: "3rd Mechanized", "1st Infantry Div", "Armoured Spearhead"
- Each card shows the division type below the name
- Each card has an [Edit] button
- [+] button and [Edit] buttons don't crash (they emit EventBus signals which aren't connected yet)

- [ ] **Step 11: Commit**

```bash
git add client/src/ui/hud/military_panel.gd
git commit -m "feat: replace division list with template list in military panel land tab"
```

---

## Task 4: UnitGlyphCell component

**Files:**
- Create: `client/src/ui/hud/unit_glyph_cell.gd`
- Create: `client/scenes/game/panels/unit_glyph_cell.tscn`

This is a reusable `Control` that draws a NATO-style military unit symbol via `_draw()`. No art assets. See Diagram 4 for the visual spec.

- [ ] **Step 12: Create `client/src/ui/hud/unit_glyph_cell.gd`**

```gdscript
class_name UnitGlyphCell
extends Control
## Draws a NATO-style unit symbol for one 5×5 grid cell.
## Emits cell_clicked when left-clicked, cell_right_clicked when right-clicked.
## Set unit_type = "" for an empty cell (dashed border + plus sign).
## Set is_selected = true for teal highlight border.

signal cell_clicked(cell: UnitGlyphCell)
signal cell_right_clicked(cell: UnitGlyphCell)

const CELL_SIZE    := 72.0
const BORDER_TEAL  := Color(0.2,  0.7,  0.7,  1.0)
const BORDER_FILLED:= Color(0.5,  0.4,  0.3,  0.9)
const BORDER_HOVER := Color(0.7,  0.65, 0.5,  1.0)
const BORDER_EMPTY := Color(0.5,  0.4,  0.3,  0.5)
const BG_FILLED    := Color(0.12, 0.09, 0.06, 0.9)

const UNIT_ABBREV: Dictionary = {
	"infantry": "INF",         "assault_infantry": "ASI",  "recon_infantry": "RCN",
	"mg": "MG",                "cavalry": "CAV",           "light_tank": "LTK",
	"medium_tank": "MTK",      "heavy_tank": "HTK",        "armoured_car": "APC",
	"at_infantry": "ATI",      "at_gun": "ATG",            "at_gun_sp": "SPA",
	"aa_gun": "AA",            "sniper": "SNP",            "flamethrower": "FLM",
	"artillery": "ART",        "commando": "CMD",
	"force_recon_sniper": "FRS","howitzer": "HOW",          "self_propelled_gun": "SPG",
}

# Glyph type lookup (determines draw shape)
const _CROSS_TYPES := ["infantry", "assault_infantry", "mg", "commando",
	"flamethrower", "at_infantry", "sniper"]
const _OVAL_TYPES  := ["light_tank", "medium_tank", "heavy_tank",
	"armoured_car", "at_gun_sp", "self_propelled_gun"]
const _DOT_TYPES   := ["artillery", "howitzer"]
# Everything else (recon_infantry, cavalry, at_gun, force_recon_sniper, aa_gun) → slash

# Glyph colors
const _COLOR_INF   := Color(0.42, 0.49, 0.18, 1.0)  # olive green
const _COLOR_ARM   := Color(0.29, 0.43, 0.65, 1.0)  # steel blue
const _COLOR_ART   := Color(0.55, 0.13, 0.13, 1.0)  # dark red
const _COLOR_RCN   := Color(0.10, 0.55, 0.50, 1.0)  # teal
const _COLOR_CAV   := Color(0.55, 0.40, 0.10, 1.0)  # tan
const _COLOR_ATG   := Color(0.55, 0.35, 0.10, 1.0)  # brown-orange
const _COLOR_AA    := Color(0.30, 0.30, 0.60, 1.0)  # purple-blue

var unit_type: String = "":
	set(v):
		unit_type = v
		queue_redraw()

var is_selected: bool = false:
	set(v):
		is_selected = v
		queue_redraw()

var _hovered: bool = false


func _ready() -> void:
	custom_minimum_size = Vector2(CELL_SIZE, CELL_SIZE)
	mouse_filter = MOUSE_FILTER_STOP
	mouse_entered.connect(func() -> void:
		_hovered = true
		queue_redraw()
	)
	mouse_exited.connect(func() -> void:
		_hovered = false
		queue_redraw()
	)


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return
	if mb.button_index == MOUSE_BUTTON_LEFT:
		cell_clicked.emit(self)
		accept_event()
	elif mb.button_index == MOUSE_BUTTON_RIGHT:
		cell_right_clicked.emit(self)
		accept_event()


func _draw() -> void:
	var pad   := 4.0
	var inner := Rect2(Vector2(pad, pad), size - Vector2(pad * 2.0, pad * 2.0))

	if unit_type == "":
		_draw_empty_cell(inner)
	else:
		_draw_filled_cell(inner)


func _draw_empty_cell(inner: Rect2) -> void:
	var border_color: Color = BORDER_EMPTY
	if _hovered:
		border_color = Color(0.6, 0.5, 0.4, 0.65)
		draw_rect(inner, Color(0.15, 0.12, 0.08, 0.3))
	_draw_dashed_rect(inner, border_color, 1.5, 7.0, 5.0)
	var center := inner.get_center()
	var lc := Color(0.5, 0.45, 0.35, 0.55)
	draw_line(center + Vector2(-6, 0), center + Vector2(6, 0), lc, 1.5)
	draw_line(center + Vector2(0, -6), center + Vector2(0, 6), lc, 1.5)


func _draw_filled_cell(inner: Rect2) -> void:
	draw_rect(inner, BG_FILLED)
	var border: Color
	if is_selected:
		border = BORDER_TEAL
	elif _hovered:
		border = BORDER_HOVER
	else:
		border = BORDER_FILLED
	draw_rect(inner, border, false, 2.0 if is_selected else 1.5)

	# Glyph area: leave 8px pad + 14px at bottom for abbreviation
	var glyph_rect := Rect2(
		inner.position + Vector2(8, 6),
		Vector2(inner.size.x - 16, inner.size.y - 26)
	)
	_draw_glyph(glyph_rect, unit_type)

	# Abbreviation at bottom of cell
	var abbrev: String = UNIT_ABBREV.get(unit_type, "???")
	var font := get_theme_default_font()
	var abbrev_x := inner.position.x + inner.size.x * 0.5
	var abbrev_y := inner.end.y - 4.0
	draw_string(font, Vector2(abbrev_x, abbrev_y), abbrev,
		HORIZONTAL_ALIGNMENT_CENTER, -1, 9, _get_unit_color(unit_type))


func _draw_glyph(rect: Rect2, utype: String) -> void:
	var color   := _get_unit_color(utype)
	var center  := rect.get_center()
	var thick   := 2.0

	if utype in _OVAL_TYPES:
		var rx := rect.size.x * 0.38
		var ry := rect.size.y * 0.30
		draw_arc(center, rx, 0, TAU, 32, color, thick)
		# Flatten into oval via scale trick: draw two arcs or approximate with ellipse
		# Godot draw_arc draws a circle; use non-uniform scaling via transform
		# Simple oval approximation: horizontal ellipse
		var pts: PackedVector2Array = PackedVector2Array()
		var steps := 32
		for i: int in range(steps + 1):
			var angle := (float(i) / steps) * TAU
			pts.append(Vector2(center.x + rx * cos(angle), center.y + ry * sin(angle)))
		for i: int in range(pts.size() - 1):
			draw_line(pts[i], pts[i + 1], color, thick)

	elif utype in _DOT_TYPES:
		draw_circle(center, min(rect.size.x, rect.size.y) * 0.28, color)

	elif utype in _CROSS_TYPES:
		draw_line(rect.position,
			rect.position + rect.size, color, thick)
		draw_line(
			Vector2(rect.end.x, rect.position.y),
			Vector2(rect.position.x, rect.end.y), color, thick)

	else:
		# Slash — recon, cavalry, at_gun, force_recon_sniper, aa_gun
		draw_line(
			Vector2(rect.end.x, rect.position.y),
			Vector2(rect.position.x, rect.end.y), color, thick)


func _get_unit_color(utype: String) -> Color:
	if utype in _OVAL_TYPES:       return _COLOR_ARM
	if utype in _DOT_TYPES:        return _COLOR_ART
	if utype == "recon_infantry" or utype == "force_recon_sniper":
		return _COLOR_RCN
	if utype == "cavalry":          return _COLOR_CAV
	if utype == "at_gun":           return _COLOR_ATG
	if utype == "aa_gun":           return _COLOR_AA
	return _COLOR_INF  # infantry class default


func _draw_dashed_rect(rect: Rect2, color: Color, width: float,
		dash: float, gap: float) -> void:
	var corners := [
		rect.position,
		Vector2(rect.end.x, rect.position.y),
		rect.end,
		Vector2(rect.position.x, rect.end.y),
	]
	for i: int in range(4):
		_draw_dashed_line(corners[i], corners[(i + 1) % 4], color, width, dash, gap)


func _draw_dashed_line(from: Vector2, to: Vector2, color: Color,
		width: float, dash: float, gap: float) -> void:
	var dir   := (to - from).normalized()
	var total := from.distance_to(to)
	var pos   := 0.0
	var on    := true
	while pos < total:
		var seg := dash if on else gap
		var end := min(pos + seg, total)
		if on:
			draw_line(from + dir * pos, from + dir * end, color, width)
		pos = end
		on  = not on
```

- [ ] **Step 13: Create `client/scenes/game/panels/unit_glyph_cell.tscn`**

```
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://src/ui/hud/unit_glyph_cell.gd" id="1"]

[node name="UnitGlyphCell" type="Control"]
custom_minimum_size = Vector2(72, 72)
script = ExtResource("1")
```

- [ ] **Step 14: Commit**

```bash
git add client/src/ui/hud/unit_glyph_cell.gd client/scenes/game/panels/unit_glyph_cell.tscn
git commit -m "feat: add UnitGlyphCell component with NATO-style programmatic glyphs"
```

---

## Task 5: DivisionBuilderPanel scene + script

**Files:**
- Create: `client/scenes/game/panels/division_builder_panel.tscn`
- Create: `client/src/ui/hud/division_builder_panel.gd`

The .tscn defines a minimal shell. All dynamic content (grid, right panel) is built in `_ready()` via GDScript. See Diagrams 2 and 3 for layout spec.

- [ ] **Step 15: Create `client/scenes/game/panels/division_builder_panel.tscn`**

```
[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://src/ui/hud/division_builder_panel.gd" id="1"]
[ext_resource type="Theme" path="res://assets/themes/hud_dark.tres" id="2"]

[sub_resource type="StyleBoxFlat" id="SB_panel"]
bg_color = Color(0.07, 0.05, 0.03, 0.96)
border_width_left = 3
border_color = Color(0.18, 0.62, 0.56, 1.0)
corner_radius_top_left = 4
corner_radius_top_right = 4
corner_radius_bottom_right = 4
corner_radius_bottom_left = 4

[node name="DivisionBuilderPanel" type="PanelContainer"]
custom_minimum_size = Vector2(1100, 680)
size_flags_horizontal = 0
size_flags_vertical = 0
theme = ExtResource("2")
theme_override_styles/panel = SubResource("SB_panel")
script = ExtResource("1")

[node name="Margin" type="MarginContainer" parent="."]
layout_mode = 2
theme_override_constants/margin_left = 12
theme_override_constants/margin_top = 12
theme_override_constants/margin_right = 12
theme_override_constants/margin_bottom = 12

[node name="VBox" type="VBoxContainer" parent="Margin"]
layout_mode = 2
size_flags_horizontal = 3
size_flags_vertical = 3
theme_override_constants/separation = 8

[node name="TopBar" type="HBoxContainer" parent="Margin/VBox"]
unique_name_in_owner = true
layout_mode = 2
theme_override_constants/separation = 8

[node name="Body" type="HBoxContainer" parent="Margin/VBox"]
unique_name_in_owner = true
layout_mode = 2
size_flags_horizontal = 3
size_flags_vertical = 3
theme_override_constants/separation = 8
```

- [ ] **Step 16: Create `client/src/ui/hud/division_builder_panel.gd`**

```gdscript
class_name DivisionBuilderPanel
extends PanelContainer
## Division Builder — full-center overlay.
## Left 60%: 5×5 template grid of UnitGlyphCell nodes.
## Right 40%: context panel — Overview state (no cell selected)
##            or Cell-Selected state (shows eligible units for that row).
##
## Cell index convention: visual_row * 5 + col
##   visual_row 0 = VANGUARD (front/top), visual_row 4 = REAR (bottom)

signal close_requested()

const _CELL_SCENE := preload("res://scenes/game/panels/unit_glyph_cell.tscn")

const ROW_NAMES: Array[String] = ["VANGUARD", "ASSAULT", "SUPPORT", "RESERVE", "REAR"]
const ROW_COLORS: Array = [
	Color(0.80, 0.15, 0.15, 1.0),  # VANGUARD red
	Color(0.85, 0.45, 0.10, 1.0),  # ASSAULT orange
	Color(0.75, 0.65, 0.10, 1.0),  # SUPPORT yellow
	Color(0.15, 0.60, 0.25, 1.0),  # RESERVE green
	Color(0.20, 0.40, 0.75, 1.0),  # REAR blue
]

# Units eligible for each row (visual_row 0..4)
const ELIGIBLE_UNITS: Array = [
	["recon_infantry", "force_recon_sniper", "cavalry", "armoured_car", "light_tank", "commando"],
	["medium_tank", "heavy_tank", "assault_infantry", "infantry", "at_gun_sp", "self_propelled_gun"],
	["artillery", "howitzer", "at_gun", "mg", "aa_gun", "flamethrower"],
	["infantry", "assault_infantry", "at_infantry", "commando", "sniper"],
	["infantry", "mg", "at_infantry", "sniper"],
]

const UNIT_DESCRIPTIONS: Dictionary = {
	"infantry": "Standard line infantry",
	"assault_infantry": "Close-assault specialists",
	"recon_infantry": "Scouts ahead, widens radius",
	"mg": "Sustained fire, suppression",
	"cavalry": "Fast flanking, high mobility",
	"light_tank": "Fast armor, limited firepower",
	"medium_tank": "Balanced breakthrough tank",
	"heavy_tank": "Slow but heavily armoured",
	"armoured_car": "Fast scouting, anti-stealth",
	"at_infantry": "Portable anti-tank weapons",
	"at_gun": "Towed anti-tank gun",
	"at_gun_sp": "Self-propelled anti-tank",
	"aa_gun": "Anti-aircraft defence",
	"sniper": "Precision fire, high stealth",
	"flamethrower": "Clears fortifications, AOE",
	"artillery": "Long-range indirect fire",
	"commando": "Specialist inf, high stealth",
	"force_recon_sniper": "Elite recon, reveals stealth",
	"howitzer": "Heavy artillery barrage",
	"self_propelled_gun": "Mobile fire support",
}

const ARMOR_TYPES := ["light_tank", "medium_tank", "heavy_tank",
	"armoured_car", "at_gun_sp", "self_propelled_gun"]
const ARTY_TYPES  := ["artillery", "howitzer", "at_gun", "aa_gun"]

# ── State ─────────────────────────────────────────────────────────────────

var _current_template: Dictionary = {}       # the template being edited
var _cells: Array = []                       # Array[String], 25 elements, "" = empty
var _selected_cell_index: int = -1           # -1 = no selection (overview mode)
var _cell_nodes: Array = []                  # Array[UnitGlyphCell], 25 elements

# UI node refs (populated in _ready)
var _template_name_label: Label
var _overview_btn: Button
var _overview_container: VBoxContainer
var _cell_selected_container: VBoxContainer
var _eligible_list_container: VBoxContainer
var _detail_label: Label
var _row_badge_label: Label
var _cell_title_label: Label
var _division_type_label: Label
var _engagement_radius_label: Label
var _fill_bars: Array = []        # Array[ProgressBar], one per row
var _fill_labels: Array = []      # Array[Label]
var _preview_unit_type: String = ""  # unit type being hovered in eligible list; "" = none


func _ready() -> void:
	_cells.resize(25)
	_cells.fill("")
	_build_top_bar()
	_build_body()
	EventBus.division_builder_open_requested.connect(_on_open_requested)
	close_requested.connect(func() -> void: EventBus.division_builder_closed.emit())


# ── Open / Load ───────────────────────────────────────────────────────────

func _on_open_requested(template_id: String) -> void:
	if template_id == "":
		_current_template = {"id": "", "name": "New Template", "cells": []}
		_cells.fill("")
	else:
		_current_template = DivisionTemplateStore.get_template(template_id)
		if _current_template.is_empty():
			_current_template = {"id": template_id, "name": "Unknown", "cells": []}
			_cells.fill("")
		else:
			var loaded: Array = _current_template.get("cells", [])
			for i: int in range(25):
				_cells[i] = loaded[i] if i < loaded.size() else ""
	_selected_cell_index = -1
	_template_name_label.text = _current_template.get("name", "New Template")
	_refresh_grid()
	_show_overview()


# ── Top bar ───────────────────────────────────────────────────────────────

func _build_top_bar() -> void:
	var top_bar: HBoxContainer = %TopBar

	var accent := ColorRect.new()
	accent.custom_minimum_size = Vector2(3, 24)
	accent.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	accent.color = Color(0.18, 0.62, 0.56, 1.0)
	top_bar.add_child(accent)

	var title := Label.new()
	title.text = "DIVISION BUILDER"
	title.add_theme_font_size_override("font_size", 18)
	top_bar.add_child(title)

	_template_name_label = Label.new()
	_template_name_label.text = "New Template"
	_template_name_label.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_template_name_label.add_theme_font_size_override("font_size", 13)
	_template_name_label.add_theme_color_override("font_color", Color(0.8, 0.7, 0.5, 1.0))
	top_bar.add_child(_template_name_label)

	_overview_btn = Button.new()
	_overview_btn.text = "← Overview (deselect)"
	_overview_btn.visible = false
	_overview_btn.pressed.connect(_deselect_cell)
	top_bar.add_child(_overview_btn)

	var save_btn := Button.new()
	save_btn.text = "Save"
	save_btn.pressed.connect(_save_template)
	top_bar.add_child(save_btn)

	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.custom_minimum_size = Vector2(28, 28)
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	top_bar.add_child(close_btn)


# ── Body: left grid + right context ──────────────────────────────────────

func _build_body() -> void:
	var body: HBoxContainer = %Body

	# Left panel (60%)
	var left := PanelContainer.new()
	left.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	left.size_flags_stretch_ratio = 0.6
	body.add_child(left)
	_build_grid_panel(left)

	# Right panel (40%)
	var right := PanelContainer.new()
	right.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	right.size_flags_stretch_ratio = 0.4
	body.add_child(right)
	_build_right_panel(right)


# ── Left: 5×5 grid ────────────────────────────────────────────────────────

func _build_grid_panel(parent: PanelContainer) -> void:
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 8)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 8)
	margin.add_theme_constant_override("margin_bottom", 8)
	margin.layout_mode = 2
	parent.add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 4)
	margin.add_child(vbox)

	# Header row: "TEMPLATE GRID · 5×5" + "front-to-back ↓"
	var header_row := HBoxContainer.new()
	vbox.add_child(header_row)
	var grid_title := Label.new()
	grid_title.text = "TEMPLATE GRID · 5×5"
	grid_title.add_theme_font_size_override("font_size", 11)
	grid_title.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	header_row.add_child(grid_title)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	header_row.add_child(spacer)
	var dir_lbl := Label.new()
	dir_lbl.text = "front-to-back ↓"
	dir_lbl.add_theme_font_size_override("font_size", 11)
	dir_lbl.add_theme_color_override("font_color", Color(0.75, 0.35, 0.2, 1.0))
	header_row.add_child(dir_lbl)

	# "FRONT LINE" separator
	var front_lbl := Label.new()
	front_lbl.text = "══════════ FRONT LINE ══════════"
	front_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	front_lbl.add_theme_color_override("font_color", Color(0.75, 0.2, 0.2, 1.0))
	front_lbl.add_theme_font_size_override("font_size", 11)
	vbox.add_child(front_lbl)

	# Grid area: row labels on left, 5×5 GridContainer on right
	var grid_area := HBoxContainer.new()
	grid_area.add_theme_constant_override("separation", 6)
	vbox.add_child(grid_area)

	# Row labels
	var row_label_col := VBoxContainer.new()
	row_label_col.add_theme_constant_override("separation", 0)
	row_label_col.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	grid_area.add_child(row_label_col)

	for r: int in range(5):
		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.custom_minimum_size = Vector2(68, 76)  # matches cell height
		row_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row_lbl.add_theme_font_size_override("font_size", 11)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		row_label_col.add_child(row_lbl)

	# 5×5 grid
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	grid_area.add_child(grid)

	_cell_nodes.clear()
	for i: int in range(25):
		var cell: UnitGlyphCell = _CELL_SCENE.instantiate() as UnitGlyphCell
		cell.unit_type = _cells[i]
		cell.cell_clicked.connect(_on_cell_clicked.bind(i))
		cell.cell_right_clicked.connect(_on_cell_right_clicked.bind(i))
		grid.add_child(cell)
		_cell_nodes.append(cell)


# ── Right: context panel ──────────────────────────────────────────────────

func _build_right_panel(parent: PanelContainer) -> void:
	var scroll := ScrollContainer.new()
	scroll.layout_mode = 2
	scroll.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	scroll.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(scroll)

	var margin := MarginContainer.new()
	margin.layout_mode = 2
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 10)
	scroll.add_child(margin)

	var right_vbox := VBoxContainer.new()
	right_vbox.layout_mode = 2
	right_vbox.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	margin.add_child(right_vbox)

	# ── Overview container ────────────────────────────────────────────────
	_overview_container = VBoxContainer.new()
	_overview_container.add_theme_constant_override("separation", 10)
	right_vbox.add_child(_overview_container)

	var ov_title := Label.new()
	ov_title.text = "DIVISION OVERVIEW"
	ov_title.add_theme_font_size_override("font_size", 16)
	_overview_container.add_child(ov_title)

	var auto_lbl := Label.new()
	auto_lbl.text = "[AUTO-DERIVED]  computed from composition"
	auto_lbl.add_theme_font_size_override("font_size", 10)
	auto_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_overview_container.add_child(auto_lbl)

	var type_row := HBoxContainer.new()
	_overview_container.add_child(type_row)
	var type_col := VBoxContainer.new()
	type_col.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	type_row.add_child(type_col)
	var type_header := Label.new()
	type_header.text = "DIVISION TYPE"
	type_header.add_theme_font_size_override("font_size", 10)
	type_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	type_col.add_child(type_header)
	_division_type_label = Label.new()
	_division_type_label.text = "—"
	_division_type_label.add_theme_font_size_override("font_size", 16)
	type_col.add_child(_division_type_label)

	var radius_col := VBoxContainer.new()
	type_row.add_child(radius_col)
	var radius_header := Label.new()
	radius_header.text = "ENGAGEMENT\nRADIUS"
	radius_header.add_theme_font_size_override("font_size", 10)
	radius_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	radius_col.add_child(radius_header)
	_engagement_radius_label = Label.new()
	_engagement_radius_label.text = "—"
	_engagement_radius_label.add_theme_font_size_override("font_size", 16)
	radius_col.add_child(_engagement_radius_label)

	# Movement profile swatches
	var mp_header := Label.new()
	mp_header.text = "MOVEMENT PROFILE — fast → impassable"
	mp_header.add_theme_font_size_override("font_size", 10)
	mp_header.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_overview_container.add_child(mp_header)
	var swatch_row := HBoxContainer.new()
	swatch_row.add_theme_constant_override("separation", 4)
	_overview_container.add_child(swatch_row)
	# Swatches are always the same visual; only labels change per composition
	# We'll build them statically and update the container label below them
	for entry: Array in [
		[Color(0.35, 0.55, 0.25, 1.0), "Plains"],
		[Color(0.30, 0.50, 0.20, 1.0), "Hills"],
		[Color(0.25, 0.40, 0.15, 1.0), "Forest"],
		[Color(0.15, 0.25, 0.10, 1.0), "DnsF"],
		[Color(0.10, 0.10, 0.10, 0.8), "Mtn"],
	]:
		var swatch_col := VBoxContainer.new()
		swatch_row.add_child(swatch_col)
		var swatch := ColorRect.new()
		swatch.custom_minimum_size = Vector2(38, 24)
		swatch.color = entry[0] as Color
		swatch_col.add_child(swatch)
		var swatch_lbl := Label.new()
		swatch_lbl.text = entry[1] as String
		swatch_lbl.add_theme_font_size_override("font_size", 9)
		swatch_col.add_child(swatch_lbl)

	# Fill & role balance
	var fill_header_row := HBoxContainer.new()
	_overview_container.add_child(fill_header_row)
	var fill_hdr := Label.new()
	fill_hdr.text = "FILL & ROLE BALANCE"
	fill_hdr.add_theme_font_size_override("font_size", 11)
	fill_hdr.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	fill_header_row.add_child(fill_hdr)
	var fill_total_lbl := Label.new()
	fill_total_lbl.name = "FillTotalLabel"
	fill_total_lbl.add_theme_font_size_override("font_size", 11)
	fill_header_row.add_child(fill_total_lbl)

	_fill_bars.clear()
	_fill_labels.clear()
	for r: int in range(5):
		var bar_row := HBoxContainer.new()
		bar_row.add_theme_constant_override("separation", 6)
		_overview_container.add_child(bar_row)
		var row_lbl := Label.new()
		row_lbl.text = ROW_NAMES[r]
		row_lbl.custom_minimum_size = Vector2(72, 0)
		row_lbl.add_theme_font_size_override("font_size", 10)
		row_lbl.add_theme_color_override("font_color", ROW_COLORS[r])
		bar_row.add_child(row_lbl)
		var bar := ProgressBar.new()
		bar.min_value = 0.0
		bar.max_value = 5.0
		bar.value = 0.0
		bar.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
		bar.custom_minimum_size = Vector2(0, 12)
		bar_row.add_child(bar)
		var count_lbl := Label.new()
		count_lbl.custom_minimum_size = Vector2(28, 0)
		count_lbl.add_theme_font_size_override("font_size", 10)
		bar_row.add_child(count_lbl)
		_fill_bars.append(bar)
		_fill_labels.append(count_lbl)

	# ── Cell-selected container ───────────────────────────────────────────
	_cell_selected_container = VBoxContainer.new()
	_cell_selected_container.add_theme_constant_override("separation", 8)
	_cell_selected_container.visible = false
	right_vbox.add_child(_cell_selected_container)

	# Row badge + cell title row
	var badge_row := HBoxContainer.new()
	badge_row.add_theme_constant_override("separation", 8)
	_cell_selected_container.add_child(badge_row)
	_row_badge_label = Label.new()
	_row_badge_label.custom_minimum_size = Vector2(80, 28)
	_row_badge_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_row_badge_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	badge_row.add_child(_row_badge_label)
	_cell_title_label = Label.new()
	_cell_title_label.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	_cell_title_label.add_theme_font_size_override("font_size", 13)
	badge_row.add_child(_cell_title_label)

	var hint_lbl := Label.new()
	hint_lbl.text = "hover = preview    click = place"
	hint_lbl.add_theme_font_size_override("font_size", 10)
	hint_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_cell_selected_container.add_child(hint_lbl)

	var eligible_hdr := Label.new()
	eligible_hdr.name = "EligibleHeader"
	eligible_hdr.add_theme_font_size_override("font_size", 11)
	eligible_hdr.add_theme_color_override("font_color", Color(0.7, 0.65, 0.5, 1.0))
	_cell_selected_container.add_child(eligible_hdr)

	var list_scroll := ScrollContainer.new()
	list_scroll.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.size_flags_vertical = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_cell_selected_container.add_child(list_scroll)

	_eligible_list_container = VBoxContainer.new()
	_eligible_list_container.add_theme_constant_override("separation", 4)
	_eligible_list_container.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	list_scroll.add_child(_eligible_list_container)

	var sep := HSeparator.new()
	_cell_selected_container.add_child(sep)

	var detail_hdr := Label.new()
	detail_hdr.text = "DETAIL"
	detail_hdr.add_theme_font_size_override("font_size", 10)
	detail_hdr.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	_cell_selected_container.add_child(detail_hdr)

	_detail_label = Label.new()
	_detail_label.add_theme_font_size_override("font_size", 12)
	_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	_cell_selected_container.add_child(_detail_label)


# ── Grid interactions ─────────────────────────────────────────────────────

func _on_cell_clicked(index: int) -> void:
	if _selected_cell_index == index:
		# Already selected — deselect
		_deselect_cell()
		return
	_selected_cell_index = index
	for i: int in range(_cell_nodes.size()):
		(_cell_nodes[i] as UnitGlyphCell).is_selected = (i == index)
	_overview_btn.visible = true
	_show_cell_selected(index)


func _on_cell_right_clicked(index: int) -> void:
	_cells[index] = ""
	(_cell_nodes[index] as UnitGlyphCell).unit_type = ""
	if _selected_cell_index == index:
		_refresh_cell_selected_panel(index)
	_refresh_overview_stats()


func _deselect_cell() -> void:
	_selected_cell_index = -1
	for node: UnitGlyphCell in _cell_nodes:
		node.is_selected = false
	_overview_btn.visible = false
	_show_overview()


# ── State switching ───────────────────────────────────────────────────────

func _show_overview() -> void:
	_overview_container.visible = true
	_cell_selected_container.visible = false
	_refresh_overview_stats()


func _show_cell_selected(index: int) -> void:
	_overview_container.visible = false
	_cell_selected_container.visible = true
	_refresh_cell_selected_panel(index)


func _refresh_overview_stats() -> void:
	var div_type  := _derive_division_type(_cells)
	var radius    := _derive_engagement_radius(_cells)
	var total     := 0
	for unit_type: String in _cells:
		if unit_type != "":
			total += 1

	_division_type_label.text    = div_type
	_engagement_radius_label.text = radius

	var fill_total_lbl: Label = _overview_container.find_child("FillTotalLabel", true, false) as Label
	if fill_total_lbl != null:
		fill_total_lbl.text = "%d / 25 cells" % total

	for r: int in range(5):
		var count := 0
		for c: int in range(5):
			if _cells[r * 5 + c] != "":
				count += 1
		(_fill_bars[r] as ProgressBar).value = float(count)
		(_fill_labels[r] as Label).text = "%d/5" % count


func _refresh_cell_selected_panel(index: int) -> void:
	var row: int = index / 5
	var col: int = index % 5
	var current_unit: String = _cells[index]

	_row_badge_label.text = ROW_NAMES[row]
	_row_badge_label.add_theme_color_override("font_color", ROW_COLORS[row])

	var cell_title := "Cell R%dC%d" % [row + 1, col + 1]
	if current_unit != "":
		cell_title += " · holds %s" % UnitGlyphCell.UNIT_ABBREV.get(current_unit, current_unit)
	_cell_title_label.text = cell_title

	var eligible_hdr: Label = _cell_selected_container.find_child("EligibleHeader", true, false) as Label
	if eligible_hdr != null:
		eligible_hdr.text = "ELIGIBLE UNITS · %s ROW" % ROW_NAMES[row]

	# Rebuild unit card list
	for child: Node in _eligible_list_container.get_children():
		_eligible_list_container.remove_child(child)
		child.queue_free()

	for unit_type: String in ELIGIBLE_UNITS[row]:
		var card := _make_unit_card(unit_type, index)
		_eligible_list_container.add_child(card)

	# Detail — §6.1a: filled cell → show placed unit immediately; empty → prompt to hover
	# Hover on a unit card (mouse_entered) will temporarily override this via
	# _preview_unit_in_detail(); mouse_exited restores via _restore_detail_for_cell().
	_restore_detail_for_cell(index)


func _make_unit_card(unit_type: String, target_index: int) -> Control:
	var is_in_cell := (_cells[target_index] == unit_type)

	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	card.add_child(hbox)

	# Mini glyph (48×48)
	var mini: UnitGlyphCell = _CELL_SCENE.instantiate() as UnitGlyphCell
	mini.unit_type = unit_type
	mini.custom_minimum_size = Vector2(48, 48)
	hbox.add_child(mini)

	# Name + description
	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_FILL | Control.SIZE_EXPAND
	hbox.add_child(text_col)

	var name_row := HBoxContainer.new()
	text_col.add_child(name_row)
	var name_lbl := Label.new()
	name_lbl.text = unit_type.replace("_", " ").capitalize()
	name_lbl.add_theme_font_size_override("font_size", 13)
	name_row.add_child(name_lbl)
	var abbrev_lbl := Label.new()
	abbrev_lbl.text = "  %s" % UnitGlyphCell.UNIT_ABBREV.get(unit_type, "???")
	abbrev_lbl.add_theme_font_size_override("font_size", 11)
	abbrev_lbl.add_theme_color_override("font_color", Color(0.6, 0.55, 0.4, 1.0))
	name_row.add_child(abbrev_lbl)

	if is_in_cell:
		var badge := Label.new()
		badge.text = " IN CELL"
		badge.add_theme_font_size_override("font_size", 10)
		badge.add_theme_color_override("font_color", Color(0.2, 0.7, 0.4, 1.0))
		name_row.add_child(badge)

	var desc_lbl := Label.new()
	desc_lbl.text = UNIT_DESCRIPTIONS.get(unit_type, "")
	desc_lbl.add_theme_font_size_override("font_size", 10)
	desc_lbl.add_theme_color_override("font_color", Color(0.65, 0.6, 0.45, 1.0))
	text_col.add_child(desc_lbl)

	# Hover = preview in detail callout (§6.2: browse without committing).
	# mouse_entered/exited are on the card Control so the whole row is the hover target.
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_entered.connect(func() -> void: _preview_unit_in_detail(unit_type))
	card.mouse_exited.connect(func() -> void: _restore_detail_for_cell(target_index))

	# Click = commit placement (or remove if already in cell).
	card.gui_input.connect(func(event: InputEvent) -> void:
		if not (event is InputEventMouseButton):
			return
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			if _cells[target_index] == unit_type:
				_cells[target_index] = ""
			else:
				_cells[target_index] = unit_type
			(_cell_nodes[target_index] as UnitGlyphCell).unit_type = _cells[target_index]
			_refresh_cell_selected_panel(target_index)
			_refresh_overview_stats()
	)

	return card


# ── Detail callout helpers ────────────────────────────────────────────────

## Temporarily show a unit's info while hovering its card (§6.2 hover-preview).
## Does NOT place the unit. Restores on mouse_exited via _restore_detail_for_cell().
func _preview_unit_in_detail(unit_type: String) -> void:
	_preview_unit_type = unit_type
	_detail_label.text = "%s  %s\n%s\n(hover — click to place)" % [
		UnitGlyphCell.UNIT_ABBREV.get(unit_type, "???"),
		unit_type.replace("_", " ").capitalize(),
		UNIT_DESCRIPTIONS.get(unit_type, ""),
	]
	_detail_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.65, 1.0))


## Restore detail callout to the placed unit (§6.1a) or the empty-cell prompt.
## Called on mouse_exited from a card, and at the start of _refresh_cell_selected_panel.
func _restore_detail_for_cell(index: int) -> void:
	_preview_unit_type = ""
	_detail_label.remove_theme_color_override("font_color")
	var current_unit: String = _cells[index] if index >= 0 else ""
	if current_unit != "":
		_detail_label.text = "%s  %s\n%s" % [
			UnitGlyphCell.UNIT_ABBREV.get(current_unit, "???"),
			current_unit.replace("_", " ").capitalize(),
			UNIT_DESCRIPTIONS.get(current_unit, ""),
		]
	else:
		_detail_label.text = "(empty — hover a unit above to preview)"


# ── Grid refresh ──────────────────────────────────────────────────────────

func _refresh_grid() -> void:
	for i: int in range(25):
		if i < _cell_nodes.size():
			(_cell_nodes[i] as UnitGlyphCell).unit_type = _cells[i]
			(_cell_nodes[i] as UnitGlyphCell).is_selected = false


# ── Save ──────────────────────────────────────────────────────────────────

func _save_template() -> void:
	var template_id: String = _current_template.get("id", "")
	if template_id == "":
		template_id = "user_%d" % Time.get_unix_time_from_system()
		_current_template["id"] = template_id
	_current_template["cells"] = _cells.duplicate()
	DivisionTemplateStore.save_template(_current_template)


# ── Pure helpers (static, testable) ──────────────────────────────────────

static func _derive_division_type(cells: Array) -> String:
	var armor := 0
	var arty  := 0
	var inf   := 0
	var total := 0
	for unit_type: String in cells:
		if unit_type == "":
			continue
		total += 1
		if unit_type in ARMOR_TYPES:
			armor += 1
		elif unit_type in ARTY_TYPES:
			arty += 1
		else:
			inf += 1
	if total == 0: return "Empty"
	if armor >= 3: return "Armoured Assault"
	if armor >= 2 and inf >= 2: return "Combined-Arms"
	if arty >= 2 and inf >= 3: return "Supported Infantry"
	if inf >= 5: return "Infantry Division"
	return "Mixed"


static func _derive_engagement_radius(cells: Array) -> String:
	var armor := 0
	for unit_type: String in cells:
		if unit_type in ARMOR_TYPES:
			armor += 1
	if armor >= 3: return "~30 km"
	if armor >= 1: return "~40 km"
	return "~50 km"
```

- [ ] **Step 17: Commit**

```bash
git add client/scenes/game/panels/division_builder_panel.tscn \
        client/src/ui/hud/division_builder_panel.gd
git commit -m "feat: add DivisionBuilderPanel scene and script"
```

---

## Task 6: Wire into game_hud.gd

**Files:**
- Modify: `client/src/ui/hud/game_hud.gd`

The panel is loaded via `preload` and added dynamically so `game_hud.tscn` does not need editing.

- [ ] **Step 18: Add DivisionBuilderPanel to game_hud.gd**

Open `client/src/ui/hud/game_hud.gd`. Make these three additions:

**Addition 1** — After the last `const` line near the top of the file (after `const _DOCK_BUTTON_STYLE_NORMAL`), add:

```gdscript
const _DivisionBuilderScene: PackedScene = preload("res://scenes/game/panels/division_builder_panel.tscn")
```

**Addition 2** — After the last `@onready var` line (after `@onready var _research_tree_panel`), add:

```gdscript
var _division_builder_panel: Control
```

(This is a `var`, not `@onready`, because we instantiate it in `_ready()`.)

**Addition 3** — Inside `_ready()`, after the line:
```gdscript
hud_manager.register_panel("research_tree", _research_tree_panel, HUDManager.PlacementMode.FULL_CENTER)
```
add:

```gdscript
# Division Builder — full-center, opened from military panel template list
_division_builder_panel = _DivisionBuilderScene.instantiate()
add_child(_division_builder_panel)
hud_manager.register_panel("division_builder", _division_builder_panel, HUDManager.PlacementMode.FULL_CENTER)
EventBus.division_builder_open_requested.connect(func(_template_id: String) -> void:
	hud_manager.show_panel("division_builder")
)
EventBus.division_builder_closed.connect(func() -> void:
	hud_manager.hide_panel("division_builder")
)
if _division_builder_panel.has_signal("close_requested"):
	_division_builder_panel.connect("close_requested", func() -> void:
		hud_manager.hide_panel("division_builder")
	)
```

- [ ] **Step 19: Commit**

```bash
git add client/src/ui/hud/game_hud.gd
git commit -m "feat: register DivisionBuilderPanel with HUDManager in game_hud"
```

---

## Verification — Manual Test Checklist

Run the game and verify all of the following:

- [ ] **Military panel land tab**
  - Press `R` to open military panel
  - Land tab shows "DIVISION TEMPLATES" header with `[+]` button
  - Three template cards listed: "3rd Mechanized / Combined-Arms", "1st Infantry Div / Infantry Division", "Armoured Spearhead / Armoured Assault"
  - `[+]` does not crash

- [ ] **Opening builder via [+]**
  - Click `[+]` in military panel → military panel closes, Division Builder opens full-center with dark overlay
  - Title shows "DIVISION BUILDER", template name shows "New Template"
  - 5×5 grid renders with row labels (VANGUARD/ASSAULT/SUPPORT/RESERVE/REAR in correct colors)
  - All 25 cells show empty dashed-border state with `+` sign
  - Right panel shows "DIVISION OVERVIEW" with "Empty" division type, "—" radius, 0/5 fill bars

- [ ] **Opening builder via [Edit]**
  - Close builder (`✕` or Escape)
  - Click `[Edit]` on "3rd Mechanized"
  - Builder opens with grid pre-filled: row 0 (VANGUARD) cols 0+2 show RCN slash glyph (teal), row 1 (ASSAULT) cols 0+1 show MTK oval (blue), col 2 shows INF cross (olive), row 2 (SUPPORT) col 0 shows ART dot (red), col 1 shows ATG slash (brown)
  - Right panel shows "Combined-Arms" division type, "~40 km" radius, fill bars 2/5 + 3/5 + 2/5 + 1/5 + 0/5

- [ ] **Cell click → cell-selected state**
  - Click any filled or empty cell
  - Selected cell gets teal border
  - `[← Overview (deselect)]` button appears in top bar
  - Right panel switches to cell-selected view
  - Row badge shows correct row name in correct color
  - "ELIGIBLE UNITS · {ROW} ROW" header is correct
  - Unit list shows eligible units for that row with glyphs + descriptions

- [ ] **Placing a unit**
  - With a cell selected, click a unit card in the eligible list
  - Cell on the grid updates immediately to show the placed unit's glyph
  - "IN CELL" badge appears on that unit card
  - Overview stats update (fill bars, division type)

- [ ] **Removing a unit**
  - Click the [IN CELL] unit card again → cell clears to empty (+)
  - OR right-click a filled cell → it clears

- [ ] **Deselect**
  - Click `[← Overview (deselect)]` → right panel returns to overview
  - All cell borders lose teal highlight
  - Button disappears

- [ ] **Save**
  - Place some units, click Save
  - Close builder (✕)
  - Reopen builder via [Edit] on same template → units preserved

- [ ] **Close**
  - Click `✕` → builder closes, **military panel reopens automatically** (HUDManager's `_previous_side_docked` restores the last side-docked panel when a FULL_CENTER panel is hidden — this is correct expected behavior)
  - Press Escape → builder closes

- [ ] **Regression**
  - Economy (E), Research (Q), Diplomacy (T) panels still open/close correctly
  - No GDScript errors in output log during normal use
