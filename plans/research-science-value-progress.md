# Research Science Value Progress

## Summary

Replace time-duration research costs with integer `science_value` costs. For the current prototype, active research gains science progress at a fixed rate of 1 science value per second.

## Key Changes

- Rename authored card field `duration_seconds` to `science_value`.
- Store progress as science points, not elapsed seconds.
- Add a local prototype constant `SCIENCE_VALUE_PER_SECOND = 1.0` in `ResearchSystem`.
- Keep the existing one-active-research, paused progress, row unlock, completion, and exclusive-group behavior.

## Test Plan

- Update research system tests to use integer science values.
- Confirm 0.5 seconds advances a 1-science node to 50%.
- Confirm a 1-science node completes after 1 second at the default speed.
- Run the static research scene regression.
