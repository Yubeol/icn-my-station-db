"""/ws/yolo/* 연결·중계 (docs/yolo-demo-contract.md 1~4장). mock 모드, 카메라 1번(T1) 고정."""

import json
import logging
import struct

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from starlette.websockets import WebSocketDisconnect

from app.core import rules
from app.core.config import settings
from app.core.log_filter import TokenMaskFilter, mask_token
from app.core.yolo_hub import hub, parse_frame_header
from app.main import app

CAM_TOKEN = "cam-test-token"
WORKER_TOKEN = "worker-test-token"


def make_frame(
    frame_id: int = 1, camera_id: int = 1, jpeg: bytes = b"\xff\xd8fake\xff\xd9"
) -> bytes:
    header = json.dumps(
        {
            "cameraId": camera_id,
            "frameId": frame_id,
            "capturedAt": 1762923785120,
            "width": 640,
            "height": 360,
        }
    ).encode()
    return struct.pack(">I", len(header)) + header + jpeg


@pytest.fixture
def yolo(monkeypatch):
    """한 이벤트 루프에서 모든 연결이 돌도록 with TestClient로 연다."""
    monkeypatch.setattr(settings, "yolo_camera_token", SecretStr(CAM_TOKEN))
    monkeypatch.setattr(settings, "yolo_worker_token", SecretStr(WORKER_TOKEN))
    hub.reset()
    with TestClient(app) as client:
        yield client
    hub.reset()


def camera_url(camera_id="1", token=CAM_TOKEN) -> str:
    return f"/ws/yolo/camera?cameraId={camera_id}&token={token}"


def worker_url(token=WORKER_TOKEN) -> str:
    return f"/ws/yolo/worker?token={token}"


def close_code(client, url) -> int:
    with client.websocket_connect(url) as ws, pytest.raises(WebSocketDisconnect) as info:
        ws.receive_text()
    return info.value.code


# ----- 종료 코드 -----


@pytest.mark.parametrize("token", ["wrong", ""])
def test_camera_bad_token_closes_4401(yolo, token):
    assert close_code(yolo, camera_url(token=token)) == 4401


def test_worker_bad_token_closes_4401(yolo):
    assert close_code(yolo, worker_url(token="wrong")) == 4401


def test_unset_token_rejects_everything(yolo, monkeypatch):
    monkeypatch.setattr(settings, "yolo_camera_token", None)
    assert close_code(yolo, camera_url()) == 4401


@pytest.mark.parametrize("camera_id", ["99", "cam-t1-hall3", ""])
def test_camera_unknown_id_closes_4404(yolo, camera_id):
    assert close_code(yolo, camera_url(camera_id=camera_id)) == 4404


def test_view_unknown_id_closes_4404(yolo):
    assert close_code(yolo, "/ws/yolo/view?cameraId=99") == 4404


# ----- 카메라 -----


def test_camera_hello(yolo):
    with yolo.websocket_connect(camera_url()) as ws:
        assert ws.receive_json() == {"type": "hello", "cameraId": 1, "maxFps": 10}


def test_new_camera_replaces_old_with_4409(yolo):
    with yolo.websocket_connect(camera_url()) as first:
        first.receive_json()
        with yolo.websocket_connect(camera_url()) as second:
            assert second.receive_json()["type"] == "hello"
            with pytest.raises(WebSocketDisconnect) as info:
                first.receive_text()
            assert info.value.code == 4409
        # 새 연결이 살아 있는 동안 이전 연결의 종료가 상태를 지우지 않는다
    assert hub.cameras[1].camera_ws is None


def test_new_worker_replaces_old_with_4409(yolo):
    with yolo.websocket_connect(worker_url()) as first, yolo.websocket_connect(worker_url()):
        with pytest.raises(WebSocketDisconnect) as info:
            first.receive_text()
        assert info.value.code == 4409
        assert hub.worker_online


# ----- 중계 -----


def read_until(ws, predicate, limit=20):
    for _ in range(limit):
        message = ws.receive()
        value = (
            message.get("bytes")
            if message.get("bytes") is not None
            else json.loads(message["text"])
        )
        if predicate(value):
            return value
    raise AssertionError("기대한 메시지를 받지 못했습니다")


def test_frame_relay_and_result(yolo):
    with (
        yolo.websocket_connect(camera_url()) as camera,
        yolo.websocket_connect(worker_url()) as worker,
    ):
        camera.receive_json()
        with yolo.websocket_connect("/ws/yolo/view?cameraId=1") as view:
            assert view.receive_json() == {
                "type": "status",
                "cameraId": 1,
                "camera": "ONLINE",
                "worker": "ONLINE",
            }
            frame = make_frame(frame_id=7)
            camera.send_bytes(frame)

            assert worker.receive_bytes() == frame  # 워커에는 받은 바이트 그대로
            assert read_until(view, lambda v: isinstance(v, bytes)) == frame

            worker.send_text(json.dumps({"type": "hello", "workerId": "w", "modelVersion": "m1"}))
            worker.send_text(
                json.dumps(
                    {
                        "type": "result",
                        "cameraId": 1,
                        "frameId": 7,
                        "capturedAt": 1,
                        "inferMs": 40.5,
                        "personCount": 11,
                        "detections": [
                            {"cls": "person", "conf": 0.9, "box": [0, 0, 1, 1], "trackId": 1}
                        ],
                        "events": [],
                    }
                )
            )
            result = read_until(view, lambda v: isinstance(v, dict) and v["type"] == "result")
            assert result == {
                "type": "result",
                "cameraId": 1,
                "frameId": 7,
                "personCount": 11,
                "crowdLevel": "HIGH",
                "inferMs": 40.5,
                "detections": [{"cls": "person", "conf": 0.9, "box": [0, 0, 1, 1], "trackId": 1}],
            }


