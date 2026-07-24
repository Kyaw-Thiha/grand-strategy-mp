# Wiki Documentation Guide

`wiki/` is the canonical developer documentation for this repository. Write it for developers who need to understand what a component owns, what it is responsible for, and how it relates to the rest of the application. Use current code as the authority. Use `old-docs/` only as historical reference and never modify it.

The `.obsidian/` directory is local reader state and is ignored. Do not add or update Obsidian workspace settings, application settings, or themes as documentation changes.

## Required Ingestion

After completing a coherent task that changes source, schemas, configuration, tests, scripts, or assets, use [`skills/ingest/SKILL.md`](../skills/ingest/SKILL.md). Run ingestion once after the final implementation and relevant verification, not after each intermediate edit.

Ingestion must inspect the notes most likely to be affected by the completed change. It does not require a full wiki review. Create, update, move, rename, split, or remove notes when required to keep the affected documentation accurate, then repair the associated links and index entries.

## Note Format

Every ordinary documentation note uses this order:

```md
# Title

[A concise, product/design-oriented description of what this system means in the game: what a player can do with it, what game behavior it controls, or why it exists. Use plain language.]

# Details

## [Specific concern]

[Implementation, interfaces, data contracts, lifecycle, constraints, limitations, and operational information.]

# Related Notes

- [[api-server/index|API Server]]
```

Use `# Details` and `# Related Notes` as level-one headings. Use `##` and `###` only for supporting structure inside Details. Keep the opening concise and game- or player-facing; move ownership, authority boundaries, data flow, and implementation mechanics into Details. Mark behavior accurately as **Current**, **Planned**, or **Deprecated** where that distinction matters. Do not present an older design as current behavior.

## Writing Tone

Write for the game developer and product designer before the infrastructure engineer. Start with what the feature does for the game or player, then explain the technical details needed to change it safely.

- Prefer concrete language such as “Stores preferences a player sets outside a match” over “Owns player-specific local data.”
- Do not lead with terms such as “authoritative,” “replicated,” “presentation layer,” “contract,” or “client-side.” Use and explain them later only when they prevent a misunderstanding.
- Keep source-of-truth rules, interfaces, files, lifecycle, constraints, and verification details in `# Details`; do not omit them.
- Define unfamiliar technical terms the first time they matter.

## Verified Examples

Examples belong only in `# Details`. Add a short verified example when it materially helps a developer locate or understand the real implementation; do not add examples to openings, indexes, or related-links sections.

- Verify the referenced path, symbol, command, payload, and excerpt against current repository contents.
- Name the source path and the relevant function, class, autoload, route, command, scene, or test, then explain what the small example demonstrates in plain language.
- Prefer five to twenty lines and the appropriate fence language. Do not add filler examples to navigational indexes or policy-only notes.

## Index Format

Every component folder has an `index.md` that describes the component and links to every direct child note and direct child component index:

```md
# Component Title

[A concise, product/design-oriented description of what this component contributes to the game.]

# Wiki

- [[api-server/database|Database and RLS]]
- [[api-server/index|API Server]]

# Related Notes

- [[api-server/overview|Role and Boundaries]]
```

The root `wiki/index.md` follows the same structure. Keep the index description concise. `# Wiki` is the authoritative list of the folder's direct documentation children; do not list unrelated or nested descendants there.

## Linking Rules

- Add every new, moved, renamed, or removed direct child to its parent index.
- Use explicit path-based Obsidian links such as `[[api-server/database|Database and RLS]]` to avoid ambiguous note resolution.
- Place a note's direct dependencies, related contracts, and parent/component index in `# Related Notes` when they help a reader navigate the subject.
- Repair affected incoming and outgoing links after moving, renaming, splitting, merging, or removing notes.
- Do not add links merely for keyword overlap. Each related link must provide useful navigation.

## Approval Boundary

Update local component notes and their related indexes automatically. When a completed change appears to require altering an architecture-wide, cross-component, or policy-level wiki note, do not change that broader note automatically. At the end of the task, explain the proposed update briefly and ask the user for approval. Do this after final code and local documentation work, not after every intermediate modification.

## Completion Report

Include a short documentation-ingestion report in the final response to the user. State which notes were created, updated, moved, or left unchanged; mention link repairs; and identify any broader documentation update awaiting approval. Do not create a persistent ingestion log unless the user asks for one.
