class_name ResearchCardStyle
extends RefCounted
## Shared badge glyph map + four-state color/style logic for research node cards.
## Used by both research_drawer_panel.gd (sidebar cards) and research_entry_card.gd (Full Tree
## cards) so the two surfaces never drift on what "Researching" vs "Available" looks like.
## See plans/phase-11/RESEARCH_UI_HANDOFF.md §5 for the visual spec this implements.

## Composable badges (RESEARCH_UI_HANDOFF.md §5.1) — any combination may appear on one node.
const BADGE_GLYPHS := {
	"mechanic": "⚙",
	"lineage": "▣",
	"redistribute": "⇄",
	"additive": "➕",
}

const STATE_AVAILABLE := "available"
const STATE_RESEARCHING := "researching"
const STATE_RESEARCHED := "researched"
const STATE_LOCKED := "locked"

const BADGE_FONT_SIZE: int = 13
const BADGE_SEPARATION: int = 2


## Builds a compact row of badge glyph labels for the given badge-type array.
## Parameters:
## - badges: array of badge-type strings (any of BADGE_GLYPHS's keys); unknown types render "?".
## Returns: an HBoxContainer ready to add_child() onto a card layout, or a hidden empty one
## when badges is empty (callers can add it unconditionally without branching).
static func build_badge_row(badges: Array) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", BADGE_SEPARATION)
	row.visible = not badges.is_empty()
	for badge_type: Variant in badges:
		var glyph := Label.new()
		glyph.text = BADGE_GLYPHS.get(String(badge_type), "?")
		glyph.add_theme_font_size_override("font_size", BADGE_FONT_SIZE)
		row.add_child(glyph)
	return row


## Returns the four-state card frame style. Mutex containers use a different shape entirely
## (research_mutex_bracket.gd) — this only covers the four orthogonal node states applied on
## top of any single card (RESEARCH_UI_HANDOFF.md §5.2).
## Parameters:
## - state: one of STATE_AVAILABLE / STATE_RESEARCHING / STATE_RESEARCHED / STATE_LOCKED.
## Returns: configured StyleBoxFlat for the card's "panel" stylebox override.
static func make_state_style(state: String) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	match state:
		STATE_AVAILABLE:
			style.bg_color = Color(0.12, 0.08, 0.05, 0.96)
			style.border_color = Color(0.84, 0.68, 0.30) # amber, solid
		STATE_RESEARCHING:
			style.bg_color = Color(0.14, 0.10, 0.05, 0.98)
			style.border_color = Color(0.90, 0.72, 0.20) # amber, brighter — the animated
				# progress-bar fill widget carries the "in progress" motion; this frame color
				# just distinguishes the card from static Available.
		STATE_RESEARCHED:
			style.bg_color = Color(0.12, 0.16, 0.10, 0.96)
			style.border_color = Color(0.42, 0.62, 0.32) # green, filled
		STATE_LOCKED:
			style.bg_color = Color(0.08, 0.06, 0.04, 0.40) # desaturated, ~40% opacity per spec
			style.border_color = Color(0.22, 0.16, 0.09, 0.30) # dim, no border emphasis
		_:
			style.bg_color = Color(0.08, 0.06, 0.04, 0.72)
			style.border_color = Color(0.22, 0.16, 0.09, 0.65)
	return style


## Returns the modulate tint applied to the whole card for a given state (Locked dims further
## via modulate on top of the low-opacity stylebox, matching the pre-Branch-C convention).
## Parameters:
## - state: one of the STATE_* constants.
## Returns: Color to assign to the card's `modulate` property.
static func make_state_modulate(state: String) -> Color:
	if state == STATE_LOCKED:
		return Color(0.66, 0.60, 0.50, 1.0)
	return Color.WHITE


## Maps a research_system.gd runtime state string ("full_dark"/"dark"/"normal") plus the
## is_active flag onto one of this file's four orthogonal STATE_* constants.
## Parameters:
## - legacy_state: research_system.gd's STATE_UNAVAILABLE/STATE_AVAILABLE/STATE_RESEARCHED.
## - is_active: whether this node is the entry currently being researched.
## Returns: one of STATE_AVAILABLE / STATE_RESEARCHING / STATE_RESEARCHED / STATE_LOCKED.
static func resolve_state(legacy_state: String, is_active: bool) -> String:
	if legacy_state == "normal":
		return STATE_RESEARCHED
	if legacy_state == "full_dark":
		return STATE_LOCKED
	if is_active:
		return STATE_RESEARCHING
	return STATE_AVAILABLE
