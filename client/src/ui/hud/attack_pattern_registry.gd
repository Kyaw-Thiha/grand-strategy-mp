class_name AttackPatternRegistry

const BASE_ATTRITION := 2.5

const HP_FLOOR_PCT : Dictionary = {
    "infantry": 20, "assault_infantry": 20, "recon_infantry": 20,
    "mg": 20, "cavalry": 20, "sniper": 20, "commando": 20, "flamethrower": 20,
    "light_tank": 30, "medium_tank": 30, "heavy_tank": 30, "armoured_car": 30,
    "at_infantry": 20, "at_gun": 0, "at_gun_sp": 30,
    "aa_gun": 0, "artillery": 0,
}

static func get_targets(
    unit_type: String,
    cell_index: int,
    enemy_cells: Array,
    n: int = 0,
) -> Array[int]:
    var att_row : int = cell_index / 5
    var att_col : int = cell_index % 5
    match unit_type:
        "infantry", "assault_infantry", "recon_infantry", "commando", "mg", "cavalry":
            return _horizontal_targets(enemy_cells, n)
        "flamethrower":
            return _flamethrower_targets(att_row, att_col, enemy_cells)
        _:
            return []

static func simulate_round(
    attacker_cells: Array,
    enemy_cells: Array,
    round_number: int,
    priority_types: Array = [],
    n: int = 0,
) -> Dictionary:
    var virtual : Array = []
    for c in enemy_cells:
        virtual.append({
            "unit_type":     c.get("unit_type", ""),
            "hp":            float(c.get("hp", 100)),
            "suppression":   float(c.get("suppression", 0)),
            "incapacitated": c.get("incapacitated", false),
            "stealthed":     c.get("stealthed", false),
        })

    var result     : Dictionary = {}
    var fire_order : Array      = _get_fire_order(attacker_cells, priority_types)

    for entry in fire_order:
        var att_idx  : int    = entry["idx"]
        var att_row  : int    = att_idx / 5
        var att_col  : int    = att_idx % 5
        var utype    : String = entry["unit_type"]

        var targets : Array[int] = []
        match utype:
            "infantry", "assault_infantry", "recon_infantry", "commando", "mg", "cavalry":
                targets = _horizontal_targets(virtual, n)
            "flamethrower":
                targets = _flamethrower_targets(att_row, att_col, virtual)
            _:
                targets = []

        result[att_idx] = targets
        if targets.is_empty():
            continue

        var hp_frac : float = _hp_fraction_for(utype, round_number)
        var per_hp  : float = (BASE_ATTRITION * hp_frac) / float(targets.size())

        for t_idx in targets:
            if t_idx < 0 or t_idx >= 25:
                continue
            var tc = virtual[t_idx]
            if tc.get("incapacitated", false):
                continue
            var new_hp    : float = maxf(0.0, float(tc.get("hp", 100)) - per_hp)
            tc["hp"]              = new_hp
            var floor_pct : float = float(HP_FLOOR_PCT.get(tc.get("unit_type", ""), 0))
            if (floor_pct > 0.0 and new_hp <= floor_pct) or new_hp <= 0.0:
                tc["incapacitated"] = true

    return result

static func _frontmost_occupied_row(cells: Array) -> int:
    for row in range(4, -1, -1):
        for col in range(5):
            var cell = cells[row * 5 + col]
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
                return row
    return -1

static func _horizontal_targets(cells: Array, n: int) -> Array[int]:
    var row := _frontmost_occupied_row(cells)
    if row < 0:
        return []
    var result : Array[int] = []
    for col in range(5):
        var idx  := row * 5 + col
        var cell  = cells[idx]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
            result.append(idx)
        if n > 0 and result.size() >= n:
            break
    return result

static func _flamethrower_targets(att_row: int, att_col: int, cells: Array) -> Array[int]:
    var rows : Array[int] = []
    if att_row >= 0:      rows.append(att_row)
    if att_row - 1 >= 0: rows.append(att_row - 1)
    var cols : Array[int] = []
    for c in [att_col - 1, att_col, att_col + 1]:
        if c >= 0 and c <= 4: cols.append(c)
    var result : Array[int] = []
    for r in rows:
        for c in cols:
            var idx  := r * 5 + c
            var cell  = cells[idx]
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
                result.append(idx)
    return result

static func _get_fire_order(attacker_cells: Array, priority_types: Array) -> Array:
    var living : Array = []
    for i in range(attacker_cells.size()):
        var cell = attacker_cells[i]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false):
            living.append({ "idx": i, "unit_type": cell.get("unit_type", "") })

    living.sort_custom(func(a, b) -> bool:
        var aP : int = priority_types.find(a["unit_type"])
        var bP : int = priority_types.find(b["unit_type"])
        if aP >= 0 and bP >= 0: return aP < bP
        if aP >= 0:              return true
        if bP >= 0:              return false
        var aRow : int = a["idx"] / 5
        var bRow : int = b["idx"] / 5
        if aRow != bRow: return aRow > bRow
        return (a["idx"] % 5) < (b["idx"] % 5)
    )
    return living

static func _hp_fraction_for(unit_type: String, round_number: int) -> float:
    match unit_type:
        "mg":           return 0.08
        "flamethrower": return 0.20
        "cavalry":      return 0.55 if round_number == 1 else 0.30
        _:              return 0.30
