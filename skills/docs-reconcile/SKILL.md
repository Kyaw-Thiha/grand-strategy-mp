---
name: docs-reconcile
description: Reconcile maintained documentation after a completed repository change or when a verified mismatch is discovered.
---

# Reconcile Maintained Documentation

Read and follow `docs/AGENTS.md`. Read only the authoritative documents relevant to the
changed or investigated behavior.

Run this workflow once after final implementation and relevant verification:

1. Use the task's changed and investigated files as the primary scope. Use the final diff
   only as supporting evidence so unrelated dirty-worktree changes are preserved.
2. Find likely affected documents through `docs/index.md`, implementation anchors, imports,
   call sites, schemas, tests, and direct links. Do not skim the full documentation tree.
3. Verify affected claims against the final repository state and relevant authoritative
   sources in `docs/`.
4. Update implementation requirements, source anchors, limitations, and design links only
   where the completed work or user decision materially changes them.
5. Mark authoritative checkboxes complete only when implementation and verification
   support them. Do not alter confirmed design to accommodate accidental code drift.
6. Repair affected index entries and incoming or outgoing links.
7. Run `python3 scripts/check-docs.py`.

In the final handoff, report documents created, updated, moved, or removed; checkbox changes;
link repairs; and unresolved design or implementation mismatches.
