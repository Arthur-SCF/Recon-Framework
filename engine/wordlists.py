"""
Wordlist management helpers.

  prepare_puredns_wordlist() — merge primary + purpose + custom into a temp file
  list_wordlists()           — enumerate bundled and custom wordlists with metadata
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from uuid import uuid4

log = logging.getLogger("engine.wordlists")

WORDLIST_ROOT = Path(os.environ.get("WORDLIST_DIR", "/app/wordlists"))
CUSTOM_DIR    = Path(os.environ.get("DATA_DIR", "/data")) / "wordlists" / "custom"

# Primary wordlist filenames inside WORDLIST_ROOT
_PRIMARY_FILES = {
    "small":  "dns/dns-small.txt",
    "medium": "dns/dns-medium.txt",
    "large":  "dns/dns-large.txt",
}

# Purpose list filenames inside WORDLIST_ROOT/dns-purpose/
_PURPOSE_FILES = {
    "api":      "dns-purpose/dns-api.txt",
    "cloud":    "dns-purpose/dns-cloud.txt",
    "internal": "dns-purpose/dns-internal.txt",
    "dev":      "dns-purpose/dns-dev.txt",
}


def _read_lines(path: Path) -> set[str]:
    """Read a wordlist file, return stripped non-empty lines as a set."""
    if not path.is_file():
        log.warning("wordlist not found: %s", path)
        return set()
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            return {line.strip() for line in fh if line.strip()}
    except OSError as exc:
        log.error("failed to read wordlist %s: %r", path, exc)
        return set()


def prepare_puredns_wordlist(config: dict) -> tuple[str, int]:
    """
    Merge primary (small/medium/large) + purpose lists + custom into a
    deduplicated temp file. Returns (temp_file_path, word_count).

    Word count is the deduplicated size of the merged list — use it to
    calculate a realistic timeout for puredns bruteforce.

    config keys:
      primary_wordlist: "small" | "medium" | "large"  (default: "small")
      purpose_lists:    list of "api" | "cloud" | "internal" | "mail"
      custom_wordlist:  filename inside CUSTOM_DIR (optional)

    Approximate runtimes at default 20 qps bruteforce rate:
      small  (~110K words) — ~91 min
      medium (~200K words) — ~167 min
      large  (~3M words)   — ~42 hours  ← WARNING: very long
    """
    primary  = config.get("primary_wordlist", "small")
    purposes = config.get("purpose_lists", [])
    custom   = config.get("custom_wordlist")

    all_words: set[str] = set()

    # Primary
    primary_file = _PRIMARY_FILES.get(primary, _PRIMARY_FILES["small"])
    all_words.update(_read_lines(WORDLIST_ROOT / primary_file))

    # Purpose lists
    for purpose in purposes:
        if purpose in _PURPOSE_FILES:
            all_words.update(_read_lines(WORDLIST_ROOT / _PURPOSE_FILES[purpose]))
        else:
            log.warning("unknown purpose list: %s", purpose)

    # Custom
    if custom:
        custom_path = CUSTOM_DIR / custom
        # Path traversal guard
        try:
            custom_path.resolve().relative_to(CUSTOM_DIR.resolve())
        except ValueError:
            log.error("path traversal attempt for custom wordlist: %s", custom)
        else:
            all_words.update(_read_lines(custom_path))

    word_count  = len(all_words)
    merged_path = f"/tmp/puredns_wl_{uuid4().hex[:8]}.txt"
    try:
        with open(merged_path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(sorted(all_words)))
        log.info("merged wordlist: %d words → %s", word_count, merged_path)
    except OSError as exc:
        log.error("failed to write merged wordlist: %r", exc)
        raise

    return merged_path, word_count


def list_wordlists() -> list[dict]:
    """
    Return all wordlists (bundled + custom) with name, type, size_bytes, lines.
    """
    result: list[dict] = []

    def _stat(path: Path, wl_type: str, name: str) -> dict | None:
        if not path.is_file():
            return None
        try:
            size = path.stat().st_size
            lines = sum(1 for _ in path.open("r", encoding="utf-8", errors="ignore")
                        if _.strip())
        except OSError:
            return None
        return {"name": name, "type": wl_type, "size_bytes": size, "lines": lines}

    # Bundled primary
    for key, filename in _PRIMARY_FILES.items():
        entry = _stat(WORDLIST_ROOT / filename, "bundled", filename)
        if entry:
            result.append(entry)

    # Bundled purpose
    for key, rel_path in _PURPOSE_FILES.items():
        path = WORDLIST_ROOT / rel_path
        entry = _stat(path, "bundled", Path(rel_path).name)
        if entry:
            result.append(entry)

    # Custom
    if CUSTOM_DIR.is_dir():
        for path in sorted(CUSTOM_DIR.iterdir()):
            if path.suffix == ".txt" and path.is_file():
                entry = _stat(path, "custom", path.name)
                if entry:
                    result.append(entry)

    return result
