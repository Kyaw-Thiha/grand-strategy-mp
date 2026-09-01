extends PanelContainer
## Economy panel — side-docked. Resources tab shows real net rates + bar-fill against
## Warehouse's storage cap, an "!" marker on Oil only when its penalty is actively biting,
## and a Manpower row (plain available/ceiling text, not bar-fill — not tradeable). Industry
## tab exposes the national Industry Pool allocation sliders.

signal close_requested()

const _CONTENT_PATH: String = "Margin/VBox/ContentBody"
const RESOURCE_ORDER := ["money", "grain", "iron", "oil", "rubber",
	"nitrates", "tungsten", "chromium", "aluminium", "uranium"]
# Common / Restricted / National grouping per plans/economy_production_ui_handoff.md §4 Tab 2.
const COMMON_SLICES := ["money", "grain", "iron"]
const RESTRICTED_SLICES := ["oil", "rubber", "nitrates", "tungsten", "chromium", "aluminium", "uranium"]
const NATIONAL_SLICES := ["construction_speed", "unit_production_speed"]

@onready var _close_button: Button = %CloseButton
@onready var _resources_list: VBoxContainer = %ResourcesList
@onready var _industry_list: VBoxContainer = %IndustryList
@onready var _my_trade_list: VBoxContainer = %MyTradeList

# slice_key -> value, for every slice (visible or not) — always sums to 100 across the
# currently-VISIBLE slices only (hidden restricted slices a nation lacks access to stay fixed
# at 0 and aren't part of the pool a player can actually move). ECONOMY_BUILDINGS.md's Industry
# Pool frames this as allocating a single pool via percentage slices — the server's
# SET_INDUSTRY_ALLOCATION handler already rejects any submission that doesn't sum to 100.
var _local_alloc: Dictionary = {}
var _sliders: Dictionary = {} # slice_key -> HSlider
var _value_labels: Dictionary = {} # slice_key -> Label
var _visible_slice_keys: Array = []
var _rebalancing: bool = false # re-entrancy guard while programmatically adjusting other sliders
var _industry_seeded: bool = false # true once sliders have been built from a real server snapshot


func _ready() -> void:
	_close_button.pressed.connect(func() -> void: close_requested.emit())
	_setup_tab_buttons()
	EventBus.resources_updated.connect(_refresh_resources)
	EventBus.resources_updated.connect(_on_resources_updated_for_industry_seed)
	_refresh_resources()
	_build_industry_sliders()
	EventBus.market_updated.connect(_refresh_my_trade)
	EventBus.trade_routes_updated.connect(_refresh_my_trade)
	_refresh_my_trade()


## GameState.industry_alloc may still be empty (schema default) the first time this panel's
## _ready() runs, if it opens before the first RESOURCE_UPDATES snapshot arrives. Rebuild once
## from the first real snapshot so sliders don't get stuck showing a stale all-zero state;
## never rebuild again afterward, so a player's in-progress drag is never fought/reset by a
## routine economy tick.
func _on_resources_updated_for_industry_seed() -> void:
	if _industry_seeded:
		return
	if GameState.industry_alloc.is_empty():
		return
	_industry_seeded = true
	_build_industry_sliders()


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


func _refresh_resources() -> void:
	for child in _resources_list.get_children():
		child.queue_free()

	for res_type: String in RESOURCE_ORDER:
		var amount: float = GameState.resources.get(res_type, 0.0)
		var rate: float = GameState.resource_net_rates.get(res_type, 0.0)
		var cap: float = GameState.resource_storage_cap.get(res_type, 0.0)

		var row := HBoxContainer.new()
		var name_label := Label.new()
		name_label.custom_minimum_size = Vector2(90, 0)
		name_label.text = res_type.capitalize()
		row.add_child(name_label)

		var amount_label := Label.new()
		amount_label.custom_minimum_size = Vector2(60, 0)
		amount_label.text = str(int(amount))
		row.add_child(amount_label)

		var rate_label := Label.new()
		rate_label.custom_minimum_size = Vector2(60, 0)
		var rate_text := "%s%d/t" % ["+" if rate >= 0 else "", int(rate)]
		# Oil's "!" marker — only when the penalty is actively biting, never for low stock alone.
		if res_type == "oil" and GameState.oil_penalty_active:
			rate_text += "  !"
		rate_label.text = rate_text
		row.add_child(rate_label)

		if cap > 0:
			var bar := ProgressBar.new()
			bar.custom_minimum_size = Vector2(80, 16)
			bar.max_value = cap
			bar.value = amount
			bar.show_percentage = false
			row.add_child(bar)

		_resources_list.add_child(row)

	# Manpower — plain available/ceiling text, no bar-fill (not tradeable, not one of the ten).
	var manpower_row := Label.new()
	manpower_row.text = "Manpower avail: %d / %d" % [int(GameState.manpower_available), int(GameState.manpower_ceiling)]
	_resources_list.add_child(manpower_row)


