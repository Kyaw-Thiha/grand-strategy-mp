---
name: wiki-reconcile
description: Reconcile the canonical wiki after a completed repository change or when a verified mismatch is discovered.
---

# Reconcile Repository Knowledge

Read and follow `wiki/AGENTS.md`. Read `wiki/docs/AGENTS.md` when authoritative designs,
requirements, roadmap items, or checkboxes are affected.

Run this workflow once after final implementation and relevant verification:

1. Use the task's changed and investigated files as the primary scope. Use the final diff
   only as supporting evidence so unrelated dirty-worktree changes are preserved.
2. Find likely affected component notes through indexes, implementation anchors, imports,
   call sites, schemas, tests, and direct related notes. Do not skim the full wiki.
3. Verify affected claims against the final repository state and relevant authoritative
   sources in `wiki/docs/`.
4. Update current implementation notes, source anchors, limitations, and design links.
   Correct material verified mismatches; do not edit an accurate note merely to show work.
5. Mark authoritative source checkboxes complete only when implementation and verification
   support them. Do not alter confirmed design to accommodate accidental code drift.
6. Repair affected parent indexes and incoming or outgoing links.
7. Delete the completed colocated `<task>-plan.md` after all durable information has been
   reconciled, then remove it from its component `index.md`.
8. Run `python3 scripts/check-wiki.py`.

In the final handoff, report component notes and source documents created, updated, or
removed; checkbox changes; link repairs; plan deletion; and unresolved mismatches. Do not
create a persistent ingestion log.
