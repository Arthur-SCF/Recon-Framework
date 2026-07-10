"""
Program config inheritance — materialise-on-write.

A program holds DEFAULT policy columns. An asset with config_source='inherit'
keeps synced COPIES of those columns on its own targets row, so the scheduler
(which reads targets columns directly in SQL) needs no changes. Re-sync runs
when the program config changes or an asset is (re)assigned with inherit.

Scope rules are intentionally NOT inherited in v1 — they stay per-asset.
"""
from __future__ import annotations

import logging

from engine.db import Database

log = logging.getLogger("engine.programs_config")

INHERITED_COLUMNS = (
    "pipeline_template", "scan_priority", "rescan_interval", "manual_only",
    "loop", "wildcard_policy", "retention_runs", "schedule_mode",
    "schedule_days", "schedule_weekday", "schedule_hour", "schedule_minute",
)


async def apply_program_config(
    db: Database, target_id: str, program_row, *, copy_pipeline: bool = True
) -> None:
    set_clause = ", ".join(f"{col} = ?" for col in INHERITED_COLUMNS)
    params = tuple(program_row[col] for col in INHERITED_COLUMNS) + (target_id,)
    await db.execute(f"UPDATE targets SET {set_clause} WHERE id = ?", params)
    if copy_pipeline:
        await _reset_asset_pipeline(db, target_id, program_row["pipeline_template"])


async def propagate_program_config(
    db: Database, program_id: str, *, pipeline_changed: bool
) -> int:
    program = await db.fetchone("SELECT * FROM programs WHERE id = ?", (program_id,))
    if not program:
        return 0
    assets = await db.fetchall(
        "SELECT id FROM targets WHERE program_id = ? AND config_source = 'inherit'",
        (program_id,),
    )
    for asset in assets:
        await apply_program_config(
            db, asset["id"], program, copy_pipeline=pipeline_changed
        )
    return len(assets)


async def _reset_asset_pipeline(db: Database, target_id: str, template_name: str) -> None:
    await db.execute("DELETE FROM pipeline_groups WHERE target_id = ?", (target_id,))
    await db.execute("DELETE FROM pipeline_steps WHERE target_id = ?", (target_id,))
    from engine.api.targets import _copy_pipeline_template
    await _copy_pipeline_template(db, target_id, template_name)
