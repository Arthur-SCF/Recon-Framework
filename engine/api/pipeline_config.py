"""
Pipeline configuration endpoints.

GET    /pipeline/steps                           — list all available step types from registry
GET    /pipeline/steps/{step_id}/schema          — param descriptor list for a step
GET    /targets/{target_id}/pipeline             — get full pipeline config
GET    /targets/{target_id}/pipeline/eta         — ETA estimate for the pipeline
PUT    /targets/{target_id}/pipeline/groups/{group_id}  — enable/disable group
DELETE /targets/{target_id}/pipeline/groups/{group_id}  — delete a group
POST   /targets/{target_id}/pipeline/groups      — add a new group
PUT    /targets/{target_id}/pipeline/steps/{step_id}    — enable/disable step / config
POST   /targets/{target_id}/pipeline/reset       — reset to template default
POST   /targets/{target_id}/pipeline/reset-params — reset config_overrides only
POST   /targets/{target_id}/pipeline/save-as-template — save current pipeline as new template
GET    /pipeline/templates                       — list available templates
DELETE /pipeline/templates/{template_id}         — delete a custom template (non-default only)
"""
from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from engine.db import Database, get_db
from engine.api.schemas import (
    PipelineGroupOut,
    PipelineStepOut,
    PipelineGroupUpdate,
    PipelineStepUpdate,
    PipelineTemplateCreate,
    PipelineTemplateUpdate,
    PipelineTemplateClone,
    PipelineResetBody,
)
from engine.pipeline.registry import STEP_REGISTRY
from engine.pipeline import signals
from engine.tools.param_schemas import schema_for, validate_overrides, SchemaValidationError

log = logging.getLogger("engine.api.pipeline_config")
router = APIRouter(tags=["pipeline"])

# Steps that are mutually exclusive — enabling one disables all others in the group.
# Stored as frozensets so a new tool can be added here without changing logic.
_MUTEX_GROUPS: list[frozenset[str]] = [
    frozenset({"zgrab2_service", "nmap_service"}),
]


def _mutex_siblings(step_id: str) -> frozenset[str]:
    """Return all step_ids that must be disabled when `step_id` is enabled."""
    for group in _MUTEX_GROUPS:
        if step_id in group:
            return group - {step_id}
    return frozenset()


def _validate_template_config(config: dict) -> None:
    """Raise 400 if any mutex group has more than one step enabled in the template config."""
    for group_def in config.get("groups", []):
        for mutex_group in _MUTEX_GROUPS:
            enabled = [
                s["step_id"]
                for s in group_def.get("steps", [])
                if s.get("step_id") in mutex_group and s.get("enabled", True)
            ]
            if len(enabled) > 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"Mutually exclusive steps cannot both be enabled: {', '.join(sorted(enabled))}",
                )


# ── Step catalog ───────────────────────────────────────────────────────────────
# Metadata for every step. Any step in STEP_REGISTRY but absent here gets
# category="other" and an empty description — so new tools auto-appear in
# the UI as soon as they're registered.

