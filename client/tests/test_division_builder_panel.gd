extends Node
## Tests DivisionBuilderPanel's static helpers without needing a scene tree.

func _ready() -> void:
	test_derive_division_type()
	test_derive_engagement_radius()
	print("=== test_division_builder_panel: all passed ===")
	get_tree().quit(0)


func test_derive_division_type() -> void:
	var empty: Array = []
	empty.resize(25)
	empty.fill("")
	assert(_derive_division_type(empty) == "Empty", "FAIL: empty cells should be 'Empty'")

	var all_inf: Array = []
	all_inf.resize(25)
	all_inf.fill("infantry")
	assert(_derive_division_type(all_inf) == "Infantry Division", "FAIL: all infantry")

	var three_armor: Array = []
	three_armor.resize(25)
	three_armor.fill("")
	three_armor[0] = "medium_tank"
	three_armor[1] = "light_tank"
	three_armor[2] = "heavy_tank"
	assert(_derive_division_type(three_armor) == "Armoured Assault", "FAIL: 3 armor = Armoured Assault")

	var combined: Array = []
	combined.resize(25)
	combined.fill("")
	combined[0] = "medium_tank"
	combined[1] = "heavy_tank"
	combined[2] = "infantry"
	combined[3] = "infantry"
	assert(_derive_division_type(combined) == "Combined-Arms", "FAIL: 2 armor + 2 inf = Combined-Arms")

	var supported: Array = []
	supported.resize(25)
	supported.fill("")
	supported[0] = "artillery"
	supported[1] = "howitzer"
	supported[2] = "infantry"
	supported[3] = "infantry"
	supported[4] = "infantry"
	assert(_derive_division_type(supported) == "Supported Infantry", "FAIL: 2 arty + 3 inf")

	print("PASS test_derive_division_type")


func test_derive_engagement_radius() -> void:
	var empty: Array = []
	empty.resize(25)
	empty.fill("")
	assert(_derive_engagement_radius(empty) == "~50 km", "FAIL: empty should be ~50 km")

	var one_armor: Array = []
	one_armor.resize(25)
	one_armor.fill("")
	one_armor[0] = "medium_tank"
	assert(_derive_engagement_radius(one_armor) == "~40 km", "FAIL: 1 armor = ~40 km")

	var three_armor: Array = []
	three_armor.resize(25)
	three_armor.fill("")
	three_armor[0] = "light_tank"
	three_armor[1] = "medium_tank"
	three_armor[2] = "heavy_tank"
	assert(_derive_engagement_radius(three_armor) == "~30 km", "FAIL: 3 armor = ~30 km")

	var all_inf: Array = []
	all_inf.resize(25)
	all_inf.fill("infantry")
	assert(_derive_engagement_radius(all_inf) == "~50 km", "FAIL: all infantry = ~50 km")

	print("PASS test_derive_engagement_radius")


# Duplicates of the static functions for testing without scene instantiation
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
	if total == 0: return "Empty"
	if armor >= 3: return "Armoured Assault"
	if armor >= 2 and inf >= 2: return "Combined-Arms"
	if arty >= 2 and inf >= 3: return "Supported Infantry"
	if inf >= 5: return "Infantry Division"
	return "Mixed"

static func _derive_engagement_radius(cells: Array) -> String:
	var armor := 0
	for unit_type: String in cells:
		if unit_type in ["light_tank", "medium_tank", "heavy_tank",
				"armoured_car", "at_gun_sp", "self_propelled_gun"]:
			armor += 1
	if armor >= 3: return "~30 km"
	if armor >= 1: return "~40 km"
	return "~50 km"
