# Maintained Documentation Guide

`docs/` is the maintained source of truth for intended game behavior, implementation
requirements, roadmap state, technical contracts, and completion tracking.

## Rules

- Read only the source documents relevant to the requested feature.
- Implement confirmed requirements as written. If code or an ordinary wiki note disagrees,
  treat that as a defect or explicitly report the mismatch.
- Do not rewrite requirements merely to describe accidental implementation drift.
- A user request may amend the design; update the affected source text so the new decision
  becomes durable.
- Mark a checkbox complete only after verifying the implementation and the smallest relevant
  automated or manual checks.
- Reopen or correct a checkbox when repository evidence proves the recorded state is wrong.
- Preserve meaningful design rationale, constraints, cross-system relationships, and
  acceptance criteria.
- Use relative Markdown links such as `[Air Combat Design](AIR_COMBAT.md)`.
- Keep implementation detail when it is a required design contract. Keep implementation
  anchors selective and verify referenced paths and symbols.

Do not create temporary implementation plans here. Use the repository's `plans/` tree when
a persistent plan is explicitly required.