func _build_industry_sliders() -> void:
	for child in _industry_list.get_children():
		child.queue_free()
	_sliders.clear()
	_value_labels.clear()
	_visible_slice_keys.clear()

	# Seed local state from the server's current allocation (always sums to 100 — the server
	# seeds a valid default at nation init and rejects anything that doesn't sum to 100).
	for key: String in COMMON_SLICES + RESTRICTED_SLICES + NATIONAL_SLICES:
		_local_alloc[key] = GameState.industry_alloc.get(key, 0.0)

	# National first per user-confirmed layout, then Common, then Restricted.
	_add_slider_group("NATIONAL", NATIONAL_SLICES)
	_add_slider_group("COMMON", COMMON_SLICES)
	_add_slider_group("RESTRICTED", RESTRICTED_SLICES)

	var reset_margin := MarginContainer.new()
	reset_margin.add_theme_constant_override("margin_top", 10)
	var reset_btn := Button.new()
	reset_btn.text = "Reset to Default"
	reset_btn.pressed.connect(_on_reset_pressed)
	reset_margin.add_child(reset_btn)
	_industry_list.add_child(reset_margin)


func _add_slider_group(header_text: String, slices: Array) -> void:
	var header_margin := MarginContainer.new()
	header_margin.add_theme_constant_override("margin_top", 10)
	header_margin.add_theme_constant_override("margin_bottom", 4)
	var header := Label.new()
	header.text = header_text
	header_margin.add_child(header)
	_industry_list.add_child(header_margin)

	for slice_key: String in slices:
		# Restricted slices only shown if this nation has meaningful deposits somewhere —
		# approximated here via nonzero current stockpile or nonzero storage cap, since the
		# client doesn't have per-province deposit data readily aggregated at this panel.
		if RESTRICTED_SLICES.has(slice_key):
			var has_access: bool = GameState.resources.get(slice_key, 0.0) > 0.0 or GameState.resource_storage_cap.get(slice_key, 0.0) > 0.0
			if not has_access:
				continue

		_visible_slice_keys.append(slice_key)

		var row := HBoxContainer.new()
		var name_label := Label.new()
		name_label.custom_minimum_size = Vector2(140, 0)
		name_label.text = slice_key.capitalize().replace("_", " ")
		row.add_child(name_label)

		var slider := HSlider.new()
		slider.custom_minimum_size = Vector2(120, 0)
		slider.min_value = 0
		slider.max_value = 100
		slider.step = 1
		slider.value = _local_alloc.get(slice_key, 0.0)
		slider.value_changed.connect(_on_slider_value_changed.bind(slice_key))
		slider.drag_ended.connect(func(_changed: bool) -> void: _submit_allocation())
		row.add_child(slider)
		_sliders[slice_key] = slider

		var value_label := Label.new()
		value_label.custom_minimum_size = Vector2(40, 0)
		value_label.text = "%d%%" % int(round(slider.value))
		row.add_child(value_label)
		_value_labels[slice_key] = value_label

		_industry_list.add_child(row)


## Keeps every VISIBLE slider's total pinned at 100% — moving one slider proportionally
## rescales every other visible slider so the pool always sums to 100, matching
## ECONOMY_BUILDINGS.md's "allocates this pool" framing and the server's reject-if-not-100 rule.
func _on_slider_value_changed(new_value: float, changed_key: String) -> void:
	if _rebalancing:
		return
	_rebalancing = true

	_local_alloc[changed_key] = new_value
	_value_labels[changed_key].text = "%d%%" % int(round(new_value))

	var others: Array = _visible_slice_keys.filter(func(k: String) -> bool: return k != changed_key)
	var remaining: float = 100.0 - new_value
	var others_sum: float = 0.0
	for k: String in others:
		others_sum += float(_local_alloc.get(k, 0.0))

	if others.size() > 0:
		if others_sum > 0.001:
			var scale: float = remaining / others_sum
			for k: String in others:
				var v: float = clampf(float(_local_alloc.get(k, 0.0)) * scale, 0.0, 100.0)
				_local_alloc[k] = v
				_sliders[k].value = v
				_value_labels[k].text = "%d%%" % int(round(v))
		else:
			var each: float = remaining / others.size()
			for k: String in others:
				_local_alloc[k] = each
				_sliders[k].value = each
				_value_labels[k].text = "%d%%" % int(round(each))

	_rebalancing = false


