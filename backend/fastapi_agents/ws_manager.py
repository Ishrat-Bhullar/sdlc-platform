"""
ws_manager.py
=============
Manages WebSocket connections and broadcasts Section-16 events to every
client subscribed to a given project_id.

Usage in main_extension.py
---------------------------
    from ws_manager import manager
    await manager.connect(websocket, project_id)
    await manager.broadcast(project_id, WsEvent(...))

Section 16 event types supported
----------------------------------
    agent_started         — fired when an agent_run transitions to running
    agent_completed       — fired when an agent_run transitions to completed/failed
    artifact_generated    — fired when a new generated_artifact row is committed
    approval_requested    — fired when an approval row is created (status=pending_approval)
    approval_completed    — fired when an approval is decided (approved/rejected/published)
    review_completed      — fired when a review_result row is committed
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime

from fastapi import WebSocket

logger = logging.getLogger(__name__)


def _json_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serialisable")


class ConnectionManager:
    def __init__(self):
        # project_id -> list[WebSocket]
        self._connections: dict[int, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, project_id: int) -> None:
        await websocket.accept()
        self._connections[project_id].append(websocket)
        logger.info("WS connected  project=%s  total=%s", project_id, len(self._connections[project_id]))

    def disconnect(self, websocket: WebSocket, project_id: int) -> None:
        conns = self._connections.get(project_id, [])
        if websocket in conns:
            conns.remove(websocket)
            logger.info("WS disconnected  project=%s  remaining=%s", project_id, len(conns))
        # Clean up empty lists to avoid memory leaks
        if not conns:
            self._connections.pop(project_id, None)

    async def broadcast(self, project_id: int, event: dict) -> None:
        """Send event dict to every socket subscribed to project_id."""
        if "timestamp" not in event:
            event["timestamp"] = datetime.utcnow().isoformat()
        payload = json.dumps(event, default=_json_default)

        dead: list[WebSocket] = []
        for ws in list(self._connections.get(project_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws, project_id)

    async def send_personal(self, websocket: WebSocket, event: dict) -> None:
        if "timestamp" not in event:
            event["timestamp"] = datetime.utcnow().isoformat()
        await websocket.send_text(json.dumps(event, default=_json_default))

    def active_count(self, project_id: int) -> int:
        return len(self._connections.get(project_id, []))

    # ------------------------------------------------------------------
    # Event broadcast helpers used by agent_runner.py and other components
    # ------------------------------------------------------------------
    # All methods accept a payload dict for flexibility with agent_runner

    async def agent_started(self, project_id: int, payload: dict) -> None:
        """Broadcast agent_started event when an agent_run transitions to running."""
        await self.broadcast(project_id, {
            "event": "agent_started",
            "project_id": project_id,
            "payload": payload,
        })

    async def agent_completed(self, project_id: int, payload: dict) -> None:
        """Broadcast agent_completed event when an agent_run transitions to completed/failed."""
        await self.broadcast(project_id, {
            "event": "agent_completed",
            "project_id": project_id,
            "payload": payload,
        })

    async def artifact_generated(self, project_id: int, payload: dict) -> None:
        """Broadcast artifact_generated event when a new generated_artifact row is committed."""
        await self.broadcast(project_id, {
            "event": "artifact_generated",
            "project_id": project_id,
            "payload": payload,
        })

    async def approval_requested(self, project_id: int, payload: dict) -> None:
        """Broadcast approval_requested event when an approval row is created (status=pending_approval)."""
        await self.broadcast(project_id, {
            "event": "approval_requested",
            "project_id": project_id,
            "payload": payload,
        })

    async def approval_completed(self, project_id: int, approval_id: int, status: str, decided_by: int) -> None:
        """Broadcast approval_completed event when an approval is decided (approved/rejected/published)."""
        await self.broadcast(project_id, {
            "event": "approval_completed",
            "project_id": project_id,
            "payload": {
                "approval_id": approval_id,
                "status": status,
                "decided_by": decided_by,
            },
        })

    async def review_completed(self, project_id: int, review_type: str, score: float, risk_level: str) -> None:
        """Broadcast review_completed event when a review_result row is committed."""
        await self.broadcast(project_id, {
            "event": "review_completed",
            "project_id": project_id,
            "payload": {
                "review_type": review_type,
                "score": score,
                "risk_level": risk_level,
            },
        })

    # ------------------------------------------------------------------
    # Live code-generation streaming (simulated replay of already-generated
    # files — see agents.developer_studio.agent.DeveloperStudioAgent.stream_generated_files)
    # ------------------------------------------------------------------
    async def code_gen_started(self, project_id: int, payload: dict) -> None:
        await self.broadcast(project_id, {"event": "code_gen_started", "project_id": project_id, "payload": payload})

    async def code_chunk(self, project_id: int, payload: dict) -> None:
        await self.broadcast(project_id, {"event": "code_chunk", "project_id": project_id, "payload": payload})

    async def code_gen_completed(self, project_id: int, payload: dict) -> None:
        await self.broadcast(project_id, {"event": "code_gen_completed", "project_id": project_id, "payload": payload})


# Singleton shared across the whole application
manager = ConnectionManager()
