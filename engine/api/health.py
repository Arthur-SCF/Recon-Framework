import time
import logging
from fastapi import APIRouter, Request, Response
from engine.api.schemas import HealthResponse
from engine.db import get_db

log = logging.getLogger("engine.api")
router = APIRouter()

_start_time = time.time()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request) -> HealthResponse:
    """
    Basic health check used by Docker healthcheck and monitoring.
    Returns db connectivity status and process uptime in seconds.
    """
    db_ok = False
    try:
        db = await get_db()
        await db.fetchone("SELECT 1")
        db_ok = True
    except Exception as e:
        log.error("Health check: DB unreachable — %s", e)

    return HealthResponse(
        status="ok" if db_ok else "degraded",
        db=db_ok,
        uptime=round(time.time() - _start_time, 1),
    )


@router.get("/metrics")
async def prometheus_metrics() -> Response:
    """Prometheus metrics endpoint. Not authenticated — restrict at the network level."""
    from engine.metrics import REGISTRY, generate_latest, CONTENT_TYPE_LATEST
    data = generate_latest(REGISTRY)
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
