"""WebSocket /ws/live 실시간 푸시. 접속하면 바로 현재 상태를 보내고 이후 주기적으로 갱신한다."""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.services import live

router = APIRouter()


@router.websocket("/ws/live")
async def live_feed(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            for message in live.build_snapshot():
                await websocket.send_json(message.model_dump(mode="json", by_alias=True))
            await asyncio.sleep(settings.ws_push_interval_seconds)
    except WebSocketDisconnect:
        pass
