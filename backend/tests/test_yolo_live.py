"""/ws/live yolo_* 메시지 (docs/yolo-demo-contract.md 5장). mock 모드."""

import asyncio
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import ws as ws_module
from app.core.config import settings
from app.core.timeutil import KST
from app.core.yolo_hub import hub
from app.main import app
from app.schemas import LiveTopic, YoloAlertLive
from app.services import live, yolo_results, yolo_tick
from app.services.mock import yolo as mock_yolo

BASE_TOPICS = {"congestion", "flights", "stats", "alerts", "weather"}


@pytest.fixture(autouse=True)
def clean():
    hub.reset()
    mock_yolo.reset()
    yolo_results.reset()
    yield
    hub.reset()
    mock_yolo.reset()
    yolo_results.reset()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "yolo_camera_token", SecretStr("c"))
    monkeypatch.setattr(settings, "yolo_worker_token", SecretStr("w"))
    with TestClient(app) as test_client:
        yield test_client


def read_until(ws, predicate, limit=30):
    for _ in range(limit):
        message = ws.receive_json()
        if predicate(message):
            return message
    raise AssertionError("기대한 메시지를 받지 못했습니다")


# ----- 접속 직후 -----


def test_existing_eight_messages_come_first_then_yolo_snapshot(client):
    with client.websocket_connect("/ws/live") as ws:
        base = [ws.receive_json() for _ in range(8)]
        assert {m["topic"] for m in base} == BASE_TOPICS  # 기존 8개는 그대로 먼저
        snapshot = ws.receive_json()
    assert snapshot["topic"] == "yolo_camera"
    assert snapshot["scope"] == "T1"
    assert snapshot["data"] == {
        "cameraId": 1,
        "zoneId": 4,
        "camera": "OFFLINE",
        "worker": "OFFLINE",
    }
    assert set(snapshot) == {"topic", "scope", "data", "sentAt"}
    assert snapshot["sentAt"].endswith("+09:00")


def test_snapshot_includes_last_count_but_not_pending_alerts(client):
    state = hub.state_for(mock_yolo.get_camera(1))
    state.last_person_count = 12
    state.last_measured_at = datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST)
    mock_yolo.save_event(
        mock_yolo.get_camera(1), "HELP_GESTURE", 0.8, state.last_measured_at, "m", "k"
    )  # 판정 대기 알림은 스냅샷에 넣지 않는다
    with client.websocket_connect("/ws/live") as ws:
        for _ in range(8):
            ws.receive_json()
        camera, count = ws.receive_json(), ws.receive_json()
    assert camera["topic"] == "yolo_camera"
    assert count["topic"] == "yolo_count"
    assert count["scope"] == "T1"
    assert count["data"] == {
        "cameraId": 1,
        "zoneId": 4,
        "personCount": 12,
        "crowdLevel": "HIGH",
        "measuredAt": "2026-11-12T14:03:05+09:00",
    }


# ----- 변경 즉시 푸시 -----


def test_camera_state_change_is_pushed_immediately(client):
    with client.websocket_connect("/ws/live") as ws:
        for _ in range(9):
            ws.receive_json()
        with client.websocket_connect("/ws/yolo/camera?cameraId=1&token=c") as camera:
            camera.receive_json()
            online = read_until(ws, lambda m: m["topic"] == "yolo_camera")
            assert online["data"]["camera"] == "ONLINE"
            assert online["data"]["worker"] == "OFFLINE"
        offline = read_until(ws, lambda m: m["topic"] == "yolo_camera")
        assert offline["data"]["camera"] == "OFFLINE"


def test_gesture_event_pushes_yolo_alert(client):
    with client.websocket_connect("/ws/live") as ws:
        for _ in range(9):
            ws.receive_json()
        worker_ws = client.websocket_connect("/ws/yolo/worker?token=w")
        camera_ws = client.websocket_connect("/ws/yolo/camera?cameraId=1&token=c")
        with worker_ws as worker:  # noqa: SIM117 - 워커가 먼저 연결돼 있어야 한다
            with camera_ws as camera:
                camera.receive_json()
                worker.send_text(
                    json.dumps(
                        {
                            "type": "result",
                            "cameraId": 1,
                            "frameId": 1,
                            "personCount": 3,
                            "detections": [],
                            "events": [
                                {
                                    "eventType": "HELP_GESTURE",
                                    "trackId": 7,
                                    "confidence": 0.83,
                                    "detectedAt": "2026-11-12T14:03:05.120+09:00",
                                }
                            ],
                        }
                    )
                )
                alert = read_until(ws, lambda m: m["topic"] == "yolo_alert")
    assert alert["scope"] is None
    assert set(alert["data"]) == {
        "eventId",
        "cameraId",
        "zoneId",
        "eventType",
        "confidence",
        "detectedAt",
        "reviewStatus",
    }
    assert alert["data"]["reviewStatus"] == "PENDING"
    assert alert["data"]["cameraId"] == 1


