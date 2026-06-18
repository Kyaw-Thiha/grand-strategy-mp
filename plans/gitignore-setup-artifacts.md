# Gitignore Setup Artifacts Plan

## Goal

Ignore local setup artifacts in the subfolders where they are created.

## Phases

1. Inspect existing subfolder ignore files.
2. Add ignore entries for accidental cross-package-manager lockfiles and backup files.
3. Verify `git status` reflects the new ignore rules.
