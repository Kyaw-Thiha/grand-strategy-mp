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
