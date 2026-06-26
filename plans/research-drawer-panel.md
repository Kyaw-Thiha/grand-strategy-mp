# Research Drawer Panel

## Summary
Make the RESearch dock button open a side drawer like Economy, Military, and Diplomacy. The drawer lists only currently runnable research entries and can open the full research tree.

## Key Changes
- Add a side-docked research drawer panel.
- Keep the existing full research tree as a separate center panel.
- Share the existing `ResearchSystem` from the full tree with the drawer so progress does not reset or diverge.
- Sort drawer entries by level descending and start research when a drawer entry is clicked.

## Test Plan
- Run headless validation for game HUD, map debug, and research tree scenes.
- Smoke test drawer open, entry click, progress preservation, and full tree navigation.
