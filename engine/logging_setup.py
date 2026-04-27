import logging
import os
from logging.handlers import RotatingFileHandler

from engine.middleware import RequestIDLogFilter


class _SafeFormatter(logging.Formatter):
    """
    Formatter that never raises KeyError for missing log record attributes.
    Background asyncio tasks (scheduler, pipeline runner) don't go through
    HTTP request middleware, so `request_id` may not be set on the record
    even though RequestIDLogFilter is on the root logger.  This class
    provides a safe default so the formatter never crashes.
    """

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return super().format(record)


def setup_logging(log_path: str, log_level: str = "INFO") -> None:
    """Configure structured logging: rotating file + console."""
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    safe_fmt = _SafeFormatter(
        "%(asctime)s [%(levelname)s] %(name)s [%(request_id)s]: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    console = logging.StreamHandler()
    console.setFormatter(safe_fmt)
    console.setLevel(logging.INFO)

    try:
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=50_000_000,  # 50 MB
            backupCount=5,
        )
        file_handler.setFormatter(safe_fmt)
        file_handler.setLevel(logging.DEBUG)
    except OSError:
        # /data/logs may not exist in dev without Docker volumes
        file_handler = None

    root = logging.getLogger()
    # Install once — reads request ID from ContextVar, race-free in async code
    root.addFilter(RequestIDLogFilter())
    root.addHandler(console)
    if file_handler:
        root.addHandler(file_handler)
    root.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Silence noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)


# Named loggers — use these throughout the codebase
log_engine    = logging.getLogger("engine")
log_scheduler = logging.getLogger("engine.sched")
log_pipeline  = logging.getLogger("engine.pipe")
log_tools     = logging.getLogger("engine.tools")
log_db        = logging.getLogger("engine.db")
log_api       = logging.getLogger("engine.api")
log_ws        = logging.getLogger("engine.ws")
log_notify    = logging.getLogger("engine.notify")
