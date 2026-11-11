"""tools/yolo 가짜 카메라·워커의 순수 함수. opencv가 없어도 돌도록 cv2는 import하지 않는다."""

import random
import sys
from datetime import datetime
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[2] / "tools" / "yolo"
sys.path.insert(0, str(TOOLS_DIR))

import fake_camera
import fake_worker

from app.core.timeutil import KST
from app.core.yolo_hub import parse_frame_header


def test_fake_camera_frame_matches_contract_and_hub_parser():
    frame = fake_camera.build_frame(1, 3, 1762923785120, 640, 360, b"\xff\xd8jpeg")
    assert frame.endswith(b"\xff\xd8jpeg")
    header = parse_frame_header(frame)
    assert header == {
        "cameraId": 1,
        "frameId": 3,
        "capturedAt": 1762923785120,
        "width": 640,
        "height": 360,
    }


def test_fake_camera_url_uses_integer_camera_id():
    url = fake_camera.camera_url("ws://localhost:8000/", 1, "tok")
    assert url == "ws://localhost:8000/ws/yolo/camera?cameraId=1&token=tok"


def test_fake_worker_url():
    assert fake_worker.worker_url("wss://h", "t") == "wss://h/ws/yolo/worker?token=t"


@pytest.mark.parametrize("seed", range(20))
def test_fake_worker_result_shape(seed):
    header = {"cameraId": 1, "frameId": 9, "capturedAt": 123}
    result = fake_worker.make_result(header, random.Random(seed))
    assert result["type"] == "result"
    assert (result["cameraId"], result["frameId"], result["capturedAt"]) == (1, 9, 123)
    assert 0 <= result["personCount"] <= fake_worker.MAX_PERSON_COUNT
    assert 1 <= len(result["detections"]) <= 2
    assert result["events"] == []
    for det in result["detections"]:
        x1, y1, x2, y2 = det["box"]
        assert 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1
        assert isinstance(det["trackId"], int)


def test_fake_worker_gesture_event():
    now = datetime(2026, 11, 12, 14, 3, 5, 120000, tzinfo=KST)
    result = fake_worker.make_result({"cameraId": 1, "frameId": 1}, random.Random(1), True, now)
    (event,) = result["events"]
    assert event["eventType"] == "HELP_GESTURE"
    assert event["detectedAt"] == "2026-11-12T14:03:05.120+09:00"
    assert 0 <= event["confidence"] <= 1
    gesture = [d for d in result["detections"] if d["cls"] == "help_gesture"]
    assert gesture and gesture[0]["trackId"] == event["trackId"]


def test_fake_worker_header_parse():
    frame = fake_camera.build_frame(1, 2, 3, 640, 360, b"x")
    assert fake_worker.parse_header(frame)["frameId"] == 2
    assert fake_worker.parse_header(b"bad") is None


def test_tools_dependencies_stay_out_of_backend():
    requirements = (TOOLS_DIR / "requirements.txt").read_text(encoding="utf-8")
    assert "opencv" in requirements and "websockets" in requirements
    pyproject = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    for forbidden in ("opencv", "ultralytics", "torch"):
        assert forbidden not in pyproject


# ----- 웹캠 열기 (opencv 없이 가짜 cv2로 확인) -----


class _FakeCapture:
    def __init__(self, opened: bool, log: list, key):
        self.opened, self.log, self.key = opened, log, key
        self.released = False

    def isOpened(self):
        return self.opened

    def release(self):
        self.released = True
        self.log.append(("release", self.key))

    def get(self, prop):
        return {3: 640, 4: 480}[prop]


def _fake_cv2(monkeypatch, opens: dict, log: list):
    """opens: {(index, api): 열림 여부}. api는 DSHOW면 700, 기본이면 None."""
    import types

    def video_capture(index, api=None):
        log.append(("open", index, api))
        return _FakeCapture(opens.get((index, api), False), log, (index, api))

    module = types.SimpleNamespace(VideoCapture=video_capture, CAP_DSHOW=700)
    monkeypatch.setitem(sys.modules, "cv2", module)


def test_open_webcam_tries_dshow_first_on_windows(monkeypatch):
    log: list = []
    _fake_cv2(monkeypatch, {(0, 700): True}, log)
    monkeypatch.setattr(sys, "platform", "win32")
    capture, method = fake_camera.open_webcam(0)
    assert capture is not None and method == "DSHOW"
    assert log == [("open", 0, 700)]


def test_open_webcam_falls_back_to_default_when_dshow_fails(monkeypatch):
    log: list = []
    _fake_cv2(monkeypatch, {(1, None): True}, log)
    monkeypatch.setattr(sys, "platform", "win32")
    capture, method = fake_camera.open_webcam(1)
    assert capture is not None and method == "기본"
    assert log[:3] == [("open", 1, 700), ("release", (1, 700)), ("open", 1, None)]


def test_open_webcam_uses_only_default_outside_windows(monkeypatch):
    log: list = []
    _fake_cv2(monkeypatch, {(0, None): True}, log)
    monkeypatch.setattr(sys, "platform", "linux")
    _, method = fake_camera.open_webcam(0)
    assert method == "기본"
    assert log == [("open", 0, None)]


def test_open_webcam_returns_none_when_nothing_opens(monkeypatch):
    log: list = []
    _fake_cv2(monkeypatch, {}, log)
    monkeypatch.setattr(sys, "platform", "win32")
    assert fake_camera.open_webcam(2) == (None, None)
    assert ("release", (2, 700)) in log and (
        "release",
        (2, None),
    ) in log  # 열리지 않은 핸들도 해제한다


def test_list_cameras_reports_openable_indexes(monkeypatch):
    log: list = []
    _fake_cv2(monkeypatch, {(1, 700): True, (3, None): True}, log)
    monkeypatch.setattr(sys, "platform", "win32")
    lines: list[str] = []
    assert fake_camera.list_cameras(lines.append) == [1, 3]
    assert [index for kind, index, *_ in (e for e in log if e[0] == "open")][:2] == [
        0,
        0,
    ]  # 0번은 두 방식 모두 시도
    assert any("1번: 열림 (DSHOW, 640x480)" in line for line in lines)
    assert any("3번: 열림 (기본, 640x480)" in line for line in lines)
    assert any("0번: 열리지 않음" in line for line in lines)
    assert not any("6번" in line for line in lines)  # 0~5번만 확인한다
    assert "--source 1" in lines[-1]


def test_list_cameras_when_none_open(monkeypatch):
    _fake_cv2(monkeypatch, {}, [])
    lines: list[str] = []
    assert fake_camera.list_cameras(lines.append) == []
    assert "열리는 웹캠이 없습니다" in lines[-1]