STEP_CATALOG: dict[str, dict] = {
    "subfinder":           {"category": "passive",       "description": "Passive subdomain enumeration from 40+ sources (APIs, cert logs, search engines)"},
    "amass":               {"category": "passive",       "description": "OSINT-based subdomain discovery — slower but finds unique results"},
    "tlsx":                {"category": "passive",       "description": "Extracts subdomains from TLS certificates on live hosts"},
    "assetfinder":         {"category": "passive",       "description": "Passive subdomain discovery via certificate and DNS APIs"},
    "crt_sh":              {"category": "passive",       "description": "Certificate Transparency log lookup (crt.sh)"},
    "gau":                 {"category": "passive",       "description": "Fetch historical URLs from Wayback Machine and Common Crawl"},
    "cloud_enum":          {"category": "cloud",         "description": "Enumerate cloud assets (AWS, Azure, GCP) tied to the target"},
    "s3scanner":           {"category": "cloud",         "description": "Scan for exposed S3 buckets and check their permissions"},
    "wafw00f":             {"category": "waf",           "description": "Detect WAF/CDN presence on live hosts"},
    "wildcard_check":      {"category": "dns",           "description": "Detect wildcard DNS responses to avoid false positives"},
    "puredns_default":     {"category": "dns",           "description": "DNS brute-force: resolves every word in the wordlist against the domain"},
    "alterx":              {"category": "dns",           "description": "Generate subdomain permutations from discovered subdomains"},
    "puredns_permutation": {"category": "dns",           "description": "Resolve AlterX permutation list against the domain"},
    "puredns_custom":      {"category": "dns",           "description": "Resolve cewl-generated wordlist candidates against the domain"},
    "cewl":                {"category": "dns",           "description": "Scrape target website for words to use as brute-force seeds"},
    "httpx_r1":            {"category": "http",          "description": "HTTP probe round 1 — all discovered subdomains"},
    "httpx_r2":            {"category": "http",          "description": "HTTP probe round 2 — permutation/custom brute-force results"},
    "httpx_r3":            {"category": "http",          "description": "HTTP probe round 3 — JS-extracted subdomains from Katana"},
    "httpx_ports":         {"category": "http",          "description": "HTTP probe on non-standard ports found by port scanning"},
    "naabu":               {"category": "ports",         "description": "TCP port scan — configurable range (top 1000 / 5000 / full 65535)"},
    "zgrab2_service":      {"category": "service",       "description": "Fast async service fingerprinting via banner grabbing"},
    "nmap_service":        {"category": "service",       "description": "Thorough service version detection with Nmap -sV"},
    "katana":              {"category": "js",            "description": "Active web crawler — extracts subdomains and endpoints from JavaScript"},
    "subdomainizer":       {"category": "js",            "description": "Crawls JS files to extract hardcoded subdomains and secrets"},
    "nuclei_takeover":     {"category": "takeover",      "description": "Detect subdomain takeover vulnerabilities using Nuclei templates"},
    "gowitness":           {"category": "screenshots",   "description": "Screenshot every live host for visual triage"},
    "consolidate_r1":      {"category": "action",        "description": "Deduplicate passive enumeration results before HTTP probe R1"},
    "consolidate_r2":      {"category": "action",        "description": "Deduplicate permutation results before HTTP probe R2"},
    "consolidate_r3":      {"category": "action",        "description": "Deduplicate JS-extracted subdomains before HTTP probe R3"},
    "diff":                {"category": "action",        "description": "Compare current scan vs previous to detect changes"},
    "verify_dedup":        {"category": "action",        "description": "Final deduplication pass across all result tables"},
}


