#!/usr/bin/env python3
"""Validate the repository wiki's structure and internal navigation."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
WIKI_ROOT = REPO_ROOT / "wiki"
INSTRUCTION_FILES = {"AGENTS.md", "CLAUDE.md"}
WIKI_LINK_RE = re.compile(r"\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]")
FENCED_BLOCK_RE = re.compile(r"```.*?```", re.DOTALL)


def _relative(path: Path) -> str:
    """Return a stable repository-relative path for diagnostics."""
    return path.relative_to(REPO_ROOT).as_posix()


def _wiki_target_exists(target: str) -> bool:
    """Return whether a vault-relative Obsidian target resolves to a note."""
    normalized = target.strip().removesuffix(".md")
    return (WIKI_ROOT / f"{normalized}.md").is_file()


def _validate_links(markdown_files: list[Path]) -> list[str]:
    """Validate Obsidian links outside fenced examples."""
    errors: list[str] = []
    for path in markdown_files:
        text = FENCED_BLOCK_RE.sub("", path.read_text(encoding="utf-8"))
        for target in WIKI_LINK_RE.findall(text):
            if not _wiki_target_exists(target):
                errors.append(f"{_relative(path)}: unresolved wiki link [[{target}]]")
    return errors


def _expected_index_targets(directory: Path) -> set[str]:
    """Return vault-relative targets an index must list for its direct children."""
    expected: set[str] = set()
    for child in directory.iterdir():
        if child.is_file() and child.suffix == ".md":
            if child.name not in INSTRUCTION_FILES and child.name != "index.md":
                expected.add(child.relative_to(WIKI_ROOT).with_suffix("").as_posix())
        elif child.is_dir() and (child / "index.md").is_file():
            expected.add((child / "index.md").relative_to(WIKI_ROOT).with_suffix("").as_posix())
    return expected


def _validate_indexes() -> list[str]:
    """Ensure every indexed folder lists all direct documentation children."""
    errors: list[str] = []
    for index_path in sorted(WIKI_ROOT.rglob("index.md")):
        directory = index_path.parent
        text = FENCED_BLOCK_RE.sub("", index_path.read_text(encoding="utf-8"))
        listed = {target.strip().removesuffix(".md") for target in WIKI_LINK_RE.findall(text)}
        expected = _expected_index_targets(directory)
        for target in sorted(expected - listed):
            errors.append(f"{_relative(index_path)}: missing direct child [[{target}]]")
    return errors


def _validate_note_shapes(markdown_files: list[Path]) -> list[str]:
    """Check the required headings for ordinary implementation notes and indexes."""
    errors: list[str] = []
    for path in markdown_files:
        if path.name in INSTRUCTION_FILES:
            continue
        text = path.read_text(encoding="utf-8")
        if path.name == "index.md":
            if "\n# Wiki\n" not in text or "\n# Related Notes\n" not in text:
                errors.append(f"{_relative(path)}: index requires # Wiki and # Related Notes")
            continue
        if WIKI_ROOT / "docs" in path.parents or path.stem.endswith("-plan"):
            continue
        details_pos = text.find("\n# Details\n")
        related_pos = text.find("\n# Related Notes\n")
        if details_pos < 0 or related_pos < 0 or details_pos > related_pos:
            errors.append(
                f"{_relative(path)}: ordinary note requires # Details before # Related Notes"
            )
    return errors


def _validate_legacy_paths(markdown_files: list[Path]) -> list[str]:
    """Reject documentation paths removed by the wiki migration."""
    errors: list[str] = []
    patterns = {
        "old-docs/": re.compile(r"old-docs/"),
        "wiki/sources": re.compile(r"wiki/sources"),
        "dedicated wiki plans/": re.compile(r"wiki/plans"),
        "root docs/": re.compile(r"(?<!wiki/)(?<!\[\[)docs/"),
        "root plans/": re.compile(r"(?<!wiki/)(?<!\[\[)plans/"),
        "old ingest skill": re.compile(r"skills/ingest"),
    }
    for path in markdown_files:
        text = FENCED_BLOCK_RE.sub("", path.read_text(encoding="utf-8"))
        for label, pattern in patterns.items():
            if pattern.search(text):
                errors.append(f"{_relative(path)}: contains obsolete {label} reference")
    return errors


def main() -> int:
    """Run all wiki checks and return a shell-compatible status."""
    markdown_files = sorted(WIKI_ROOT.rglob("*.md"))
    errors = [
        *_validate_links(markdown_files),
        *_validate_indexes(),
        *_validate_note_shapes(markdown_files),
        *_validate_legacy_paths(markdown_files),
    ]

    if errors:
        for error in errors:
            print(f"[ERROR] {error}")
        print(f"Wiki validation failed with {len(errors)} error(s).")
        return 1

    print(
        f"Wiki validation passed: {len(markdown_files)} Markdown files, "
        f"{len(list(WIKI_ROOT.rglob('index.md')))} indexes."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