def test_status_changes_reach_viewer(yolo):
    with yolo.websocket_connect("/ws/yolo/view?cameraId=1") as view:
        assert view.receive_json()["camera"] == "OFFLINE"
        with yolo.websocket_connect(camera_url()) as camera:
            camera.receive_json()
            assert read_until(view, lambda v: v.get("camera") == "ONLINE")["worker"] == "OFFLINE"
        assert read_until(view, lambda v: v.get("camera") == "OFFLINE")["type"] == "status"


# ----- 프레임 검사 (허브 단위) -----


@pytest.fixture
def state():
    hub.reset()
    from app.services.mock.yolo import get_camera

    yield hub.state_for(get_camera(1))
    hub.reset()


def test_parse_frame_header():
    assert parse_frame_header(make_frame(5))["frameId"] == 5
    assert parse_frame_header(b"") is None
    assert parse_frame_header(struct.pack(">I", 9999) + b"{}") is None  # 헤더 길이가 데이터보다 큼
    assert parse_frame_header(struct.pack(">I", 2) + b"[]" + b"x") is None  # JSON 객체가 아님
    bad_type = json.dumps({"cameraId": "1", "frameId": 1}).encode()
    assert parse_frame_header(struct.pack(">I", len(bad_type)) + bad_type + b"x") is None
    no_jpeg = json.dumps({"cameraId": 1, "frameId": 1}).encode()
    assert parse_frame_header(struct.pack(">I", len(no_jpeg)) + no_jpeg) is None


def test_on_frame_drops_bad_frames(state):
    assert hub.on_frame(state, make_frame(1, camera_id=2)) is False  # cameraId 불일치
    assert hub.on_frame(state, b"garbage") is False
    big = make_frame(1, jpeg=b"x" * rules.YOLO_FRAME_MAX_BYTES)
    assert hub.on_frame(state, big) is False  # 1MB 초과
    assert state.latest_frame is None
    assert hub.on_frame(state, make_frame(2)) is True
    assert state.latest_frame_id == 2


def test_viewer_slot_keeps_only_latest_frame(state):
    from app.core.yolo_hub import Viewer

    viewer = Viewer(ws=None, camera_id=1)
    hub.add_viewer(viewer)
    hub.on_frame(state, make_frame(1))
    last = make_frame(2)
    hub.on_frame(state, last)
    assert viewer.slot == last


# ----- 워커 송신 규칙 (허브 단위, 시간은 직접 넣는다) -----


class FakeWs:
    pass


def test_worker_one_frame_at_a_time(state):
    hub.worker_ws = FakeWs()
    state.camera_ws = FakeWs()
    hub.on_frame(state, make_frame(1))
    assert hub.pick_for_worker(100.0) is state
    hub.mark_sent(state, 100.0)

    hub.on_frame(state, make_frame(2))
    assert hub.pick_for_worker(100.5) is None  # 결과를 아직 못 받음
    assert hub.pick_for_worker(101.9) is None
    assert hub.pick_for_worker(102.1) is state  # 2초가 지나면 최신 프레임을 보낸다


def test_worker_next_frame_after_result_respects_max_fps(state):
    import asyncio

    hub.worker_ws = FakeWs()
    state.camera_ws = FakeWs()
    hub.on_frame(state, make_frame(1))
    hub.mark_sent(state, 100.0)
    asyncio.run(
        hub.on_worker_message(
            {"type": "result", "cameraId": 1, "frameId": 1, "personCount": 0, "detections": []}
        )
    )
    hub.on_frame(state, make_frame(2))
    assert hub.pick_for_worker(100.1) is None  # 초당 3장 제한 (1/3초)
    assert hub.pick_for_worker(100.34) is state


def test_worker_skips_frame_already_sent(state):
    hub.worker_ws = FakeWs()
    state.camera_ws = FakeWs()
    hub.on_frame(state, make_frame(1))
    hub.mark_sent(state, 100.0)
    hub._inflight = False
    assert hub.pick_for_worker(105.0) is None  # 새 프레임이 없으면 같은 프레임을 다시 보내지 않는다


def test_no_worker_no_dispatch(state):
    state.camera_ws = FakeWs()
    hub.on_frame(state, make_frame(1))
    assert hub.pick_for_worker(100.0) is None


# ----- 로그 토큰 가리기 -----


