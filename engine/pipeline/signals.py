"""
In-memory skip request registry + asyncio task registry.

Lifecycle per session:
  register_task()    — called by runner when step starts
  unregister_task()  — called by runner when step ends (finally)
  request_skip()     — called by skip API endpoint
  is_pending_skip()  — polled by runner before executing each step
  cleanup_session()  — called when run_pipeline() completes
"""
from __future__ import annotations
import asyncio
import logging

log = logging.getLogger("engine.pipeline.signals")

# session_id → set of step_ids to skip
_skip_requests: dict[str, set[str]] = {}

# "session_id:step_id" → asyncio.Task
_step_tasks: dict[str, asyncio.Task] = {}


def request_skip(session_id: str, step_id: str) -> bool:
    """Queue skip. If step is running, cancels its Task. Returns True if Task was cancelled."""
    _skip_requests.setdefault(session_id, set()).add(step_id)
    key = f"{session_id}:{step_id}"
    task = _step_tasks.get(key)
    if task and not task.done():
        task.cancel()
        log.info("signals: cancelled running task %s / %s", session_id[:8], step_id)
        return True
    return False


def is_pending_skip(session_id: str, step_id: str) -> bool:
    return step_id in _skip_requests.get(session_id, set())


def register_task(session_id: str, step_id: str, task: asyncio.Task) -> None:
    _step_tasks[f"{session_id}:{step_id}"] = task


def unregister_task(session_id: str, step_id: str) -> None:
    _step_tasks.pop(f"{session_id}:{step_id}", None)


def cleanup_session(session_id: str) -> None:
    _skip_requests.pop(session_id, None)
    prefix = f"{session_id}:"
    for key in list(_step_tasks):
        if key.startswith(prefix):
            del _step_tasks[key]
    log.debug("signals: cleaned up session %s", session_id[:8])
