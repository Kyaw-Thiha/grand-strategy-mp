# Wiki Documentation Guide

`wiki/` is the repository's single documentation tree and Obsidian vault. It contains
authoritative design sources, concise implementation-facing notes, and temporary plans.
Do not add or change `.obsidian/` workspace, application, or theme state.

## Document Classes

### Authoritative sources

`wiki/docs/` defines intended behavior, implementation requirements, roadmap state, and
completion checkboxes. Follow `wiki/docs/AGENTS.md` when reading or changing those files.
When an implementation or ordinary wiki note disagrees with a confirmed source document,
the source document wins.

### Implementation notes

Ordinary component notes explain what the current repository actually does and where it is
implemented. They are optimized for a developer, product designer, or LLM that needs useful
context without loading the full source documents or codebase.

### Temporary plans

`wiki/plans/` contains decision-complete plans for active work. Follow
`wiki/plans/AGENTS.md`. Delete a completed plan after its durable facts have been reconciled
into source documents and implementation notes.

## Required Reconciliation

After a coherent change to source, schemas, configuration, tests, scripts, or assets, follow
`skills/wiki-reconcile/SKILL.md` once after final implementation and verification.

Also reconcile documentation when investigation reveals a material, confidently verified
mismatch. Correct factual implementation notes automatically. Do not rewrite authoritative
design requirements to accommodate accidental code drift; report or fix the drift instead.

Keep reconciliation scoped to the changed or investigated behavior. Use the task's known
file list as primary scope and the repository diff as supporting evidence so unrelated dirty
worktree changes are not absorbed.

## Ordinary Note Format

Use this top-level order:

```md
# Title

[Short player- or product-facing description.]

# Details

## Current behavior

[Implementation, lifecycle, interfaces, constraints, and limitations.]

## Implementation anchors

- `path/to/file` — relevant class, function, scene, route, command, or test.

# Related Notes

- [[component/index|Parent Component]]
- [[docs/DESIGN_SOURCE|Authoritative Design Source]]
```

Requirements:

- Use `# Details` and `# Related Notes` as level-one headings.
- Use `##` and `###` only inside Details.
- Start with what the system means for the player or game, then explain ownership and
  implementation mechanics.
- Label behavior **Current**, **Planned**, or **Deprecated** wherever its state could be
  misunderstood.
- Keep implementation anchors selective: normally three to eight entry points, contracts,
  or tests. Verify every referenced path and symbol.
- Add short verified examples only when they materially improve understanding.

## Index Format

Every component folder has an `index.md`:

```md
# Component

[Concise description.]

# Wiki

- [[component/child|Child Note]]
- [[component/subcomponent/index|Subcomponent]]

# Related Notes

- [[other-component/index|Related Component]]
```

`# Wiki` lists every direct child note and direct child component index, excluding agent
instruction files. Do not list nested descendants or unrelated notes.

## Links and Restructuring

- Use vault-relative Obsidian links such as
  `[[client/networking/commands-state-and-events|Commands, State, and Events]]`.
- Link ordinary notes to the authoritative design sources that govern them.
- Update a parent index whenever a direct child is added, moved, renamed, or removed.
- Repair affected incoming and outgoing links after restructuring.
- Related links must provide useful navigation, not mere keyword overlap.
- Preserve existing source-document filenames unless a rename has a concrete benefit.

## Source and Design Updates

Current code establishes what is presently implemented, but it does not override confirmed
design. If current code is behind or contradicts `wiki/docs/`, document the implementation
truth as a clearly labelled gap and treat the source design as the required outcome.

After implementing a documented feature, update its source checklist only when repository
evidence and relevant verification support completion. Change requirement prose only when
the user's request changes the design or a clarification is necessary to implement it
correctly.

## Completion Report

Report notes and source documents created, updated, moved, or removed; plan deletion; link
repairs; checklist changes; and any unresolved design/implementation mismatch. Do not create
a persistent ingestion log.
