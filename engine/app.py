import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, WebSocket
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from engine.api.schemas import ErrorResponse
from engine.config import get_settings
from engine.crypto import CryptoError
from engine.db import init_database, set_db, SecurityError
from engine.logging_setup import setup_logging
from engine.middleware import RequestIDMiddleware, _request_id_ctx
from engine.websocket import ws_manager, websocket_endpoint, set_allowed_origins
from engine.api import health, targets, scope, notifications
from engine.api import programs as programs_api
from engine.api import settings as settings_api
from engine.api import scans, pipeline_config, scheduler_api
from engine.api import wordlists_api
from engine.api import export as export_api
from engine.api import search as search_api
from engine.api import stats as stats_api
from engine.api import webhooks as webhooks_api
from engine.api import report_schedules as report_schedules_api

import os
import shutil
from typing import Optional as _Optional

log = logging.getLogger("engine")

_telegram_bot: _Optional["TelegramBot"] = None

_STATUS_TO_CODE: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    502: "bad_gateway",
}

_RESOLVER_SRC_DIR  = "/app/wordlists/resolvers"
_RESOLVER_DEST_DIR = "/data/resolvers"
_RESOLVER_FILES    = ["resolvers.txt", "resolvers-trusted.txt"]


def _seed_resolvers() -> None:
    """
    Copy baked resolver lists from the image into /data/resolvers/ on first run.
    Safe to call on every startup — skips files that already exist.
    """
    os.makedirs(_RESOLVER_DEST_DIR, exist_ok=True)
    for fname in _RESOLVER_FILES:
        src  = os.path.join(_RESOLVER_SRC_DIR, fname)
        dest = os.path.join(_RESOLVER_DEST_DIR, fname)
        if os.path.isfile(dest):
            continue
        if not os.path.isfile(src):
            log.warning("Resolver seed file not found: %s — puredns will fail until resolvers are updated", src)
            continue
        shutil.copy2(src, dest)
        log.info("Seeded resolvers: %s → %s", src, dest)


