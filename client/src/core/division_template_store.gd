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
			0: "recon_infantry", 2: "recon_infantry",
			5: "medium_tank", 6: "medium_tank", 7: "infantry",
			10: "artillery", 11: "at_gun",
			15: "infantry",
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
