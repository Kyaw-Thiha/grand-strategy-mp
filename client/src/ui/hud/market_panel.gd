extends PanelContainer
## Market — FULL_CENTER modal. One column per tradeable resource (all nine restricted+common
## non-money resources, regardless of whether this nation produces or has access to them — the
## opposite curation rule from the top bar's flyout, per
## plans/economy_production_ui_handoff.md §5). Each column shows the top 3 opposite-side
## resting orders plus a minimal inline "+ Add offer" form. Built entirely in code, following
## the same popup-panel pattern as air_wing_spawn_panel.gd (no .tscn).

signal close_requested()

# Money is the trade medium, not itself a tradeable column — matches the server's
# PLACE_MARKET_ORDER validation (TEN_RESOURCES minus "money").
const TRADEABLE_RESOURCES := ["grain", "iron", "oil", "rubber", "nitrates",
	"tungsten", "chromium", "aluminium", "uranium"]

# Symmetric spread penalty burned on every completed spot-market trade, applied independently
# to both legs (seller nets less, buyer pays more) — RESOURCE_ECONOMY.md documents a 10-20%
# range; must match SPOT_SPREAD_PCT in game-server/src/systems/market_system.ts exactly.
const MARKET_SPREAD_PCT := 0.15

var _columns_row: HBoxContainer
var _open_offer_forms: Dictionary = {}  # resource_type -> {"buy": Control, "sell": Control}


func _ready() -> void:
	var margin := MarginContainer.new()
	margin.name = "Margin"
	margin.add_theme_constant_override("margin_left", 14)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_bottom", 14)
	margin.size_flags_horizontal = 3
	margin.size_flags_vertical = 3
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.size_flags_horizontal = 3
	vbox.size_flags_vertical = 3
	vbox.add_theme_constant_override("separation", 10)
	margin.add_child(vbox)

	var header := HBoxContainer.new()
	vbox.add_child(header)
	var title := Label.new()
	title.text = "MARKET"
	title.size_flags_horizontal = 3
	title.add_theme_font_size_override("font_size", 18)
	header.add_child(title)
	var close_btn := Button.new()
	close_btn.text = "X"
	close_btn.custom_minimum_size = Vector2(28, 28)
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	header.add_child(close_btn)

	# Explicit fee disclosure — the market's spread/commission is a real, non-obvious cost on
	# every trade, so it's surfaced here once rather than buried in each column.
	var fee_note := Label.new()
	fee_note.text = "Market fee: %d%% spread, taken from both sides of every completed trade (sellers receive %d%%, buyers pay %d%% of the trade price)" % [
		int(round(MARKET_SPREAD_PCT * 100.0)),
		int(round((1.0 - MARKET_SPREAD_PCT) * 100.0)),
		int(round((1.0 + MARKET_SPREAD_PCT) * 100.0)),
	]
	fee_note.add_theme_font_size_override("font_size", 11)
	fee_note.modulate = Color(1.0, 1.0, 1.0, 0.7)
	fee_note.autowrap_mode = TextServer.AUTOWRAP_WORD
	vbox.add_child(fee_note)

	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = 3
	scroll.size_flags_vertical = 3
	scroll.custom_minimum_size = Vector2(900, 480)
	vbox.add_child(scroll)

	_columns_row = HBoxContainer.new()
	_columns_row.add_theme_constant_override("separation", 10)
	scroll.add_child(_columns_row)

	EventBus.market_updated.connect(_refresh)
	_refresh()


func _refresh() -> void:
	for child in _columns_row.get_children():
		child.queue_free()
	_open_offer_forms.clear()
	for res_type: String in TRADEABLE_RESOURCES:
		_columns_row.add_child(_build_column(res_type))


func _build_column(res_type: String) -> PanelContainer:
	var col := PanelContainer.new()
	col.custom_minimum_size = Vector2(150, 0)
	var col_vbox := VBoxContainer.new()
	col_vbox.add_theme_constant_override("separation", 4)
	col.add_child(col_vbox)

	var title := Label.new()
	title.text = res_type.to_upper()
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col_vbox.add_child(title)

	# BUY section — top 3 lowest sell-offers (what a buyer would pay).
	col_vbox.add_child(_make_section_label("BUY (top 3)"))
	var sell_orders: Array = _orders_for(res_type, "sell")
	sell_orders.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.get("price", 0.0)) < float(b.get("price", 0.0)))
	_add_offer_rows(col_vbox, sell_orders, "buy")
	col_vbox.add_child(_make_add_offer_button(res_type, "buy", col_vbox))

	# SELL section — top 3 highest buy-offers (what a seller would get).
	col_vbox.add_child(_make_section_label("SELL (top 3)"))
	var buy_orders: Array = _orders_for(res_type, "buy")
	buy_orders.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.get("price", 0.0)) > float(b.get("price", 0.0)))
	_add_offer_rows(col_vbox, buy_orders, "sell")
	col_vbox.add_child(_make_add_offer_button(res_type, "sell", col_vbox))

	return col