def _get_real_ip(request: Request) -> str:
    """
    Extract the real client IP for rate limiting.
    Trusts X-Real-IP set by nginx ($remote_addr) — not forgeable through nginx.
    Falls back through X-Forwarded-For to direct client host.
    """
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _restart_telegram_bot() -> None:
    """Stop current bot (if any) and start a new one if conditions are met."""
    global _telegram_bot
    from engine.db import get_db
    from engine.crypto import decrypt, CryptoError

    db = await get_db()
    rows = await db.fetchall(
        "SELECT key, value FROM settings WHERE key LIKE 'telegram.%'"
    )
    cfg = {r["key"]: r["value"] for r in rows}

    if _telegram_bot is not None:
        await _telegram_bot.stop()
        _telegram_bot = None
        log.info("TelegramBot stopped for restart")

    if (
        cfg.get("telegram.enabled") == "true"
        and cfg.get("telegram.commands_enabled") == "true"
    ):
        token_enc = cfg.get("telegram.bot_token")
        chat_id   = cfg.get("telegram.chat_id")
        if token_enc and chat_id:
            try:
                token = decrypt(token_enc)
            except CryptoError:
                log.warning("Cannot start TelegramBot — failed to decrypt bot token")
                return
            from engine.telegram_bot import TelegramBot
            _telegram_bot = TelegramBot(token=token, chat_id=chat_id)
            await _telegram_bot.start()
            log.info("TelegramBot (re)started after config change")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    global _telegram_bot
    settings = get_settings()

    # --- STARTUP ---
    setup_logging(settings.log_path, settings.log_level)
    log.info("Starting RECON_APP engine (env=%s)", settings.environment)

    # Init database + run migrations
    db = await init_database(settings.db_path)
    set_db(db)
    log.info("Database ready: %s", settings.db_path)

    # Start WebSocket manager
    ws_manager.start()

    # Configure allowed WS origins from settings
    set_allowed_origins(settings.allowed_origins)
    log.info("Allowed origins: %s", settings.allowed_origins)

    # Seed resolvers from baked image copy if not present on the data volume.
    # Resolvers are downloaded during image build into /app/wordlists/resolvers/.
    # puredns reads from /data/resolvers/ (runtime, persistent, updatable).
    _seed_resolvers()

    # Crash recovery: mark interrupted sessions as paused
    from engine import scheduler
    await scheduler.recover_running_sessions(db)

    # Start scheduler tick loop
    scheduler.start(db)
    log.info("Scheduler started")

    # Start Telegram bot if configured and commands enabled
    try:
        tg_rows = await db.fetchall(
            "SELECT key, value FROM settings WHERE key LIKE 'telegram.%'"
        )
        tg_cfg = {r["key"]: r["value"] for r in tg_rows}
        if (
            tg_cfg.get("telegram.enabled") == "true"
            and tg_cfg.get("telegram.commands_enabled") == "true"
        ):
            token_enc = tg_cfg.get("telegram.bot_token")
            chat_id   = tg_cfg.get("telegram.chat_id")
            if token_enc and chat_id:
                from engine.crypto import decrypt, CryptoError
                try:
                    token = decrypt(token_enc)
                    from engine.telegram_bot import TelegramBot
                    _telegram_bot = TelegramBot(token=token, chat_id=chat_id)
                    await _telegram_bot.start()
                    log.info("TelegramBot started on startup")
                except CryptoError:
                    log.warning("Cannot start TelegramBot — failed to decrypt token")
    except Exception as exc:
        log.warning("Could not initialize TelegramBot: %s", exc)

    # Background version check for installed tools (24hr cache)
    try:
        import asyncio as _asyncio
        from engine.tools.version_check import get_cached_versions, run_version_checks
        cached = await get_cached_versions(db)
        if not cached:
            _asyncio.create_task(run_version_checks(db))
    except Exception as exc:
        log.warning("Could not schedule version check: %s", exc)

    # Seed Prometheus gauges from DB
    try:
        from engine.metrics import targets_total, subdomains_total, live_hosts_total
        row = await db.fetchone("SELECT COUNT(*) AS n FROM targets")
        if row:
            targets_total.set(row["n"])
        row = await db.fetchone("SELECT COUNT(*) AS n FROM subdomains")
        if row:
            subdomains_total.set(row["n"])
        row = await db.fetchone("SELECT COUNT(*) AS n FROM live_hosts")
        if row:
            live_hosts_total.set(row["n"])
    except Exception as exc:
        log.warning("Could not seed Prometheus gauges: %s", exc)

    log.info("Engine startup complete")
    yield

    # --- SHUTDOWN ---
    log.info("Engine shutting down")
    if _telegram_bot is not None:
        await _telegram_bot.stop()
        log.info("TelegramBot stopped on shutdown")
    scheduler.stop()
    await db.close()
    log.info("Database closed")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="RECON_APP",
        version="0.1.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )

    # Host header validation — prevents Host header injection attacks
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.trusted_hosts,
    )

    # Rate limiter — uses real client IP from nginx X-Real-IP header
    limiter = Limiter(key_func=_get_real_ip)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # CORS — origins from settings, never wildcard
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Request-ID"],
        max_age=600,
    )

    # Request ID
    app.add_middleware(RequestIDMiddleware)

    # Routers
    app.include_router(health.router,         prefix="/api/v1")
    app.include_router(targets.router,        prefix="/api/v1")
    app.include_router(programs_api.router,   prefix="/api/v1")
    app.include_router(scope.router,          prefix="/api/v1")
    app.include_router(notifications.router,  prefix="/api/v1")
    app.include_router(settings_api.router,   prefix="/api/v1")
    app.include_router(scans.router,          prefix="/api/v1")
    app.include_router(pipeline_config.router, prefix="/api/v1")
    app.include_router(scheduler_api.router,  prefix="/api/v1")
    app.include_router(wordlists_api.router)
    app.include_router(export_api.router,     prefix="/api/v1")
    app.include_router(search_api.router,     prefix="/api/v1")
    app.include_router(stats_api.router,      prefix="/api/v1")
    app.include_router(webhooks_api.router)
    app.include_router(report_schedules_api.router, prefix="/api/v1")

    # WebSocket endpoint
    app.add_api_websocket_route("/ws", websocket_endpoint)

    # ── Global exception handlers ─────────────────────────────────────────────
    # Specific handlers first, then the catch-all Exception handler last.

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", _request_id_ctx.get())
        code = _STATUS_TO_CODE.get(exc.status_code, "error")
        body = ErrorResponse(
            error=code,
            detail=str(exc.detail),
            status=exc.status_code,
            request_id=request_id,
        )
        return JSONResponse(status_code=exc.status_code, content=body.model_dump())

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", _request_id_ctx.get())
        body = ErrorResponse(
            error="validation_error",
            detail=str(exc.errors()),
            status=422,
            request_id=request_id,
        )
        return JSONResponse(status_code=422, content=body.model_dump())

    @app.exception_handler(SecurityError)
    async def security_error_handler(request: Request, exc: SecurityError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", _request_id_ctx.get())
        log.error("SecurityError on %s %s: %s", request.method, request.url.path, exc)
        body = ErrorResponse(
            error="security_violation",
            detail=str(exc),
            status=400,
            request_id=request_id,
        )
        return JSONResponse(status_code=400, content=body.model_dump())

    @app.exception_handler(CryptoError)
    async def crypto_error_handler(request: Request, exc: CryptoError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", _request_id_ctx.get())
        log.error("CryptoError on %s %s", request.method, request.url.path, exc_info=True)
        body = ErrorResponse(
            error="crypto_error",
            detail="Encryption operation failed",
            status=500,
            request_id=request_id,
        )
        return JSONResponse(status_code=500, content=body.model_dump())

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", _request_id_ctx.get())
        log.error(
            "Unhandled exception on %s %s [%s]: %r",
            request.method, request.url.path, request_id, exc,
            exc_info=True,
        )
        body = ErrorResponse(
            error="internal_error",
            detail="An unexpected error occurred",
            status=500,
            request_id=request_id,
        )
        return JSONResponse(status_code=500, content=body.model_dump())

    return app


app = create_app()
