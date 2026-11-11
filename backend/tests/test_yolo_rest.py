"""REST /api/v1/yolo/* (docs/yolo-demo-contract.md 6장). mock 모드."""

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import settings
from app.core.timeutil import KST
from app.core.yolo_hub import hub
from app.main import app
from app.services.mock import yolo as mock_yolo

API = "/api/v1/yolo"
BASE = datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST)


@pytest.fixture(autouse=True)
def clean():
    hub.reset()
    mock_yolo.reset()
    yield
    hub.reset()
    mock_yolo.reset()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "yolo_camera_token", SecretStr("c"))
    monkeypatch.setattr(settings, "yolo_worker_token", SecretStr("w"))
    with TestClient(app) as test_client:
        yield test_client


def seed(count: int) -> list[int]:
    camera = mock_yolo.get_camera(1)
    return [
        mock_yolo.save_event(
            camera, "HELP_GESTURE", 0.8, BASE + timedelta(seconds=i * 10), "m", f"k{i}"
        ).event_id
        for i in range(count)
    ]


def confirm(client, event_id):
    return client.patch(f"{API}/events/{event_id}", json={"reviewStatus": "CONFIRMED"})


# ----- GET /cameras -----


def test_cameras_shape_and_status(client):
    (camera,) = client.get(f"{API}/cameras").json()
    assert camera == {
        "cameraId": 1,
        "zoneId": 4,
        "name": "cam-t1-hall3",
        "isActive": True,
        "camera": "OFFLINE",
        "worker": "OFFLINE",
    }
    with client.websocket_connect("/ws/yolo/camera?cameraId=1&token=c") as ws:
        ws.receive_json()
        (online,) = client.get(f"{API}/cameras").json()
        assert (online["camera"], online["worker"]) == ("ONLINE", "OFFLINE")
        with client.websocket_connect("/ws/yolo/worker?token=w"):
            (both,) = client.get(f"{API}/cameras").json()
            assert (both["camera"], both["worker"]) == ("ONLINE", "ONLINE")


# ----- GET /events -----


def test_events_empty_and_shape(client):
    assert client.get(f"{API}/events").json() == []
    seed(1)
    (event,) = client.get(f"{API}/events").json()
    assert set(event) == {
        "eventId",
        "cameraId",
        "zoneId",
        "eventType",
        "confidence",
        "detectedAt",
        "reviewStatus",
        "reviewedAt",
    }
    assert event["reviewStatus"] == "PENDING"
    assert event["reviewedAt"] is None
    assert event["detectedAt"].endswith("+09:00")
    assert (event["cameraId"], event["zoneId"], event["eventType"]) == (1, 4, "HELP_GESTURE")


def test_events_newest_first_with_limit(client):
    ids = seed(5)
    events = client.get(f"{API}/events", params={"limit": 3}).json()
    assert [e["eventId"] for e in events] == ids[::-1][:3]


def test_events_filters(client):
    ids = seed(3)
    confirm(client, ids[0])
    pending = client.get(f"{API}/events", params={"reviewStatus": "PENDING"}).json()
    assert {e["eventId"] for e in pending} == set(ids[1:])
    confirmed = client.get(f"{API}/events", params={"reviewStatus": "CONFIRMED"}).json()
    assert [e["eventId"] for e in confirmed] == [ids[0]]
    assert client.get(f"{API}/events", params={"cameraId": 2}).json() == []
    assert len(client.get(f"{API}/events", params={"cameraId": 1}).json()) == 3


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 201}, {"reviewStatus": "DONE"}, {"cameraId": "cam-t1-hall3"}],
)
def test_events_bad_query_is_422(client, params):
    assert client.get(f"{API}/events", params=params).status_code == 422


def test_events_limit_200_is_allowed_and_default_is_50(client):
    seed(60)
    assert len(client.get(f"{API}/events").json()) == 50
    assert len(client.get(f"{API}/events", params={"limit": 200}).json()) == 60


# ----- PATCH /events/{eventId} -----


def test_review_confirms_and_returns_event(client):
    (event_id,) = seed(1)
    response = confirm(client, event_id)
    assert response.status_code == 200
    body = response.json()
    assert body["eventId"] == event_id
    assert body["reviewStatus"] == "CONFIRMED"
    assert body["reviewedAt"].endswith("+09:00")  # review_status와 reviewed_at은 항상 함께 바뀐다


def test_review_false_positive(client):
    (event_id,) = seed(1)
    body = client.patch(f"{API}/events/{event_id}", json={"reviewStatus": "FALSE_POSITIVE"}).json()
    assert body["reviewStatus"] == "FALSE_POSITIVE"
    assert body["reviewedAt"] is not None


def test_review_twice_is_409_and_keeps_first_result(client):
    (event_id,) = seed(1)
    assert confirm(client, event_id).status_code == 200
    again = client.patch(f"{API}/events/{event_id}", json={"reviewStatus": "FALSE_POSITIVE"})
    assert again.status_code == 409
    (event,) = client.get(f"{API}/events").json()
    assert event["reviewStatus"] == "CONFIRMED"


def test_review_unknown_event_is_404(client):
    assert confirm(client, 999).status_code == 404


@pytest.mark.parametrize("body", [{"reviewStatus": "PENDING"}, {"reviewStatus": "DONE"}, {}])
def test_review_bad_body_is_422(client, body):
    (event_id,) = seed(1)
    assert client.patch(f"{API}/events/{event_id}", json=body).status_code == 422
    assert client.get(f"{API}/events").json()[0]["reviewStatus"] == "PENDING"


def test_review_pushes_yolo_alert_reviewed_to_live(client):
    (event_id,) = seed(1)
    with client.websocket_connect("/ws/live") as live_ws:
        for _ in range(9):  # 기존 8개 + yolo_camera 스냅샷
            live_ws.receive_json()
        confirm(client, event_id)
        for _ in range(20):
            message = live_ws.receive_json()
            if message["topic"] == "yolo_alert_reviewed":
                break
        else:
            raise AssertionError("yolo_alert_reviewed를 받지 못했습니다")
    assert message["scope"] is None
    assert set(message["data"]) == {"eventId", "reviewStatus", "reviewedAt"}
    assert message["data"]["eventId"] == event_id
    assert message["data"]["reviewStatus"] == "CONFIRMED"
    assert message["data"]["reviewedAt"].endswith("+09:00")


def test_failed_review_does_not_push(client):
    (event_id,) = seed(1)
    confirm(client, event_id)
    with client.websocket_connect("/ws/live") as live_ws:
        for _ in range(9):
            live_ws.receive_json()
        assert confirm(client, event_id).status_code == 409
        queue_sizes = [q.qsize() for q in hub.live_subscribers]
    assert queue_sizes == [0]


# ----- openapi.json -----


def test_openapi_lists_yolo_rest_only_and_camel_case(client):
    spec = client.get("/openapi.json").json()
    assert {p for p in spec["paths"] if "/yolo" in p} == {
        f"{API}/cameras",
        f"{API}/events",
        f"{API}/events/{{eventId}}",
    }
    schemas = spec["components"]["schemas"]
    assert {"eventId", "cameraId", "zoneId", "reviewStatus", "reviewedAt"} <= set(
        schemas["YoloEvent"]["properties"]
    )
    assert schemas["YoloCamera"]["properties"]["cameraId"]["type"] == "integer"
    assert "patch" in spec["paths"][f"{API}/events/{{eventId}}"]


def test_committed_openapi_json_is_up_to_date():
    path = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert committed == app.openapi(), "scripts/export_openapi.py를 다시 실행하세요."
