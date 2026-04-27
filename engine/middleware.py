import uuid
import logging
import contextvars
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Per-coroutine context variable — safe in async code.
# Unlike adding/removing a root logger filter per-request (which races in async),
# ContextVar is isolated per asyncio Task and cannot bleed between concurrent requests.
_request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)

log = logging.getLogger("engine.api")


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Generates a UUID per request, attaches it as X-Request-ID response header,
    and injects it into all log records produced during that request.

    Security: always generates our own UUID — never trusts the client-supplied
    X-Request-ID header to prevent log injection attacks.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        token = _request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
        finally:
            _request_id_ctx.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestIDLogFilter(logging.Filter):
    """
    Install ONCE on the root logger at startup (see logging_setup.py).
    Reads request ID from the ContextVar — correct and race-free in async code.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_ctx.get()
        return True
