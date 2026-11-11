"""YOLO DEMO 허브. 카메라 프레임을 워커와 뷰어에게 중계하고 워커 결과를 뷰어에게 전달한다.

- 백엔드는 추론하지 않는다. JPEG은 디코딩하지 않고 그대로 중계하며, 로그·DB·디스크에 남기지 않는다.
- 프레임은 카메라마다 최신 1장만 들고 있다. 워커는 한 번에 한 장만 받고, 뷰어는 연결마다 최신 프레임 슬롯 1개를 가진다.
- 상태는 이벤트 루프 안에서만 바꾼다. DB 호출은 호출하는 쪽에서 asyncio.to_thread로 한다.
"""

import asyncio
import contextlib
import json
import logging
import struct
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from fastapi import WebSocket
from pydantic import BaseModel

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import LiveMessage, LiveTopic, YoloCameraLive, YoloConnState
from app.services.yolo_types import YoloCameraInfo

logger = logging.getLogger(__name__)

FRAME_HEADER_MAX_BYTES = 4096
_DETECTIONS_MAX = 200
_WORKER_POLL_SEC = 0.02
_VIEWER_POLL_SEC = 0.02
_LIVE_QUEUE_SIZE = 200


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def parse_frame_header(data: bytes) -> dict[str, Any] | None:
    """계약 1.2 프레임의 헤더 JSON만 읽는다. 형식이 틀리면 None. JPEG 부분은 열어 보지 않는다."""
    if len(data) < 5:
        return None
    (size,) = struct.unpack(">I", data[:4])
    if size == 0 or size > FRAME_HEADER_MAX_BYTES or 4 + size >= len(data):
        return None
    try:
        header = json.loads(data[4 : 4 + size].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(header, dict):
        return None
    if not _is_int(header.get("cameraId")) or not _is_int(header.get("frameId")):
        return None
    return header


@dataclass(eq=False)
class Viewer:
    ws: WebSocket
    camera_id: int
    slot: bytes | None = None  # 아직 못 보낸 최신 프레임 1장
    texts: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=50))


class CameraState:
    def __init__(self, info: YoloCameraInfo):
        self.info = info
        self.camera_ws: WebSocket | None = None
        self.latest_frame: bytes | None = None
        self.latest_frame_id: int | None = None
        self.frame_seq = 0  # 받은 프레임 번호(연결이 바뀌어도 계속 증가). frameId와 별개
        self.sent_seq = 0  # 워커에 마지막으로 보낸 frame_seq
        self.frame_at = 0.0
        self.last_result: dict[str, Any] | None = None
        self.last_person_count: int | None = None
        self.last_measured_at: datetime | None = None

    @property
    def camera_id(self) -> int:
        return self.info.camera_id

    @property
    def online(self) -> bool:
        return self.camera_ws is not None


ResultHook = Callable[[CameraState, dict[str, Any]], Awaitable[None]]
CameraHook = Callable[[CameraState], Awaitable[None]]


