#!/usr/bin/env python3
"""
Phase 6 pipeline migration script — adds verify_dedup as the final group
to all pipeline templates and all existing target pipelines.

Run inside the backend container after deploying Phase 6:
    docker compose exec backend python /app/scripts/add_verify_dedup.py

Safe to re-run: uses INSERT OR IGNORE for existing rows.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import uuid

DB_PATH = "/data/recon.db"

VERIFY_DEDUP_STEP = {
    "step_id": "verify_dedup",
    "position": 1,
    "enabled": True,
}


def add_to_template(conn: sqlite3.Connection, template_id: str) -> None:
    row = conn.execute(
        "SELECT config FROM pipeline_templates WHERE id = ?", (template_id,)
    ).fetchone()
    if not row:
        print(f"  Template {template_id} not found — skipping")
        return

    config = json.loads(row[0])
    groups = config.get("groups", [])

    # Check if verify_dedup already present
    for g in groups:
        for s in g.get("steps", []):
            if s.get("step_id") == "verify_dedup":
                print(f"  Template {template_id}: verify_dedup already present — skipping")
                return

    max_pos = max((g["position"] for g in groups), default=0)
    new_pos = max_pos + 1

    groups.append({
        "id":       f"g{new_pos:02d}",
        "name":     "Verify & Dedup",
        "position": new_pos,
        "parallel": False,
        "steps":    [VERIFY_DEDUP_STEP],
    })
    config["groups"] = groups
    conn.execute(
        "UPDATE pipeline_templates SET config = ? WHERE id = ?",
        (json.dumps(config), template_id),
    )
    print(f"  Template {template_id}: added verify_dedup as group {new_pos}")


def add_to_target_pipeline(conn: sqlite3.Connection, target_id: str) -> None:
    groups = conn.execute(
        "SELECT id, position FROM pipeline_groups WHERE target_id = ? ORDER BY position",
        (target_id,),
    ).fetchall()

    if not groups:
        return

    # Check if verify_dedup step already exists for this target
    existing = conn.execute(
        "SELECT id FROM pipeline_steps WHERE target_id = ? AND step_id = 'verify_dedup'",
        (target_id,),
    ).fetchone()
    if existing:
        return

    max_pos = max(g[1] for g in groups)
    new_pos = max_pos + 1
    group_id = str(uuid.uuid4())

    conn.execute(
        """
        INSERT OR IGNORE INTO pipeline_groups
            (id, target_id, position, name, parallel, enabled)
        VALUES (?, ?, ?, 'Verify & Dedup', 0, 1)
        """,
        (group_id, target_id, new_pos),
    )

    step_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT OR IGNORE INTO pipeline_steps
            (id, group_id, target_id, position, step_id, enabled)
        VALUES (?, ?, ?, 1, 'verify_dedup', 1)
        """,
        (step_id, group_id, target_id),
    )


def main() -> None:
    print(f"Connecting to {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        # Update templates
        print("Updating pipeline templates...")
        template_ids = [r[0] for r in conn.execute("SELECT id FROM pipeline_templates").fetchall()]
        for tid in template_ids:
            add_to_template(conn, tid)

        # Update all existing target pipelines
        print("Updating existing target pipelines...")
        target_ids = [r[0] for r in conn.execute("SELECT id FROM targets").fetchall()]
        for tid in target_ids:
            add_to_target_pipeline(conn, tid)
            print(f"  Target {tid}: ensured verify_dedup group")

        conn.commit()
        print(f"Done. Updated {len(template_ids)} templates, {len(target_ids)} targets.")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
