"""
Scope rules CRUD.

GET    /api/v1/targets/{target_id}/scope              — list rules
POST   /api/v1/targets/{target_id}/scope              — add rule
DELETE /api/v1/targets/{target_id}/scope/{rule_id}    — remove rule
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from engine.db import Database, get_db
from engine.api.schemas import ScopeRuleCreate, ScopeRuleOut, ScopeRuleUpdate

log = logging.getLogger("engine.api.scope")
router = APIRouter(tags=["scope"])


def _row_to_rule(row) -> ScopeRuleOut:
    return ScopeRuleOut(
        id=row["id"],
        target_id=row["target_id"],
        rule_type=row["rule_type"],
        pattern=row["pattern"],
        priority=row["priority"],
        created_at=row["created_at"],
    )


def _require_target(row) -> None:
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")


@router.get("/targets/{target_id}/scope", response_model=list[ScopeRuleOut])
async def list_scope_rules(
    target_id: str, db: Database = Depends(get_db)
) -> list[ScopeRuleOut]:
    _require_target(
        await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    )
    rows = await db.fetchall(
        "SELECT * FROM scope_rules WHERE target_id = ? ORDER BY priority DESC, created_at ASC",
        (target_id,),
    )
    return [_row_to_rule(r) for r in rows]


@router.post(
    "/targets/{target_id}/scope",
    response_model=ScopeRuleOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_scope_rule(
    target_id: str, body: ScopeRuleCreate, db: Database = Depends(get_db)
) -> ScopeRuleOut:
    _require_target(
        await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    )

    rule_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    async with db.transaction():
        await db.execute(
            """
            INSERT INTO scope_rules (id, target_id, rule_type, pattern, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (rule_id, target_id, body.rule_type, body.pattern, body.priority, now),
        )
    row = await db.fetchone("SELECT * FROM scope_rules WHERE id = ?", (rule_id,))
    return _row_to_rule(row)


@router.put("/targets/{target_id}/scope/{rule_id}", response_model=ScopeRuleOut)
async def update_scope_rule(
    target_id: str, rule_id: str, body: ScopeRuleUpdate, db: Database = Depends(get_db)
) -> ScopeRuleOut:
    row = await db.fetchone(
        "SELECT * FROM scope_rules WHERE id = ? AND target_id = ?",
        (rule_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Scope rule not found")

    updates: list[tuple[str, object]] = []
    if body.rule_type is not None:
        updates.append(("rule_type", body.rule_type))
    if body.pattern is not None:
        updates.append(("pattern", body.pattern))
    if body.priority is not None:
        updates.append(("priority", body.priority))

    if updates:
        set_clause = ", ".join(f"{col} = ?" for col, _ in updates)
        values = [v for _, v in updates] + [rule_id]
        async with db.transaction():
            await db.execute(f"UPDATE scope_rules SET {set_clause} WHERE id = ?", tuple(values))  # noqa: S608

    row = await db.fetchone("SELECT * FROM scope_rules WHERE id = ?", (rule_id,))
    return _row_to_rule(row)


@router.post("/targets/{target_id}/scope/preview")
async def preview_scope_rules(
    target_id: str,
    body: list[ScopeRuleCreate],
    db: Database = Depends(get_db),
) -> dict:
    """Preview how a set of scope rules would filter the current subdomain list."""
    _require_target(
        await db.fetchone("SELECT id FROM targets WHERE id = ?", (target_id,))
    )
    sub_rows = await db.fetchall(
        "SELECT subdomain FROM subdomains WHERE target_id = ?", (target_id,)
    )
    domain_row = await db.fetchone(
        "SELECT domain FROM targets WHERE id = ?", (target_id,)
    )
    all_subs: set[str] = {r["subdomain"] for r in sub_rows}
    rules = [{"rule_type": r.rule_type, "pattern": r.pattern, "priority": r.priority} for r in body]

    from engine.pipeline.dedup import apply_scope_rules
    included = apply_scope_rules(all_subs, rules, domain_row["domain"])
    excluded = all_subs - included
    return {
        "total":          len(all_subs),
        "included_count": len(included),
        "excluded_count": len(excluded),
        "included":       sorted(included),
        "excluded":       sorted(excluded),
    }


@router.delete(
    "/targets/{target_id}/scope/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_scope_rule(
    target_id: str, rule_id: str, db: Database = Depends(get_db)
) -> None:
    row = await db.fetchone(
        "SELECT id FROM scope_rules WHERE id = ? AND target_id = ?",
        (rule_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Scope rule not found")
    async with db.transaction():
        await db.execute("DELETE FROM scope_rules WHERE id = ?", (rule_id,))
