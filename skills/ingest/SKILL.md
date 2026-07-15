---
name: ingest
description: Keep the canonical repository wiki accurate after a completed coherent change to source code, schemas, configuration, tests, scripts, or assets. Use after final implementation and relevant verification to inspect likely affected wiki notes, create or revise documentation, restructure notes when needed, and repair affected Obsidian links and indexes.
---

# Ingest Completed Changes into the Wiki

Read `wiki/AGENTS.md` before working. It is the canonical repository policy for wiki ownership, links, approval boundaries, and final reporting.

Run this skill once after the final code, schema, configuration, test, script, or asset changes for a coherent task are complete. Do not run it after each intermediate edit. Do not modify `old-docs/`; it is historical reference only.

## Workflow

1. Inspect the completed task's final diff and changed files. Identify the changed behavior, owned data, public or internal interfaces, configuration, tests, and runtime dependencies.
2. Find the likely affected wiki notes from the changed path, imports and call sites, schema/contract references, and the current component index. Read those notes and their direct related notes only. Do not perform a full wiki skim.
3. Decide whether each affected note is still accurate, needs revision, must be created, or should be moved, renamed, split, merged, or retired. Treat current code as authoritative; mark incomplete or future work as **Planned**, and obsolete behavior as **Deprecated** when useful.
4. Update the affected notes so a developer can first understand responsibility, owned data, scope, and application role. Put implementation mechanics, interfaces, lifecycle, constraints, and limitations in Details.
5. Update the relevant parent indexes and repair links affected by the documentation changes. Check direct incoming and outgoing links for every note that was created, moved, renamed, split, merged, or removed.
6. If the change appears to affect an architecture-wide, cross-component, or policy-level note, leave that broader note unchanged. Finish the local ingest work, then ask the user for approval to make the broader documentation update.
7. In the final handoff, provide a brief ingestion report: notes created/updated/moved or deliberately left unchanged, link repairs, and any broader update awaiting approval. Do not write a persistent ingestion log.

## Ordinary Note Format

Use this exact top-level order for every non-index note:

```md
# Title

[Concise, responsibility-first description. State what the subject is responsible for, the data it owns when applicable, and its role in the application. Write for developers. Do not lead with frameworks, libraries, or implementation mechanics.]

# Details

## [Topic]

[Implementation details, interfaces, data contracts, lifecycle, constraints, limitations, and operational guidance.]

# Related Notes

- [[component/index|Parent component]]
- [[other-component/related-note|Directly related note]]
```

Requirements:

- Use `# Details` and `# Related Notes` as level-one headings.
- Use `##` and `###` only under Details.
- Keep the opening short, concrete, and responsibility-first. For example, describe a database note by the records it contains and excludes before describing its ORM or driver.
- Put explicit **Current**, **Planned**, or **Deprecated** labels near behavior whose implementation state could be misunderstood.
- Keep Related Notes at the end and include only useful navigational links.

## Index Format

Use this format for `index.md` files:

```md
# Component Title

[Concise responsibility and scope description for the component.]

# Wiki

- [[component/child-note|Child note]]
- [[component/subcomponent/index|Subcomponent]]

# Related Notes

- [[other-component/index|Related component]]
```

Requirements:

- List every direct child note and direct child component index under `# Wiki`.
- Do not list unrelated notes or nested descendants as direct children.
- Keep `# Related Notes` at the end for cross-component navigation.

## Link and Scope Checks

- Prefer explicit path-based Obsidian links: `[[api-server/database|Database and RLS]]`.
- Update a parent index whenever its direct child is added, moved, renamed, or removed.
- Repair affected links when restructuring notes; do not rely on Obsidian alone to preserve repository links.
- Keep documentation changes limited to the affected component and its direct relationships. A future lint skill will perform broad link and content audits.
- If a likely affected note remains accurate, do not edit it solely to show activity; mention it as reviewed and unchanged in the final report.