async def _require_target(target_id: str, db: Database) -> None:
    row = await db.fetchone("SELECT id FROM targets WHERE id=?", (target_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Target not found")


# ── Available steps (registry) ────────────────────────────────────────────────

@router.get("/pipeline/steps")
async def list_available_steps():
    """
    Return all step types from STEP_REGISTRY with display metadata.
    Used by the pipeline editor to populate the step library.
    Automatically includes any new step added to the registry.
    """
    from engine.pipeline.base import BaseAction
    steps = []
    for step_id, cls in STEP_REGISTRY.items():
        catalog = STEP_CATALOG.get(step_id, {})
        steps.append({
            "step_id":     step_id,
            "label":       getattr(cls, "label", step_id),
            "category":    catalog.get("category", "other"),
            "description": catalog.get("description", ""),
            "skippable":   getattr(cls, "skippable", True),
            "is_action":   issubclass(cls, BaseAction),
        })
    return steps


# ── Param schema ──────────────────────────────────────────────────────────────

@router.get("/pipeline/steps/{step_id}/schema")
async def get_step_schema(step_id: str):
    """
    Return the parameter descriptor list for a step_id.
    Each descriptor carries: key, label, type, default, min/max, unit,
    bucket (basic/advanced/danger), group, tooltip, cli_flag.
    Returns [] for steps with no configurable parameters (BaseAction steps).
    Returns 404 for step_ids not in the registry.
    """
    if step_id not in STEP_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Unknown step_id: {step_id!r}")
    return schema_for(step_id)


# ── Add group ─────────────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/pipeline/groups", status_code=201)
async def add_group(
    target_id: str,
    body: dict,
    db: Database = Depends(get_db),
):
    """Append a new empty group to the target's pipeline."""
    await _require_target(target_id, db)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    parallel = bool(body.get("parallel", False))

    row = await db.fetchone(
        "SELECT COALESCE(MAX(position), 0) AS max_pos FROM pipeline_groups WHERE target_id=?",
        (target_id,),
    )
    next_pos = (row["max_pos"] if row else 0) + 1

    group_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO pipeline_groups (id, target_id, position, name, parallel, enabled) VALUES (?, ?, ?, ?, ?, 1)",
        (group_id, target_id, next_pos, name, int(parallel)),
    )
    await db.commit()
    return {"id": group_id, "target_id": target_id, "position": next_pos, "name": name, "parallel": parallel, "enabled": True, "steps": []}


# ── Delete group ──────────────────────────────────────────────────────────────

@router.delete("/targets/{target_id}/pipeline/groups/{group_id}", status_code=200)
async def delete_group(
    target_id: str,
    group_id: str,
    db: Database = Depends(get_db),
):
    """Delete a group and all its steps."""
    await _require_target(target_id, db)
    row = await db.fetchone(
        "SELECT id FROM pipeline_groups WHERE id=? AND target_id=?",
        (group_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Group not found")

    async with db.transaction():
        await db.execute("DELETE FROM pipeline_steps WHERE group_id=?", (group_id,))
        await db.execute("DELETE FROM pipeline_groups WHERE id=?", (group_id,))
    return {"deleted": True}


# ── Full pipeline config ───────────────────────────────────────────────────────

@router.get("/targets/{target_id}/pipeline", response_model=list[PipelineGroupOut])
async def get_pipeline(target_id: str, db: Database = Depends(get_db)):
    await _require_target(target_id, db)

    groups = await db.fetchall(
        """
        SELECT id, target_id, position, name, parallel, enabled
        FROM pipeline_groups
        WHERE target_id = ?
        ORDER BY position
        """,
        (target_id,),
    )

    result = []
    for g in groups:
        steps = await db.fetchall(
            """
            SELECT id, group_id, target_id, position, step_id, enabled, config_overrides
            FROM pipeline_steps
            WHERE group_id = ?
            ORDER BY position
            """,
            (g["id"],),
        )
        step_models = []
        for s in steps:
            overrides = None
            if s["config_overrides"]:
                try:
                    overrides = json.loads(s["config_overrides"])
                except Exception:
                    pass
            step_cls = STEP_REGISTRY.get(s["step_id"])
            step_models.append(PipelineStepOut(
                id=s["id"],
                group_id=s["group_id"],
                target_id=s["target_id"],
                position=s["position"],
                step_id=s["step_id"],
                enabled=bool(s["enabled"]),
                config_overrides=overrides,
                skippable=step_cls.skippable if step_cls else True,
            ))
        result.append(PipelineGroupOut(
            id=g["id"],
            target_id=g["target_id"],
            position=g["position"],
            name=g["name"],
            parallel=bool(g["parallel"]),
            enabled=bool(g["enabled"]),
            steps=step_models,
        ))
    return result


# ── Update group ───────────────────────────────────────────────────────────────

@router.put("/targets/{target_id}/pipeline/groups/{group_id}", response_model=dict)
async def update_group(
    target_id: str,
    group_id: str,
    body: PipelineGroupUpdate,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)
    row = await db.fetchone(
        "SELECT id FROM pipeline_groups WHERE id=? AND target_id=?",
        (group_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Group not found")

    if body.enabled is not None:
        await db.execute(
            "UPDATE pipeline_groups SET enabled=? WHERE id=?",
            (int(body.enabled), group_id),
        )
    if body.parallel is not None:
        await db.execute(
            "UPDATE pipeline_groups SET parallel=? WHERE id=?",
            (int(body.parallel), group_id),
        )
    await db.commit()
    return {"updated": True}


# ── Update step ────────────────────────────────────────────────────────────────

@router.put("/targets/{target_id}/pipeline/steps/{step_row_id}", response_model=dict)
async def update_step(
    target_id: str,
    step_row_id: str,
    body: PipelineStepUpdate,
    db: Database = Depends(get_db),
):
    await _require_target(target_id, db)
    row = await db.fetchone(
        "SELECT id, step_id FROM pipeline_steps WHERE id=? AND target_id=?",
        (step_row_id, target_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Step not found")

    if body.enabled is not None:
        await db.execute(
            "UPDATE pipeline_steps SET enabled=? WHERE id=?",
            (int(body.enabled), step_row_id),
        )
        # Mutex: enabling a step automatically disables all siblings in its mutex group
        if body.enabled:
            siblings = _mutex_siblings(row["step_id"])
            for sibling in siblings:
                await db.execute(
                    "UPDATE pipeline_steps SET enabled=0 WHERE target_id=? AND step_id=?",
                    (target_id, sibling),
                )
    if body.config_overrides is not None:
        try:
            coerced = validate_overrides(row["step_id"], body.config_overrides)
        except SchemaValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        await db.execute(
            "UPDATE pipeline_steps SET config_overrides=? WHERE id=?",
            (json.dumps(coerced), step_row_id),
        )
    await db.commit()
    return {"updated": True}


# ── Pipeline ETA ──────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/pipeline/eta")
async def get_pipeline_eta(
    target_id: str,
    db: Database = Depends(get_db),
):
    """
    Return a rough ETA estimate for running the target's current pipeline.

    Response:
      total_seconds         — sum of all enabled group estimates
      critical_path_seconds — same as total (groups are always sequential)
      per_group             — { group_id: seconds }
      per_step              — [ { step_id, label, enabled, seconds } ]

    Estimates are intentionally pessimistic (upper-bound / timeout-based).
    They require no historical data and are computed from config values and
    current DB row counts.
    """
    await _require_target(target_id, db)
    from engine.pipeline.eta import estimate_pipeline
    result = await estimate_pipeline(target_id, db)
    return {
        "total_seconds":         result.total_seconds,
        "critical_path_seconds": result.critical_path_seconds,
        "per_group":             result.per_group,
        "per_step": [
            {
                "step_id": s.step_id,
                "label":   s.label,
                "enabled": s.enabled,
                "seconds": s.seconds,
            }
            for s in result.per_step
        ],
    }


# ── Reset to template ──────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/pipeline/reset", status_code=200)
async def reset_pipeline(
    target_id: str,
    body: PipelineResetBody | None = None,
    db: Database = Depends(get_db),
):
    """
    Delete existing pipeline config and re-copy from a template.

    If body.template_name is provided, switch to that template (and save it on the target).
    Otherwise, reset to the target's currently stored template (falling back to default).
    """
    await _require_target(target_id, db)

    switching = body is not None and bool(body.template_name)
    template_name = body.template_name if switching else None

    if switching:
        tpl_row = await db.fetchone(
            "SELECT name, config FROM pipeline_templates WHERE name = ?", (template_name,)
        )
        if not tpl_row:
            raise HTTPException(status_code=404, detail="Template not found")
    else:
        # Use the target's stored template
        target_row = await db.fetchone(
            "SELECT pipeline_template FROM targets WHERE id = ?", (target_id,)
        )
        stored_name = target_row["pipeline_template"] if target_row else "standard"
        tpl_row = await db.fetchone(
            "SELECT name, config FROM pipeline_templates WHERE name = ?", (stored_name,)
        )
        if not tpl_row:
            tpl_row = await db.fetchone(
                "SELECT name, config FROM pipeline_templates WHERE is_default=1 LIMIT 1", ()
            )
        if not tpl_row:
            raise HTTPException(status_code=500, detail="No pipeline template found")

    # Delete and re-insert atomically — a half-reset would leave a broken pipeline
    config = json.loads(tpl_row["config"])
    async with db.transaction():
        # Delete existing groups (cascades to steps via FK)
        await db.execute("DELETE FROM pipeline_groups WHERE target_id=?", (target_id,))

        # Re-insert from template
        for group_def in config.get("groups", []):
            group_id = str(uuid.uuid4())
            await db.execute(
                """
                INSERT INTO pipeline_groups (id, target_id, position, name, parallel, enabled)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (group_id, target_id, group_def["position"], group_def["name"],
                 int(group_def.get("parallel", False))),
            )
            for step_def in group_def.get("steps", []):
                step_row_id = str(uuid.uuid4())
                await db.execute(
                    """
                    INSERT INTO pipeline_steps (id, group_id, target_id, position, step_id, enabled)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    (step_row_id, group_id, target_id, step_def["position"], step_def["step_id"]),
                )

        # If switching templates, persist the new template name on the target
        if switching:
            await db.execute(
                "UPDATE targets SET pipeline_template=? WHERE id=?",
                (tpl_row["name"], target_id),
            )

    return {"reset": True, "template": tpl_row["name"]}


# ── Reset params only (mode=params) ────────────────────────────────────────────

@router.post("/targets/{target_id}/pipeline/reset-params", status_code=200)
async def reset_pipeline_params(
    target_id: str,
    db: Database = Depends(get_db),
):
    """
    Reset all config_overrides to NULL (template defaults) without touching
    the group structure or step enable/disable state.

    Safer than full reset: group additions/rearrangements are preserved.
    """
    await _require_target(target_id, db)
    await db.execute(
        "UPDATE pipeline_steps SET config_overrides=NULL WHERE target_id=?",
        (target_id,),
    )
    await db.commit()
    return {"reset_params": True}


# ── Template listing ───────────────────────────────────────────────────────────

@router.get("/pipeline/templates")
async def list_templates(db: Database = Depends(get_db)):
    rows = await db.fetchall(
        "SELECT id, name, display_name, description, is_default FROM pipeline_templates",
        (),
    )
    return [
        {
            "id":           r["id"],
            "name":         r["name"],
            "display_name": r["display_name"],
            "description":  r["description"],
            "is_default":   bool(r["is_default"]),
        }
        for r in rows
    ]


# ── Save current pipeline as custom template ───────────────────────────────────

@router.post("/targets/{target_id}/pipeline/save-as-template", status_code=201)
async def save_as_template(
    target_id: str,
    body: dict,
    db: Database = Depends(get_db),
):
    """Save the current target pipeline as a reusable custom template."""
    await _require_target(target_id, db)

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")
    description = (body.get("description") or "").strip() or None

    # Check for name collision
    existing = await db.fetchone(
        "SELECT id FROM pipeline_templates WHERE name = ?", (name,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="A template with that name already exists")

    # Read full pipeline config for this target
    groups = await db.fetchall(
        "SELECT id, position, name, parallel, enabled FROM pipeline_groups "
        "WHERE target_id = ? ORDER BY position",
        (target_id,),
    )
    config_groups = []
    for g in groups:
        steps = await db.fetchall(
            "SELECT position, step_id, enabled FROM pipeline_steps "
            "WHERE group_id = ? ORDER BY position",
            (g["id"],),
        )
        config_groups.append({
            "id":       f"g{g['position']:02d}",
            "name":     g["name"],
            "position": g["position"],
            "parallel": bool(g["parallel"]),
            "steps": [
                {
                    "step_id":  s["step_id"],
                    "position": s["position"],
                    "enabled":  bool(s["enabled"]),
                }
                for s in steps
            ],
        })

    config = json.dumps({"groups": config_groups})
    template_id = str(uuid.uuid4())

    await db.execute(
        """
        INSERT INTO pipeline_templates (id, name, display_name, description, is_default, config)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (template_id, name, name, description, config),
    )
    await db.commit()

    log.info("Saved custom template %r (id=%s) from target %s", name, template_id, target_id)
    return {"id": template_id, "name": name, "display_name": name, "is_default": False}


# ── Template CRUD ─────────────────────────────────────────────────────────────

@router.post("/pipeline/templates", status_code=201)
async def create_template(body: PipelineTemplateCreate, db: Database = Depends(get_db)):
    """Create a new custom pipeline template from scratch."""
    existing = await db.fetchone(
        "SELECT id FROM pipeline_templates WHERE name = ?", (body.name,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="A template with that name already exists")

    _validate_template_config(body.config)

    template_id = str(uuid.uuid4())
    config_json = json.dumps(body.config)

    await db.execute(
        """
        INSERT INTO pipeline_templates (id, name, display_name, description, is_default, config)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (template_id, body.name, body.display_name, body.description, config_json),
    )
    await db.commit()
    log.info("Created custom template %r (id=%s)", body.name, template_id)
    return {
        "id":           template_id,
        "name":         body.name,
        "display_name": body.display_name,
        "description":  body.description,
        "is_default":   False,
    }


@router.get("/pipeline/templates/{template_id}")
async def get_template(template_id: str, db: Database = Depends(get_db)):
    """Get a single template including its full config."""
    row = await db.fetchone(
        "SELECT id, name, display_name, description, is_default, config FROM pipeline_templates WHERE id = ?",
        (template_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    config = json.loads(row["config"]) if row["config"] else {}
    return {
        "id":           row["id"],
        "name":         row["name"],
        "display_name": row["display_name"],
        "description":  row["description"],
        "is_default":   bool(row["is_default"]),
        "config":       config,
    }


@router.put("/pipeline/templates/{template_id}")
async def update_template(
    template_id: str,
    body: PipelineTemplateUpdate,
    db: Database = Depends(get_db),
):
    """Update a custom template (built-in templates cannot be modified)."""
    row = await db.fetchone(
        "SELECT id, is_default, display_name, description FROM pipeline_templates WHERE id = ?",
        (template_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    if row["is_default"]:
        raise HTTPException(status_code=403, detail="Built-in templates cannot be modified")

    updates: list[str] = []
    params: list = []
    if body.display_name is not None:
        updates.append("display_name = ?")
        params.append(body.display_name)
    if body.description is not None:
        updates.append("description = ?")
        params.append(body.description)
    if body.config is not None:
        updates.append("config = ?")
        params.append(json.dumps(body.config))

    if body.config is not None:
        _validate_template_config(body.config)

    if updates:
        params.append(template_id)
        await db.execute(
            f"UPDATE pipeline_templates SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )
        await db.commit()
        log.info("Updated custom template %s", template_id)

    updated = await db.fetchone(
        "SELECT id, name, display_name, description, is_default FROM pipeline_templates WHERE id = ?",
        (template_id,),
    )
    return {
        "id":           updated["id"],
        "name":         updated["name"],
        "display_name": updated["display_name"],
        "description":  updated["description"],
        "is_default":   bool(updated["is_default"]),
    }


@router.post("/pipeline/templates/{template_id}/clone", status_code=201)
async def clone_template(
    template_id: str,
    body: PipelineTemplateClone = PipelineTemplateClone(),
    db: Database = Depends(get_db),
):
    """Clone any template (including built-in) as a new custom template."""
    source = await db.fetchone(
        "SELECT id, display_name, config FROM pipeline_templates WHERE id = ?",
        (template_id,),
    )
    if not source:
        raise HTTPException(status_code=404, detail="Template not found")

    base_display = body.display_name or f"{source['display_name']} (copy)"
    base_name = body.name or f"{source['display_name'].lower().replace(' ', '_')}_copy"

    # Ensure unique name (append counter if needed)
    candidate_name = base_name
    counter = 1
    while await db.fetchone("SELECT id FROM pipeline_templates WHERE name = ?", (candidate_name,)):
        candidate_name = f"{base_name}_{counter}"
        counter += 1

    new_id = str(uuid.uuid4())
    await db.execute(
        """
        INSERT INTO pipeline_templates (id, name, display_name, description, is_default, config)
        SELECT ?, ?, ?, description, 0, config
        FROM pipeline_templates WHERE id = ?
        """,
        (new_id, candidate_name, base_display, template_id),
    )
    await db.commit()
    log.info("Cloned template %s → %s (id=%s)", template_id, candidate_name, new_id)
    return {
        "id":           new_id,
        "name":         candidate_name,
        "display_name": base_display,
        "is_default":   False,
    }


# ── Delete custom template ─────────────────────────────────────────────────────

@router.delete("/pipeline/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, db: Database = Depends(get_db)):
    """Delete a custom (non-built-in) pipeline template."""
    row = await db.fetchone(
        "SELECT id, is_default FROM pipeline_templates WHERE id = ?",
        (template_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    if row["is_default"]:
        raise HTTPException(status_code=403, detail="Built-in templates cannot be deleted")

    await db.execute(
        "DELETE FROM pipeline_templates WHERE id = ? AND is_default = 0",
        (template_id,),
    )
    await db.commit()
    log.info("Deleted custom template %s", template_id)


# ── Mid-run skip ───────────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/sessions/{session_id}/steps/{step_id}/skip")
async def skip_step(
    target_id: str,
    session_id: str,
    step_id: str,
    db: Database = Depends(get_db),
):
    """
    Request a mid-run skip for a step.
    - If the step is pending, queues a skip (runner checks before execution).
    - If the step is running, cancels the asyncio Task immediately.
    Returns {"killed": bool, "queued": bool}.
    """
    await _require_target(target_id, db)

    step_cls = STEP_REGISTRY.get(step_id)
    if step_cls is None:
        raise HTTPException(status_code=404, detail="Step not found in registry")
    if not step_cls.skippable:
        raise HTTPException(status_code=400, detail="This step cannot be skipped")

    was_running = signals.request_skip(session_id, step_id)
    return {"killed": was_running, "queued": not was_running}
