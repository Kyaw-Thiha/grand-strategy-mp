#!/usr/bin/env python3
"""Validate the maintained documentation tree and internal navigation."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_ROOT = REPO_ROOT / "docs"
INSTRUCTION_FILES = {"AGENTS.md", "CLAUDE.md"}
MARKDOWN_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\((?:<([^>]+)>|([^)]+))\)")
FENCED_BLOCK_RE = re.compile(r"```.*?```", re.DOTALL)


def _relative(path: Path) -> str:
    """Return a stable repository-relative path for diagnostics."""
    return path.relative_to(REPO_ROOT).as_posix()


def _markdown_targets(text: str) -> list[str]:
    """Return angle-bracketed and ordinary Markdown link targets."""
    return [
        angle_target or plain_target
        for angle_target, plain_target in MARKDOWN_LINK_RE.findall(text)
    ]


def _validate_links(markdown_files: list[Path]) -> list[str]:
    """Validate local Markdown links outside fenced examples."""
    errors: list[str] = []
    for path in markdown_files:
        text = FENCED_BLOCK_RE.sub("", path.read_text(encoding="utf-8"))
        for raw_target in _markdown_targets(text):
            target = raw_target.strip().split("#", 1)[0]
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = path.parent / unquote(target)
            if not resolved.exists():
                errors.append(f"{_relative(path)}: unresolved documentation link ({target})")
    return errors


def _expected_index_targets(directory: Path) -> set[str]:
    """Return relative paths an index must list for its direct children."""
    expected: set[str] = set()
    for child in directory.iterdir():
        if child.is_file() and child.suffix in {".md", ".html"}:
            if child.name not in INSTRUCTION_FILES and child.name != "index.md":
                expected.add(child.name)
        elif child.is_dir() and (child / "index.md").is_file():
            expected.add(f"{child.name}/index.md")
    return expected


def _validate_indexes() -> list[str]:
    """Ensure every documentation index lists all direct children."""
    errors: list[str] = []
    for index_path in sorted(DOCS_ROOT.rglob("index.md")):
        directory = index_path.parent
        text = FENCED_BLOCK_RE.sub("", index_path.read_text(encoding="utf-8"))
        listed = {
            target.strip().split("#", 1)[0]
            for target in _markdown_targets(text)
            if "://" not in target
        }
        expected = _expected_index_targets(directory)
        for target in sorted(expected - listed):
            errors.append(f"{_relative(index_path)}: missing direct child ({target})")
    return errors


def _validate_note_shapes(markdown_files: list[Path]) -> list[str]:
    """Check the required heading for documentation indexes."""
    errors: list[str] = []
    for path in markdown_files:
        if path.name in INSTRUCTION_FILES:
            continue
        text = path.read_text(encoding="utf-8")
        if path.name == "index.md" and "\n# Documentation\n" not in text:
            errors.append(f"{_relative(path)}: index requires # Documentation")
    return errors


def _validate_legacy_paths(markdown_files: list[Path]) -> list[str]:
    """Reject paths left behind by previous documentation layouts."""
    errors: list[str] = []
    patterns = {
        "old-docs/": re.compile(r"old-docs/"),
        "wiki/docs/": re.compile(r"wiki/docs/"),
        "Obsidian documentation link": re.compile(r"\[\[docs/"),
        "old ingest skill": re.compile(r"skills/ingest"),
    }
    for path in markdown_files:
        text = FENCED_BLOCK_RE.sub("", path.read_text(encoding="utf-8"))
        for label, pattern in patterns.items():
            if pattern.search(text):
                errors.append(f"{_relative(path)}: contains obsolete {label} reference")
    return errors


def main() -> int:
    """Run all documentation checks and return a shell-compatible status."""
    markdown_files = sorted(DOCS_ROOT.rglob("*.md"))
    errors = [
        *_validate_links(markdown_files),
        *_validate_indexes(),
        *_validate_note_shapes(markdown_files),
        *_validate_legacy_paths(markdown_files),
    ]

    if errors:
        for error in errors:
            print(f"[ERROR] {error}")
        print(f"Documentation validation failed with {len(errors)} error(s).")
        return 1

    print(
        f"Documentation validation passed: {len(markdown_files)} Markdown files, "
        f"{len(list(DOCS_ROOT.rglob('index.md')))} indexes."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
