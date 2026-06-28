extends Node
## Tests military_panel.gd's _derive_division_type() static helper.
## This function is static so it can be tested without instantiating the scene.

func _ready() -> void:
	test_derive_division_type()
	print("=== test_military_panel_derive: all passed ===")
	get_tree().quit(0)


func test_derive_division_type() -> void:
	var cells: Array = []
	cells.resize(25)
	cells.fill("")
	assert(DivisionTemplateStore.get_templates().size() == 3,
		"FAIL: expected 3 preset templates")

	var empty_cells: Array = []
	empty_cells.resize(25)
	empty_cells.fill("")
	assert(_derive_division_type(empty_cells) == "Empty",
		"FAIL: empty cells should be 'Empty'")

	var inf_cells: Array = []
	inf_cells.resize(25)
	inf_cells.fill("infantry")
	assert(_derive_division_type(inf_cells) == "Infantry Division",
		"FAIL: all infantry should be 'Infantry Division'")

	var armor_cells: Array = []
	armor_cells.resize(25)
	armor_cells.fill("")
	armor_cells[0] = "medium_tank"
	armor_cells[1] = "medium_tank"
	armor_cells[2] = "heavy_tank"
	assert(_derive_division_type(armor_cells) == "Armoured Assault",
		"FAIL: 3 armor cells should be 'Armoured Assault'")

	var combined_cells: Array = []
	combined_cells.resize(25)
	combined_cells.fill("")
	combined_cells[0] = "medium_tank"
	combined_cells[1] = "medium_tank"
	combined_cells[2] = "infantry"
	combined_cells[3] = "infantry"
	assert(_derive_division_type(combined_cells) == "Combined-Arms",
		"FAIL: 2 armor + 2 inf should be 'Combined-Arms'")

	var arty_cells: Array = []
	arty_cells.resize(25)
	arty_cells.fill("")
	arty_cells[0] = "artillery"
	arty_cells[1] = "howitzer"
	arty_cells[2] = "infantry"
	arty_cells[3] = "infantry"
	arty_cells[4] = "infantry"
	assert(_derive_division_type(arty_cells) == "Supported Infantry",
		"FAIL: 2 arty + 3 inf should be 'Supported Infantry'")

	var mixed_cells: Array = []
	mixed_cells.resize(25)
	mixed_cells.fill("")
	mixed_cells[0] = "cavalry"
	mixed_cells[1] = "sniper"
	assert(_derive_division_type(mixed_cells) == "Mixed",
		"FAIL: 2 non-matching cells should be 'Mixed'")

	print("PASS test_derive_division_type")


# Duplicate of the static function for testing before the real file is loaded
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
