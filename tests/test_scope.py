"""
Regression tests for non-destructive scope (``in_scope``) filtering.

Locks the behaviour of the scope include/exclude feature: excluding an
already-discovered subdomain must hide its live host (via the host-derived
``in_scope`` flag), never delete data, and be reversible; ``include`` is a
keep-in-scope override that also seeds concrete manual subdomains.

Self-contained — uses a temp SQLite DB and no async plugin (``asyncio.run``),
so it runs under a bare ``pytest`` install.
"""
import asyncio
import os
import tempfile
import uuid
from datetime import datetime, timezone

from engine.db import init_database
from engine.pipeline.dedup import is_in_scope
from engine.pipeline.scope_service import reapply_scope


def test_is_in_scope_no_rules_is_in_scope():
    assert is_in_scope("a.example.com", []) is True


def test_is_in_scope_exclude_exact():
    rules = [{"rule_type": "exclude", "pattern": "admin.example.com"}]
    assert is_in_scope("admin.example.com", rules) is False
    assert is_in_scope("www.example.com", rules) is True


def test_is_in_scope_wildcard_exclude_has_no_whitelist_side_effect():
    rules = [{"rule_type": "exclude", "pattern": "*.staging.example.com"}]
    assert is_in_scope("api.staging.example.com", rules) is False
    assert is_in_scope("random.example.com", rules) is True


def test_is_in_scope_include_wins_over_exclude():
    rules = [
        {"rule_type": "exclude", "pattern": "*.example.com"},
        {"rule_type": "include", "pattern": "keep.example.com"},
    ]
    assert is_in_scope("keep.example.com", rules) is True
    assert is_in_scope("other.example.com", rules) is False


async def _seed(db) -> str:
    tid = str(uuid.uuid4())
    await db.execute("INSERT INTO targets (id, domain) VALUES (?, ?)", (tid, "example.com"))
    for sub in ("admin.example.com", "api.example.com", "www.example.com"):
        await db.execute(
            "INSERT INTO subdomains (id, target_id, subdomain) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), tid, sub),
        )
    # NULL subdomain_id: proves live-host scope is derived from the host string.
    for host in ("admin.example.com", "api.example.com", "www.example.com"):
        await db.execute(
            "INSERT INTO live_hosts (id, target_id, subdomain_id, url, host) VALUES (?, ?, NULL, ?, ?)",
            (str(uuid.uuid4()), tid, f"https://{host}", host),
        )
    await db.commit()
    return tid


async def _add_rule(db, tid, rtype, pattern):
    await db.execute(
        "INSERT INTO scope_rules (id, target_id, rule_type, pattern, priority, created_at) "
        "VALUES (?, ?, ?, ?, 0, ?)",
        (str(uuid.uuid4()), tid, rtype, pattern, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()


async def _visible(db, tid) -> set[str]:
    rows = await db.fetchall(
        "SELECT host FROM live_hosts WHERE target_id=? AND in_scope=1", (tid,)
    )
    return {r["host"] for r in rows}


async def _exclude_scenario():
    with tempfile.TemporaryDirectory() as tmp:
        db = await init_database(os.path.join(tmp, "t.db"))
        try:
            tid = await _seed(db)
            assert await _visible(db, tid) == {
                "admin.example.com", "api.example.com", "www.example.com"
            }

            await _add_rule(db, tid, "exclude", "admin.example.com")
            await reapply_scope(db, tid)

            assert await _visible(db, tid) == {"api.example.com", "www.example.com"}
            row = await db.fetchone(
                "SELECT in_scope FROM live_hosts WHERE target_id=? AND host=?",
                (tid, "admin.example.com"),
            )
            assert row is not None and row["in_scope"] == 0  # not deleted, just flagged

            await db.execute(
                "DELETE FROM scope_rules WHERE target_id=? AND pattern=?",
                (tid, "admin.example.com"),
            )
            await db.commit()
            await reapply_scope(db, tid)
            assert "admin.example.com" in await _visible(db, tid)  # reversible
        finally:
            await db.close()


def test_exclude_hides_discovered_host_nondestructively_and_reversibly():
    asyncio.run(_exclude_scenario())


async def _seed_scenario():
    with tempfile.TemporaryDirectory() as tmp:
        db = await init_database(os.path.join(tmp, "t.db"))
        try:
            tid = await _seed(db)
            await _add_rule(db, tid, "include", "secret.example.com")
            await _add_rule(db, tid, "include", "*.vpn.example.com")
            await reapply_scope(db, tid)

            seeded = await db.fetchone(
                "SELECT in_scope, sources FROM subdomains WHERE target_id=? AND subdomain=?",
                (tid, "secret.example.com"),
            )
            assert seeded is not None
            assert seeded["in_scope"] == 1
            assert "manual" in (seeded["sources"] or "")

            wildcard = await db.fetchone(
                "SELECT id FROM subdomains WHERE target_id=? AND subdomain=?",
                (tid, "*.vpn.example.com"),
            )
            assert wildcard is None  # a wildcard include cannot be seeded as a host
        finally:
            await db.close()


def test_concrete_include_seeds_manual_subdomain_wildcard_does_not():
    asyncio.run(_seed_scenario())