func _orders_for(res_type: String, side: String) -> Array:
	var result: Array = []
	for order: Dictionary in GameState.market_orders.values():
		if order.get("resource_type", "") == res_type and order.get("side", "") == side:
			result.append(order)
	return result


func _make_section_label(text: String) -> Label:
	var lbl := Label.new()
	lbl.text = text
	lbl.add_theme_font_size_override("font_size", 12)
	return lbl


## Rows shown under the BUY heading list resting SELL orders (my_side = "buy" — clicking the
## row's action button places a matching buy order that fills exactly this resting order); rows
## under SELL list resting BUY orders symmetrically. A row for this player's OWN order is shown
## but its action button is disabled — a nation cannot trade against its own resting order.
func _add_offer_rows(parent: VBoxContainer, orders: Array, my_side: String) -> void:
	if orders.is_empty():
		var empty_lbl := Label.new()
		empty_lbl.text = "No offers yet\nBe the first"
		empty_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		parent.add_child(empty_lbl)
		return
	var my_nation_id: String = GameState.get_my_nation_id()
	for i in range(min(3, orders.size())):
		var order: Dictionary = orders[i]
		var is_own_order: bool = order.get("nation_id", "") == my_nation_id
		var row := HBoxContainer.new()
		var lbl := Label.new()
		lbl.text = "%.1f x%d" % [float(order.get("price", 0.0)), int(order.get("quantity", 0))]
		if is_own_order:
			lbl.text += "  (you)"
		lbl.size_flags_horizontal = 3
		row.add_child(lbl)
		var action_btn := Button.new()
		action_btn.text = "Buy" if my_side == "buy" else "Sell"
		action_btn.custom_minimum_size = Vector2(44, 0)
		if is_own_order:
			action_btn.disabled = true
			action_btn.tooltip_text = "This is your own order — cancel it from Economy → My Trade instead."
		else:
			var res_type: String = order.get("resource_type", "")
			var qty: int = int(order.get("quantity", 0))
			var price: float = float(order.get("price", 0.0))
			action_btn.pressed.connect(func() -> void:
				CommandQueue.submit("PLACE_MARKET_ORDER", {
					"resource_type": res_type, "side": my_side, "quantity": qty, "price": price,
				})
			)
		row.add_child(action_btn)
		parent.add_child(row)


## "+ Add offer" — a minimal inline form (quantity + price), not a nested overlay, per
## plans/economy_production_ui_handoff.md §5. Shows a live estimate of what the fee costs so
## the player knows the real net outcome before confirming.
func _make_add_offer_button(res_type: String, side: String, col_vbox: VBoxContainer) -> Control:
	var wrapper := VBoxContainer.new()
	var btn := Button.new()
	btn.text = "+ Add offer"
	wrapper.add_child(btn)

	var form := VBoxContainer.new()
	form.visible = false

	var inputs_row := HBoxContainer.new()
	var qty_spin := SpinBox.new()
	qty_spin.min_value = 1
	qty_spin.max_value = 100000
	qty_spin.value = 10
	qty_spin.custom_minimum_size = Vector2(60, 0)
	inputs_row.add_child(qty_spin)
	var price_spin := SpinBox.new()
	price_spin.min_value = 0.1
	price_spin.max_value = 100000
	price_spin.step = 0.1
	price_spin.value = 1.0
	price_spin.custom_minimum_size = Vector2(60, 0)
	inputs_row.add_child(price_spin)
	var confirm_btn := Button.new()
	confirm_btn.text = "OK"
	inputs_row.add_child(confirm_btn)
	form.add_child(inputs_row)

	var fee_estimate_lbl := Label.new()
	fee_estimate_lbl.add_theme_font_size_override("font_size", 10)
	fee_estimate_lbl.modulate = Color(1.0, 1.0, 1.0, 0.7)
	form.add_child(fee_estimate_lbl)

	var update_fee_estimate := func() -> void:
		var gross: float = qty_spin.value * price_spin.value
		if side == "sell":
			var net: float = gross * (1.0 - MARKET_SPREAD_PCT)
			fee_estimate_lbl.text = "Net if fully filled: %.1f (fee: %.1f)" % [net, gross - net]
		else:
			var total_cost: float = gross * (1.0 + MARKET_SPREAD_PCT)
			fee_estimate_lbl.text = "Total cost incl. fee: %.1f (fee: %.1f)" % [total_cost, total_cost - gross]
	qty_spin.value_changed.connect(func(_v: float) -> void: update_fee_estimate.call())
	price_spin.value_changed.connect(func(_v: float) -> void: update_fee_estimate.call())

	confirm_btn.pressed.connect(func() -> void:
		CommandQueue.submit("PLACE_MARKET_ORDER", {
			"resource_type": res_type, "side": side,
			"quantity": int(qty_spin.value), "price": float(price_spin.value),
		})
		form.visible = false
	)
	wrapper.add_child(form)

	btn.pressed.connect(func() -> void:
		form.visible = not form.visible
		if form.visible:
			update_fee_estimate.call()
	)
	return wrapper
