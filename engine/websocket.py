import json
import logging
from datetime import datetime, timezone
from typing import Any
from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger("engine.ws")

# Allowed origins for WebSocket connections (populated from config on startup)
_allowed_origins: list[str] = []

MAX_MESSAGE_BYTES = 64 * 1024  # 64 KB
MAX_WS_CONNECTIONS = 50        # DoS guard — generous for a single-user tool


class WebSocketManager:
    """
    Manages all active WebSocket connections.
    Output-only: the server pushes events, clients never send data.
    Single-worker model — no Redis needed.
    """

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    def start(self) -> None:
        log.info("WebSocket manager started")

    async def connect(self, websocket: WebSocket) -> bool:
        """
        Accept the connection after origin validation.
        Returns False if the origin is not allowed (connection will be closed).
        Fails closed: if no allowed origins are configured, all connections are rejected.
        """
        origin = websocket.headers.get("origin", "")
        if not _allowed_origins:
            log.error("WS connection rejected — no allowed origins configured")
            await websocket.close(code=4003)
            return False
        if origin not in _allowed_origins:
            log.warning("WS connection rejected — origin not allowed: %s", origin)
            await websocket.close(code=4003)
            return False

        if len(self._connections) >= MAX_WS_CONNECTIONS:
            log.warning("WS connection rejected — connection limit reached (%d)", MAX_WS_CONNECTIONS)
            await websocket.close(code=1008)  # Policy Violation
            return False

        await websocket.accept()
        self._connections.append(websocket)
        log.debug("WS client connected — total: %d", len(self._connections))
        try:
            from engine.metrics import ws_connections
            ws_connections.inc()
        except Exception:
            pass
        return True

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.remove(websocket)
        log.debug("WS client disconnected — total: %d", len(self._connections))
        try:
            from engine.metrics import ws_connections
            ws_connections.dec()
        except Exception:
            pass

    async def broadcast(self, event_type: str, data: dict[str, Any],
                        target_id: str | None = None,
                        session_id: str | None = None) -> None:
        """Push an event to all connected clients."""
        payload = {
            "type": event_type,
            "target_id": target_id,
            "session_id": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }
        message = json.dumps(payload)

        if len(message.encode()) > MAX_MESSAGE_BYTES:
            log.warning("WS message exceeds 64 KB limit, truncating data")
            payload["data"] = {"error": "payload_too_large"}
            message = json.dumps(payload)

        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        for ws in dead:
            if ws in self._connections:
                self._connections.remove(ws)


ws_manager = WebSocketManager()


async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    FastAPI WebSocket endpoint handler.
    Output-only: we ignore any data sent by the client.
    """
    accepted = await ws_manager.connect(websocket)
    if not accepted:
        return

    try:
        while True:
            # Drain any client messages (we never act on them — output-only)
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        log.warning("WS error: %s", e)
        ws_manager.disconnect(websocket)


def set_allowed_origins(origins: list[str]) -> None:
    global _allowed_origins
    _allowed_origins = origins