func _submit_allocation() -> void:
	var full_alloc: Dictionary = {}
	for key: String in COMMON_SLICES + RESTRICTED_SLICES + NATIONAL_SLICES:
		full_alloc[key] = _local_alloc.get(key, 0.0)
	CommandQueue.submit("SET_INDUSTRY_ALLOCATION", {"allocations": full_alloc})


func _on_reset_pressed() -> void:
	# Default: split between money production and construction speed (ECONOMY_BUILDINGS.md's
	# documented default) — exact split is a placeholder, 50/50 here.
	for key: String in COMMON_SLICES + RESTRICTED_SLICES + NATIONAL_SLICES:
		_local_alloc[key] = 0.0
	_local_alloc["money"] = 50.0
	_local_alloc["construction_speed"] = 50.0
	CommandQueue.submit("SET_INDUSTRY_ALLOCATION", {"allocations": _local_alloc.duplicate()})
	_build_industry_sliders()


## Tab 3 — My Trade. Deliberately narrow scope, per plans/economy_production_ui_handoff.md §4
## Tab 3: only this player's own resting spot orders (with Cancel) and a read-only mirror of
## their trade routes. Not a market browser (that's the Market modal) and not where routes are
## created or ended (that's Diplomacy → Trade Routes).
func _refresh_my_trade() -> void:
	for child in _my_trade_list.get_children():
		child.queue_free()

	var header := Label.new()
	header.text = "MY SPOT ORDERS"
	_my_trade_list.add_child(header)

	var my_orders: Array = GameState.get_my_market_orders()
	if my_orders.is_empty():
		var empty_label := Label.new()
		empty_label.text = "No open orders."
		_my_trade_list.add_child(empty_label)
	else:
		for order: Dictionary in my_orders:
			var row := HBoxContainer.new()
			var side_text: String = "Sell" if order.get("side", "") == "sell" else "Buy"
			var label := Label.new()
			label.text = "%s  %s  %d @ %.2f" % [
				side_text, str(order.get("resource_type", "")).capitalize(),
				int(order.get("quantity", 0)), float(order.get("price", 0.0)),
			]
			row.add_child(label)
			var cancel_btn := Button.new()
			cancel_btn.text = "Cancel"
			cancel_btn.pressed.connect(_on_cancel_order_pressed.bind(str(order.get("order_id", ""))))
			row.add_child(cancel_btn)
			_my_trade_list.add_child(row)

	var market_link_btn := Button.new()
	market_link_btn.text = "Market"
	market_link_btn.pressed.connect(func() -> void: EventBus.market_panel_open_requested.emit())
	_my_trade_list.add_child(market_link_btn)

	var routes_header := Label.new()
	routes_header.text = "TRADE ROUTES  (read-only — manage in Diplomacy)"
	_my_trade_list.add_child(routes_header)

	var my_routes: Array = GameState.get_my_trade_routes()
	if my_routes.is_empty():
		var empty_routes := Label.new()
		empty_routes.text = "No trade routes."
		_my_trade_list.add_child(empty_routes)
	else:
		var my_nation_id: String = GameState.get_my_nation_id()
		for route: Dictionary in my_routes:
			var partner_id: String = route.get("nation_b_id", "") if route.get("nation_a_id", "") == my_nation_id else route.get("nation_a_id", "")
			var status: String = str(route.get("status", ""))
			var route_row := Label.new()
			route_row.text = "-> %s   %s" % [partner_id.capitalize(), status.capitalize()]
			_my_trade_list.add_child(route_row)


func _on_cancel_order_pressed(order_id: String) -> void:
	CommandQueue.submit("CANCEL_MARKET_ORDER", {"order_id": order_id})
