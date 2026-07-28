# Authoritative Design Source Guide

Files in this directory are the source of truth for intended game behavior, implementation
requirements, roadmap state, and completion tracking.

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
- Use vault-relative links such as `[[docs/AIR_COMBAT|Air Combat Design]]`.
- Keep implementation detail in these sources when it is a required design contract; put
  fast current-code orientation and source anchors in the ordinary component wiki notes.

Do not create implementation plans here. Colocate an active `<task>-plan.md` with the
ordinary component notes that own the work, and delete it after completion.
