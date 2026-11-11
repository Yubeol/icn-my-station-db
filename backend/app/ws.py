"""WebSocket /ws/live 실시간 푸시. 접속하면 바로 현재 상태를 보내고 이후 주기적으로 갱신한다.

기존 8개 메시지(congestion 2, flights 2, stats 2, alerts, weather)는 ws_push_interval_seconds마다 한 묶음으로 보낸다.
yolo_* 메시지(docs/yolo-demo-contract.md 5장)는 이 주기와 별도로 허브에서 받아 보낸다.
한 연결에 동시에 두 곳에서 쓰지 않도록 락을 잡고, 8개 묶음은 락을 잡은 채 연속으로 보내므로
yolo 메시지는 묶음 사이에만 끼어든다. 기존 8개의 순서와 주기는 바뀌지 않는다.
"""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.yolo_hub import hub
from app.schemas import LiveMessage
from app.services import live

router = APIRouter()


async def _send(websocket: WebSocket, message: LiveMessage) -> None:
    await websocket.send_json(message.model_dump(mode="json", by_alias=True))


async def _forward_yolo(websocket: WebSocket, lock: asyncio.Lock, queue: asyncio.Queue) -> None:
    """허브가 발행한 yolo_* 메시지를 이 연결로 보낸다."""
    try:
        while True:
            message = await queue.get()
            async with lock:
                await _send(websocket, message)
    except (WebSocketDisconnect, RuntimeError):
        pass  # 연결이 끊겼다. 본문 루프가 다음 전송에서 정리한다.


@router.websocket("/ws/live")
async def live_feed(websocket: WebSocket):
    await websocket.accept()
    lock = asyncio.Lock()
    queue = hub.subscribe_live()  # 스냅샷을 만드는 동안 생긴 변경도 놓치지 않도록 먼저 구독한다
    forwarder = asyncio.create_task(_forward_yolo(websocket, lock, queue))
    try:
        first = True
        while True:
            # DB 조회가 이벤트 루프와 다른 API 응답을 막지 않도록 별도 스레드에서 만든다.
            messages = await asyncio.to_thread(live.build_snapshot)
            async with lock:
                for message in messages:
                    await _send(websocket, message)
            if first:
                first = False
                cameras = await asyncio.to_thread(live.fetch_yolo_cameras)
                async with lock:
                    for message in live.build_yolo_snapshot(cameras):
                        await _send(websocket, message)
            await asyncio.sleep(settings.ws_push_interval_seconds)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        forwarder.cancel()
        hub.unsubscribe_live(queue)
        with contextlib.suppress(asyncio.CancelledError):
            await forwarder
