# Lobby Nation Flag Preview Plan

## Goal

Show a server-confirmed selected nation flag at the bottom-left of the lobby country selection screen.

## Phases

1. Add flag paths to map-specific nation metadata.
2. Propagate lobby map id to the client so the lobby can load the correct nation metadata.
3. Replace hardcoded lobby nation labels with `nations.json` metadata and add the flag preview UI.
4. Verify syntax and inspect diffs.
