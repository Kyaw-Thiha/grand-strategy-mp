# API Server Documentation and Cleanup

## Goal

Document the live `api-server` implementation in the Obsidian wiki and record a
prioritized cleanup backlog. Current code is authoritative; legacy API features
are clearly marked as planned or deferred.

## Phases

1. Create `wiki/api-server/` domain pages for overview, authentication, profile,
   lobby, internal routes, database, and development.
2. Link the API server from `wiki/index.md` and cross-link related pages.
3. Add a backlog covering security, correctness, architecture, operations, and
   testability improvements without changing application code.
4. Verify links, route accuracy, secret-free documentation, and available API
   tests.

## Constraints

- Preserve existing `old-docs/` and unrelated worktree changes.
- Describe current route paths and response shapes exactly as implemented.
- Do not present legacy Steam, division, shop, or rich session APIs as live.
- Do not include credential values in documentation.