class YoloHub:
    def __init__(self) -> None:
        self.cameras: dict[int, CameraState] = {}
        self.viewers: dict[int, set[Viewer]] = {}
        self.live_subscribers: set[asyncio.Queue[LiveMessage]] = set()
        self.worker_ws: WebSocket | None = None
        self.worker_info: dict[str, Any] = {}
        self._inflight = False
        self._sent_at = 0.0
        self._last_send = 0.0
        # 결과 처리(저장·집계)와 카메라 연결 종료 시 정리는 yolo_results가 연결한다.
        self.on_result: ResultHook | None = None
        self.on_camera_closed: CameraHook | None = None

    def reset(self) -> None:
        """연결·상태를 비운다(테스트용). 결과 처리 연결(on_result 등)은 유지한다."""
        hooks = (self.on_result, self.on_camera_closed)
        self.__init__()
        self.on_result, self.on_camera_closed = hooks

    # ----- 상태 조회 -----

    @property
    def worker_online(self) -> bool:
        return self.worker_ws is not None

    @property
    def model_version(self) -> str:
        return str(self.worker_info.get("modelVersion") or "unknown")

    def state_for(self, info: YoloCameraInfo) -> CameraState:
        state = self.cameras.get(info.camera_id)
        if state is None:
            state = self.cameras[info.camera_id] = CameraState(info)
        else:
            state.info = info
        return state

    def _conn(self, online: bool) -> YoloConnState:
        return YoloConnState.ONLINE if online else YoloConnState.OFFLINE

    def status_message(self, state: CameraState) -> dict[str, Any]:
        return {
            "type": "status",
            "cameraId": state.camera_id,
            "camera": self._conn(state.online).value,
            "worker": self._conn(self.worker_online).value,
        }

    def camera_live(self, state: CameraState) -> YoloCameraLive:
        return YoloCameraLive(
            camera_id=state.camera_id,
            zone_id=state.info.zone_id,
            camera=self._conn(state.online),
            worker=self._conn(self.worker_online),
        )

    # ----- /ws/live 구독 -----

    def subscribe_live(self) -> asyncio.Queue[LiveMessage]:
        queue: asyncio.Queue[LiveMessage] = asyncio.Queue(maxsize=_LIVE_QUEUE_SIZE)
        self.live_subscribers.add(queue)
        return queue

    def unsubscribe_live(self, queue: asyncio.Queue[LiveMessage]) -> None:
        self.live_subscribers.discard(queue)

    def publish_live(self, topic: LiveTopic, scope: str | None, data: BaseModel) -> None:
        self.publish_live_message(
            LiveMessage(
                topic=topic,
                scope=scope,
                data=data.model_dump(mode="json", by_alias=True),
                sent_at=now_kst(),
            )
        )

    def publish_live_message(self, message: LiveMessage) -> None:
        for queue in self.live_subscribers:
            if queue.full():  # 느린 구독자는 가장 오래된 메시지부터 버린다
                queue.get_nowait()
            queue.put_nowait(message)

    # ----- 상태 변경 알림 -----

    def notify_status(self, state: CameraState) -> None:
        for viewer in self.viewers.get(state.camera_id, ()):
            viewer.texts.append(self.status_message(state))
        self.publish_live(LiveTopic.YOLO_CAMERA, state.info.scope, self.camera_live(state))

    def notify_all_status(self) -> None:
        for state in self.cameras.values():
            self.notify_status(state)

    # ----- 카메라 -----

    async def attach_camera(self, state: CameraState, ws: WebSocket) -> None:
        old, state.camera_ws = state.camera_ws, ws
        if old is not None:
            await _close(old, rules.YOLO_CLOSE_REPLACED)
        self.notify_status(state)

    async def detach_camera(self, state: CameraState, ws: WebSocket) -> None:
        if state.camera_ws is not ws:  # 이미 새 연결로 대체됨
            return
        state.camera_ws = None
        self.notify_status(state)
        if self.on_camera_closed is not None:
            # 서버 종료 등으로 이 태스크가 취소돼도 진행 중인 30초 구간 저장은 끝까지 하도록 shield로 감싼다.
            try:
                await asyncio.shield(self.on_camera_closed(state))
            except Exception:
                logger.exception("카메라 종료 처리 실패")

    def on_frame(self, state: CameraState, data: bytes) -> bool:
        """카메라가 보낸 프레임을 최신 1장으로 보관하고 뷰어 슬롯에 넣는다. 버렸으면 False."""
        if len(data) > rules.YOLO_FRAME_MAX_BYTES:
            return False
        header = parse_frame_header(data)
        if header is None or header["cameraId"] != state.camera_id:
            return False
        state.latest_frame = data
        state.latest_frame_id = header["frameId"]
        state.frame_seq += 1
        state.frame_at = time.monotonic()
        for viewer in self.viewers.get(state.camera_id, ()):
            viewer.slot = data
        return True

    # ----- 워커 -----

    async def attach_worker(self, ws: WebSocket) -> None:
        old, self.worker_ws = self.worker_ws, ws
        self.worker_info = {}
        self._inflight = False
        if old is not None:
            await _close(old, rules.YOLO_CLOSE_REPLACED)
        self.notify_all_status()

    async def detach_worker(self, ws: WebSocket) -> None:
        if self.worker_ws is not ws:
            return
        self.worker_ws = None
        self._inflight = False
        self.notify_all_status()

    def pick_for_worker(self, now: float) -> CameraState | None:
        """지금 워커에 보낼 카메라. 한 번에 한 장, 결과가 없어도 2초가 지나면 다음 장, 최대 초당 3장."""
        if self.worker_ws is None:
            return None
        if self._inflight and now - self._sent_at < rules.YOLO_WORKER_TIMEOUT_SEC:
            return None
        if now - self._last_send < 1 / rules.YOLO_WORKER_MAX_FPS:
            return None
        best: CameraState | None = None
        for state in self.cameras.values():
            if not state.online or state.latest_frame is None:
                continue
            if state.frame_seq == state.sent_seq:
                continue
            if best is None or state.frame_at > best.frame_at:
                best = state
        return best

    def mark_sent(self, state: CameraState, now: float) -> None:
        state.sent_seq = state.frame_seq
        self._inflight = True
        self._sent_at = self._last_send = now

    async def worker_sender(self, ws: WebSocket) -> None:
        while self.worker_ws is ws:
            now = time.monotonic()
            state = self.pick_for_worker(now)
            if state is not None and state.latest_frame is not None:
                self.mark_sent(state, now)
                await ws.send_bytes(state.latest_frame)
            await asyncio.sleep(_WORKER_POLL_SEC)

    async def on_worker_message(self, message: Any) -> None:
        if not isinstance(message, dict):
            return
        kind = message.get("type")
        if kind == "hello":
            self.worker_info = {
                k: message.get(k) for k in ("workerId", "modelVersion", "classes") if k in message
            }
        elif kind == "error":
            self._inflight = False
            logger.warning("워커 오류 응답: %s", message.get("code"))
        elif kind == "result":
            self._inflight = False
            await self._handle_result(message)

    async def _handle_result(self, message: dict[str, Any]) -> None:
        camera_id, count = message.get("cameraId"), message.get("personCount")
        if not _is_int(camera_id) or not _is_int(count) or count < 0:
            return
        state = self.cameras.get(camera_id)
        if state is None:
            return
        detections = message.get("detections")
        view = {
            "type": "result",
            "cameraId": camera_id,
            "frameId": message.get("frameId"),
            "personCount": count,
            "crowdLevel": rules.yolo_crowd_level(count).value,
            "inferMs": message.get("inferMs"),
            "detections": detections[:_DETECTIONS_MAX] if isinstance(detections, list) else [],
        }
        state.last_result = view
        state.last_person_count = count
        state.last_measured_at = now_kst()
        for viewer in self.viewers.get(camera_id, ()):
            viewer.texts.append(view)
        if self.on_result is not None:
            try:
                await self.on_result(state, message)
            except Exception:
                logger.exception("워커 결과 처리 실패")

    # ----- 뷰어 -----

    def add_viewer(self, viewer: Viewer) -> None:
        self.viewers.setdefault(viewer.camera_id, set()).add(viewer)

    def remove_viewer(self, viewer: Viewer) -> None:
        self.viewers.get(viewer.camera_id, set()).discard(viewer)

    async def viewer_sender(self, viewer: Viewer) -> None:
        """텍스트(status·result)는 바로, 프레임은 최대 VIEW_MAX_FPS로 최신 1장만 보낸다.

        뷰어가 느리면 이 태스크만 기다리고 슬롯은 덮어써지므로 카메라 수신은 막히지 않는다.
        """
        last_frame = 0.0
        while True:
            while viewer.texts:
                await viewer.ws.send_json(viewer.texts.popleft())
            now = time.monotonic()
            if viewer.slot is not None and now - last_frame >= 1 / rules.YOLO_VIEW_MAX_FPS:
                data, viewer.slot = viewer.slot, None
                last_frame = now
                await viewer.ws.send_bytes(data)
            await asyncio.sleep(_VIEWER_POLL_SEC)


async def _close(ws: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):  # 이미 닫힌 연결
        await ws.close(code=code)


hub = YoloHub()
