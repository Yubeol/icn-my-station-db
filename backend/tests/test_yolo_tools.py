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