# ----- 틱 -----


class FakeWs:
    pass


def test_tick_publishes_count_only_while_camera_and_worker_online():
    async def go():
        queue = hub.subscribe_live()
        state = hub.state_for(mock_yolo.get_camera(1))
        state.last_person_count = 4
        state.last_measured_at = datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST)

        def drain():
            out = []
            while not queue.empty():
                out.append(queue.get_nowait())
            return out

        await yolo_tick.tick_once()
        assert drain() == []  # 카메라·워커 모두 없음

        state.camera_ws = FakeWs()
        await yolo_tick.tick_once()
        assert drain() == []  # 워커 없음

        hub.worker_ws = FakeWs()
        await yolo_tick.tick_once()
        (message,) = drain()
        assert message.topic == LiveTopic.YOLO_COUNT
        assert message.scope == "T1"
        assert message.data["personCount"] == 4
        assert message.data["crowdLevel"] == "LOW"

        await yolo_tick.tick_once()
        assert len(drain()) == 1  # 틱마다 1건

    asyncio.run(go())


def test_tick_skips_camera_without_any_result():
    async def go():
        queue = hub.subscribe_live()
        state = hub.state_for(mock_yolo.get_camera(1))
        state.camera_ws = FakeWs()
        hub.worker_ws = FakeWs()
        await yolo_tick.tick_once()
        assert queue.empty()

    asyncio.run(go())


def test_tick_flushes_finished_bucket():
    async def go():
        state = hub.state_for(mock_yolo.get_camera(1))
        yolo_results.aggregator.add(
            1, 5, datetime(2000, 1, 1, tzinfo=KST), "m"
        )  # 오래전 구간 → 끝난 것으로 본다
        await yolo_tick.tick_once()
        assert state is not None

    asyncio.run(go())
    (saved,) = mock_yolo.list_counts()
    assert saved.person_max == 5


def test_run_yolo_tick_loops_and_survives_errors(monkeypatch):
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")

    monkeypatch.setattr(yolo_tick, "tick_once", flaky)

    async def go():
        task = asyncio.create_task(yolo_tick.run_yolo_tick(interval=0.01))
        await asyncio.sleep(0.15)
        task.cancel()

    asyncio.run(go())
    assert calls["n"] >= 3  # 첫 실패 뒤에도 계속 돈다


# ----- 락: 8개 묶음 사이에만 yolo 메시지가 끼어든다 -----


class SlowWebSocket:
    """send_json이 느린 가짜 WebSocket. 보낸 메시지의 topic을 순서대로 기록한다."""

    def __init__(self):
        self.topics: list[str] = []
        self.sending = 0
        self.overlapped = False

    async def accept(self):
        pass

    async def send_json(self, data):
        self.sending += 1
        if self.sending > 1:
            self.overlapped = True  # 같은 연결에 동시에 두 곳에서 쓰면 안 된다
        await asyncio.sleep(0.01)
        self.topics.append(data["topic"])
        self.sending -= 1


def test_yolo_messages_do_not_split_the_eight_message_batch(monkeypatch):
    monkeypatch.setattr(settings, "ws_push_interval_seconds", 0.4)

    async def go():
        ws = SlowWebSocket()
        task = asyncio.create_task(ws_module.live_feed(ws))
        await asyncio.sleep(0.02)  # 8개 묶음을 보내는 중에 yolo 알림이 발행된다
        for i in range(3):
            hub.publish_live(
                LiveTopic.YOLO_ALERT,
                None,
                YoloAlertLive(
                    event_id=i,
                    camera_id=1,
                    zone_id=4,
                    event_type="HELP_GESTURE",
                    confidence=0.5,
                    detected_at=datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST),
                ),
            )
        await asyncio.sleep(0.6)
        task.cancel()
        return ws

    ws = asyncio.run(go())
    assert not ws.overlapped
    assert set(ws.topics[:8]) == BASE_TOPICS  # 묶음이 끊기지 않았다
    assert ws.topics[8:].count("yolo_alert") == 3  # 묶음 뒤에 모두 도착
    assert "yolo_camera" in ws.topics[8:]
    assert not hub.live_subscribers  # 연결이 끝나면 구독을 해제한다


def test_snapshot_message_envelope_matches_live_message():
    messages = live.build_yolo_snapshot(live.fetch_yolo_cameras())
    assert [m.topic for m in messages] == [LiveTopic.YOLO_CAMERA]
    assert messages[0].sent_at.utcoffset().total_seconds() == 9 * 3600
