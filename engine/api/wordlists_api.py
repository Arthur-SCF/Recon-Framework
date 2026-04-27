"""
Wordlist management API.

GET    /api/v1/wordlists                    — list all (bundled + custom)
POST   /api/v1/wordlists/upload             — multipart upload to CUSTOM_DIR
DELETE /api/v1/wordlists/custom/{name}      — delete custom wordlist
POST   /api/v1/wordlists/resolvers/update   — download resolver lists from Trickest
"""
from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from engine.wordlists import list_wordlists, CUSTOM_DIR

log = logging.getLogger("engine.api.wordlists")

router = APIRouter(prefix="/api/v1/wordlists", tags=["wordlists"])

# Security constants
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024   # 5 MB
_SAFE_NAME_RE     = re.compile(r'^[a-zA-Z0-9_\-\.]+\.txt$')
_TRICKEST_RESOLVERS_URL = "https://raw.githubusercontent.com/trickest/resolvers/main/resolvers.txt"
_TRICKEST_TRUSTED_URL   = "https://raw.githubusercontent.com/trickest/resolvers/main/resolvers-trusted.txt"
_RESOLVERS_DIR          = Path("/data/resolvers")


def _validate_filename(name: str) -> None:
    """Raise 400 if the filename is unsafe."""
    if not name:
        raise HTTPException(status_code=400, detail="Filename is required")
    if not _SAFE_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid filename. Only alphanumeric, dash, underscore, dot, and .txt extension allowed.",
        )
    # Reject path traversal attempts
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid filename")


def _safe_custom_path(name: str) -> Path:
    """Return resolved path inside CUSTOM_DIR, or raise 400 on traversal."""
    _validate_filename(name)
    path = CUSTOM_DIR / name
    try:
        path.resolve().relative_to(CUSTOM_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path traversal detected")
    return path


@router.get("")
async def list_all_wordlists():
    """List all wordlists (bundled + custom) with metadata."""
    return list_wordlists()


@router.post("/upload", status_code=201)
async def upload_wordlist(file: UploadFile = File(...)):
    """Upload a custom wordlist (.txt, ≤5 MB)."""
    name = file.filename or ""
    _validate_filename(name)

    # Ensure the directory exists
    CUSTOM_DIR.mkdir(parents=True, exist_ok=True)

    dest = _safe_custom_path(name)

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {_MAX_UPLOAD_BYTES // 1024 // 1024} MB",
        )

    try:
        dest.write_bytes(content)
    except OSError as exc:
        log.error("wordlist upload failed: %r", exc)
        raise HTTPException(status_code=500, detail="Failed to save wordlist")

    lines = content.decode("utf-8", errors="ignore").count("\n")
    log.info("wordlist uploaded: %s (%d bytes, ~%d lines)", name, len(content), lines)
    return {"name": name, "type": "custom", "size_bytes": len(content), "lines": lines}


@router.delete("/custom/{name}", status_code=200)
async def delete_custom_wordlist(name: str):
    """Delete a custom wordlist by name."""
    path = _safe_custom_path(name)

    if not path.exists():
        raise HTTPException(status_code=404, detail="Wordlist not found")

    try:
        path.unlink()
    except OSError as exc:
        log.error("wordlist delete failed: %r", exc)
        raise HTTPException(status_code=500, detail="Failed to delete wordlist")

    log.info("wordlist deleted: %s", name)
    return {"deleted": name}


@router.post("/resolvers/update")
async def update_resolvers():
    """
    Download the latest resolver lists from Trickest GitHub repo.
    Runs in a thread pool to avoid blocking the event loop.
    Returns line counts for both lists.
    """
    import asyncio
    import httpx

    _RESOLVERS_DIR.mkdir(parents=True, exist_ok=True)

    async def _fetch(url: str, dest: Path) -> int:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.get(url, follow_redirects=True)
                resp.raise_for_status()
                content = resp.content
                dest.write_bytes(content)
                return content.decode("utf-8", errors="ignore").count("\n")
        except Exception as exc:
            log.error("resolver download failed %s: %r", url, exc)
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download resolvers from {url}: {exc}",
            )

    resolvers_count, trusted_count = await asyncio.gather(
        _fetch(_TRICKEST_RESOLVERS_URL,        _RESOLVERS_DIR / "resolvers.txt"),
        _fetch(_TRICKEST_TRUSTED_URL,          _RESOLVERS_DIR / "resolvers-trusted.txt"),
    )

    log.info("resolvers updated: %d resolvers, %d trusted", resolvers_count, trusted_count)
    return {
        "resolvers_count": resolvers_count,
        "trusted_count":   trusted_count,
    }