def test_mask_token():
    assert mask_token("GET /ws/yolo/camera?cameraId=1&token=abc123 HTTP/1.1") == (
        "GET /ws/yolo/camera?cameraId=1&token=*** HTTP/1.1"
    )
    assert mask_token("/ws/yolo/worker?token=zzz") == "/ws/yolo/worker?token=***"
    assert mask_token("/api/v1/flights") == "/api/v1/flights"


def test_log_filter_masks_args_and_keeps_record():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "WebSocket %s" [accepted]',
        ("1.2.3.4:5", "/ws/yolo/camera?cameraId=1&token=SECRET"),
        None,
    )
    assert TokenMaskFilter().filter(record) is True
    assert "SECRET" not in record.getMessage()
    assert "token=***" in record.getMessage()
    assert "cameraId=1" in record.getMessage()


# ----- finger_gun 박스 전달, 카메라 여러 대일 때 번갈아 보내기 (계약 v0.4) -----


def test_finger_gun_detection_is_relayed_to_viewer_unchanged(yolo):
    detections = [
        {"cls": "person", "conf": 0.9, "box": [0.1, 0.1, 0.5, 0.9], "trackId": 1},
        {"cls": "finger_gun", "conf": 0.77, "box": [0.4, 0.3, 0.6, 0.5], "trackId": 1},
    ]
    with (
        yolo.websocket_connect(camera_url()) as camera,
        yolo.websocket_connect(worker_url()) as worker,
    ):
        camera.receive_json()
        with yolo.websocket_connect("/ws/yolo/view?cameraId=1") as view:
            view.receive_json()  # status
            camera.send_bytes(make_frame(3))
            worker.receive_bytes()
            worker.send_text(
                json.dumps(
                    {
                        "type": "result",
                        "cameraId": 1,
                        "frameId": 3,
                        "personCount": 1,
                        "detections": detections,
                        "events": [],
                    }
                )
            )
            result = read_until(view, lambda v: isinstance(v, dict) and v["type"] == "result")
    assert result["detections"] == detections


def _two_cameras():
    from app.services.yolo_types import YoloCameraInfo

    hub.reset()
    first = hub.state_for(YoloCameraInfo(1, 4, "cam-a", True, "T1"))
    second = hub.state_for(YoloCameraInfo(2, 5, "cam-b", True, "T1"))
    first.camera_ws = second.camera_ws = FakeWs()
    hub.worker_ws = FakeWs()
    return first, second


def _dispatch(now: float):
    """pick → 보내기 → 결과 수신(비행 중 표시 해제)까지 한 번 돌린다. 보낸 카메라 번호를 돌려준다."""
    picked = hub.pick_for_worker(now)
    if picked is None:
        return None
    hub.mark_sent(picked, now)
    hub._inflight = False
    return picked.camera_id


def test_two_cameras_are_served_alternately_even_if_one_is_always_newer():
    first, second = _two_cameras()
    served = []
    now = 100.0
    for i in range(1, 9):
        # 두 카메라 모두 새 프레임을 보내고, 카메라 1의 프레임이 항상 더 최근이다(예전 방식이면 1번만 뽑힌다).
        hub.on_frame(second, make_frame(i, camera_id=2))
        hub.on_frame(first, make_frame(i, camera_id=1))
        served.append(_dispatch(now))
        now += 0.4
    assert served == [1, 2, 1, 2, 1, 2, 1, 2]
    hub.reset()


def test_camera_sending_more_often_does_not_starve_the_other():
    first, second = _two_cameras()
    served = []
    now = 100.0
    for i in range(1, 13):
        hub.on_frame(first, make_frame(i, camera_id=1))  # 카메라 1은 매번 새 프레임
        if i % 3 == 0:
            hub.on_frame(second, make_frame(i, camera_id=2))  # 카메라 2는 세 번에 한 번
        served.append(_dispatch(now))
        now += 0.4
    # 카메라 2는 새 프레임이 생긴 바로 그 차례에 뽑힌다.
    assert [served[i - 1] for i in (3, 6, 9, 12)] == [2, 2, 2, 2]
    assert served.count(2) == 4
    hub.reset()


def test_camera_without_new_frame_does_not_block_the_other():
    first, second = _two_cameras()
    hub.on_frame(first, make_frame(1, camera_id=1))
    hub.on_frame(second, make_frame(1, camera_id=2))
    assert _dispatch(100.0) in (1, 2)
    assert _dispatch(100.4) in (1, 2)
    assert _dispatch(100.8) is None  # 둘 다 새 프레임이 없으면 보내지 않는다
    hub.on_frame(second, make_frame(2, camera_id=2))
    assert _dispatch(101.2) == 2  # 한쪽만 새 프레임이 있으면 그쪽을 보낸다
    hub.reset()


def test_offline_camera_is_skipped():
    first, second = _two_cameras()
    hub.on_frame(first, make_frame(1, camera_id=1))
    hub.on_frame(second, make_frame(1, camera_id=2))
    second.camera_ws = None  # 카메라 2 연결 끊김
    assert _dispatch(100.0) == 1
    hub.reset()
