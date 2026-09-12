extends Control
class_name ResearchMutexBracket
## Gold double-border box + connecting bracket wrapping a mutex tier's option cards
## (RESEARCH_UI_HANDOFF.md §5.1 — "choose one — this tier only, respec available later").
## No existing precedent for this shape anywhere in the codebase (confirmed by investigation
## for phase-11-task-c) — kept intentionally simple: a double-rect border plus a couple of
## short tick lines under the box pointing down at each option's x-center.

## Number of options this bracket spans — purely informational/documentation here; the actual
## tick positions come from `set_option_centers()` since a Control cannot know its siblings'
## final laid-out positions until after the parent's own _ready()/layout pass.
@export var option_count: int = 2

const _GOLD := Color(0.84, 0.68, 0.30)
const _OUTER_BORDER_WIDTH: float = 3.0
const _INNER_BORDER_WIDTH: float = 1.0
const _INNER_INSET: float = 5.0
const _TICK_LENGTH: float = 10.0

## Local-space x-coordinates (relative to this control's own position) of each option column's
## center, set by the parent once mutex option cards are laid out beneath this bracket.
var _tick_x_positions: Array[float] = []


## Records where each option's tie-line should drop from the bracket's bottom edge.
## Parameters:
## - tick_x_positions: local-space x offsets (one per option) to draw a short downward tick at.
## Returns: nothing.
func set_option_centers(tick_x_positions: Array[float]) -> void:
	_tick_x_positions = tick_x_positions
	queue_redraw()


func _draw() -> void:
	# Double-border box — the mutex tier's one true structural exception (not a badge, not a
	# size choice), per RESEARCH_UI_HANDOFF.md §5.1.
	draw_rect(Rect2(Vector2.ZERO, size), _GOLD, false, _OUTER_BORDER_WIDTH)
	draw_rect(
		Rect2(Vector2(_INNER_INSET, _INNER_INSET), size - Vector2(_INNER_INSET * 2.0, _INNER_INSET * 2.0)),
		_GOLD,
		false,
		_INNER_BORDER_WIDTH,
	)
	# Bracket ticks connecting the tier's option columns below the box.
	for tick_x: float in _tick_x_positions:
		draw_line(
			Vector2(tick_x, size.y),
			Vector2(tick_x, size.y + _TICK_LENGTH),
			_GOLD,
			_OUTER_BORDER_WIDTH,
		)
