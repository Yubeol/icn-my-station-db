"""WebSocket /ws/yolo/camera, /ws/yolo/worker, /ws/yolo/view (docs/yolo-demo-contract.md 2~4장).

토큰 오류(4401)·미등록 카메라(4404)는 핸드셰이크 전에 거부하면 HTTP 403이 되어 코드가 전달되지 않으므로,
먼저 accept한 뒤 해당 코드로 닫는다.
"""

import asyncio
import contextlib
import json
import secrets

from fastapi import APIRouter, WebSocket
from pydantic import SecretStr

from app.core import rules
from app.core.config import settings
from app.core.yolo_hub import Viewer, hub
from app.services import yolo_store
from app.services.yolo_types import YoloCameraInfo

router = APIRouter()


def _token_ok(given: str | None, expected: SecretStr | None) -> bool:
    """토큰이 설정되지 않았으면 모든 연결을 거부한다."""
    if not given or expected is None or not expected.get_secret_value():
        return False
    return secrets.compare_digest(given.encode(), expected.get_secret_value().encode())


async def _find_camera(raw: str | None) -> YoloCameraInfo | None:
    try:
        camera_id = int(raw) if raw is not None else None
    except ValueError:
        return None
    if camera_id is None:
        return None
    info = await asyncio.to_thread(yolo_store.get_camera, camera_id)
    return info if info is not None and info.is_active else None


async def _reject(ws: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):
        await ws.close(code=code)


async def _drain(ws: WebSocket):
    """연결이 끝날 때까지 받은 메시지를 하나씩 내보낸다."""
    while True:
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            return
        yield message


@router.websocket("/ws/yolo/camera")
async def yolo_camera(ws: WebSocket, cameraId: str | None = None, token: str | None = None):
    await ws.accept()
    if not _token_ok(token, settings.yolo_camera_token):
        return await _reject(ws, rules.YOLO_CLOSE_BAD_TOKEN)
    info = await _find_camera(cameraId)
    if info is None:
        return await _reject(ws, rules.YOLO_CLOSE_UNKNOWN_CAMERA)

    state = hub.state_for(info)
    await hub.attach_camera(state, ws)
    try:
        await ws.send_json(
            {"type": "hello", "cameraId": info.camera_id, "maxFps": rules.YOLO_CAMERA_MAX_FPS}
        )
        async for message in _drain(ws):
            data = message.get("bytes")
            if data is not None:
                hub.on_frame(state, data)  # 잘못된 프레임은 조용히 버린다
    except RuntimeError:  # 닫힌 연결에 쓰기
        pass
    finally:
        await hub.detach_camera(state, ws)


@router.websocket("/ws/yolo/worker")
async def yolo_worker(ws: WebSocket, token: str | None = None):
    await ws.accept()
    if not _token_ok(token, settings.yolo_worker_token):
        return await _reject(ws, rules.YOLO_CLOSE_BAD_TOKEN)

    await hub.attach_worker(ws)
    sender = asyncio.create_task(hub.worker_sender(ws))
    try:
        async for message in _drain(ws):
            text = message.get("text")
            if text is None:
                continue
            try:
                payload = json.loads(text)
            except ValueError:
                continue
            await hub.on_worker_message(payload)
    except RuntimeError:
        pass
    finally:
        sender.cancel()
        await hub.detach_worker(ws)


@router.websocket("/ws/yolo/view")
async def yolo_view(ws: WebSocket, cameraId: str | None = None):
    await ws.accept()
    info = await _find_camera(cameraId)
    if info is None:
        return await _reject(ws, rules.YOLO_CLOSE_UNKNOWN_CAMERA)

    state = hub.state_for(info)
    viewer = Viewer(ws=ws, camera_id=info.camera_id)
    viewer.texts.append(hub.status_message(state))
    hub.add_viewer(viewer)
    sender = asyncio.create_task(hub.viewer_sender(viewer))
    try:
        async for _ in _drain(ws):  # 대시보드는 이 경로로 아무것도 보내지 않는다
            pass
    except RuntimeError:
        pass
    finally:
        sender.cancel()
        hub.remove_viewer(viewer)
