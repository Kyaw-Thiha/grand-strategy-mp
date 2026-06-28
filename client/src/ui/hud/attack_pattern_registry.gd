class_name AttackPatternRegistry

const BASE_ATTRITION := 2.5

const ARMOURED_TARGET_TYPES := {
    "light_tank": true, "medium_tank": true, "heavy_tank": true,
    "armoured_car": true, "at_gun_sp": true,
}

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
        "light_tank", "medium_tank", "heavy_tank", "armoured_car":
            return _armour_column_targets(att_row, att_col, enemy_cells, n)
        "at_infantry", "at_gun", "at_gun_sp":
            return _at_column_targets(att_col, enemy_cells, n)
        "aa_gun":
            return []
        "sniper", "force_recon_sniper":
            return _sniper_targets(enemy_cells, n)
        "artillery", "howitzer", "self_propelled_gun":
            return _artillery_area_targets(cell_index, enemy_cells, n)
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
            "light_tank", "medium_tank", "heavy_tank", "armoured_car":
                targets = _armour_column_targets(att_row, att_col, virtual, n)
            "at_infantry", "at_gun", "at_gun_sp":
                targets = _at_column_targets(att_col, virtual, n)
            "aa_gun":
                targets = []
            "sniper", "force_recon_sniper":
                targets = _sniper_targets(virtual, n)
            "artillery", "howitzer", "self_propelled_gun":
                targets = _artillery_area_targets(att_idx, virtual, n)
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
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false) and not cell.get("stealthed", false):
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
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false) and not cell.get("stealthed", false):
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
            if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false) and not cell.get("stealthed", false):
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
        "at_infantry", "at_gun", "at_gun_sp": return 0.75
        "light_tank", "medium_tank", "heavy_tank", "armoured_car": return 0.50
        "sniper", "force_recon_sniper": return 0.80
        "artillery", "howitzer", "self_propelled_gun": return 0.65
        _:              return 0.30

# Returns living cells in `col` where row >= min_row. R5 first (row 4 -> min_row).
static func _column_targets(col: int, min_row: int, cells: Array) -> Array[int]:
    var result: Array[int] = []
    for row in range(4, min_row - 1, -1):
        var idx := row * 5 + col
        var cell = cells[idx]
        if cell.get("unit_type", "") != "" and not cell.get("incapacitated", false) and not cell.get("stealthed", false):
            result.append(idx)
    return result

static func _has_armour_in_col(col: int, cells: Array) -> bool:
    for row in range(4, -1, -1):
        var cell = cells[row * 5 + col]
        if ARMOURED_TARGET_TYPES.has(cell.get("unit_type", "")) and not cell.get("incapacitated", false) and not cell.get("stealthed", false):
            return true
    return false

# Armour column attack. Client does not check cover — preview approximation is acceptable.
# TODO: pass cover_string from engagement state once exposed to client (Branch K)
static func _armour_column_targets(att_row: int, att_col: int, cells: Array, n: int) -> Array[int]:
    var min_row: int = 4 - att_row
    var own := _column_targets(att_col, min_row, cells)
    if own.size() > 0:
        return own.slice(0, n) if n > 0 else own
    var search: Array[int] = []
    if att_col == 0 or att_col == 1:
        search = [att_col + 1, att_col + 2]
    elif att_col == 3 or att_col == 4:
        search = [att_col - 1, att_col - 2]
    else:
        search = [att_col - 1, att_col + 1]
    search = search.filter(func(c): return c >= 0 and c <= 4)
    for shifted_col in search:
        var col_targets := _column_targets(shifted_col, min_row, cells)
        if col_targets.size() > 0:
            return col_targets.slice(0, n) if n > 0 else col_targets
    return []

# AT column attack: armoured targets only, no depth rule.
static func _at_column_targets(att_col: int, cells: Array, n: int) -> Array[int]:
    var target_col := -1
    if _has_armour_in_col(att_col, cells):
        target_col = att_col
    else:
        var best_dist := 999
        for c in range(5):
            if c == att_col: continue
            var dist := abs(c - att_col)
            if _has_armour_in_col(c, cells):
                if dist < best_dist or (dist == best_dist and (target_col < 0 or c < target_col)):
                    best_dist = dist
                    target_col = c
    if target_col < 0:
        return []
    var all_in_col := _column_targets(target_col, 0, cells)
    var armoured: Array[int] = []
    for idx in all_in_col:
        if ARMOURED_TARGET_TYPES.has(cells[idx].get("unit_type", "")):
            armoured.append(idx)
    return armoured.slice(0, n) if n > 0 else armoured

# Priority-based full-grid scan. Uses default priority list (perk overrides not available client-side).
# Ignores row/col position entirely.
static func _sniper_targets(cells: Array, n: int) -> Array[int]:
    const PRIORITY := ["sniper","force_recon_sniper","flamethrower","recon_infantry",
                       "mg","at_gun","at_gun_sp","at_infantry","commando","infantry"]
    var result: Array[int] = []
    for utype in PRIORITY:
        if n > 0 and result.size() >= n:
            break
        for i in range(cells.size()):
            if n > 0 and result.size() >= n:
                break
            var cell = cells[i]
            if cell.get("unit_type","") == utype and not cell.get("incapacitated",false) and not cell.get("stealthed",false):
                result.append(i)
    return result

# Client-side arty preview: shows all occupied cells in the target area.
# Uses area_radius=0 (default, no perk awareness) and the cell_index column as center.
# This is a preview approximation — actual center_col is determined server-side by seeded RNG.
static func _artillery_area_targets(att_cell_index: int, cells: Array, n: int) -> Array[int]:
    # Default: show own column as potential target area (radius=0 approximation)
    var center_col := att_cell_index % 5
    var area_radius := 0  # TODO: pass researched area_radius from client state in Branch K
    var min_col := max(0, center_col - area_radius)
    var max_col := min(4, center_col + area_radius)
    var result: Array[int] = []
    for col in range(min_col, max_col + 1):
        for row in range(4, -1, -1):  # R5 first
            var idx := row * 5 + col
            var cell = cells[idx]
            if cell.get("unit_type","") != "" and not cell.get("incapacitated",false) and not cell.get("stealthed",false):
                result.append(idx)
                if n > 0 and result.size() >= n:
                    return result
    return result
