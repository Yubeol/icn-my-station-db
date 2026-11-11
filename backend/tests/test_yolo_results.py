"""워커 result 처리: 30초 집계, dedupe_key, 제스처 이벤트 저장, DB 쓰기 규칙 (mock·가짜 연결로만 검증)."""

import asyncio
import json
import time
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core import db_write, rules
from app.core.config import settings
from app.core.errors import YoloEventNotFoundError, YoloEventReviewedError
from app.core.timeutil import KST
from app.core.yolo_hub import hub
from app.main import app
from app.schemas import YoloReviewStatus
from app.services import yolo_results, yolo_store
from app.services.mock import yolo as mock_yolo
from app.services.yolo_types import YoloCountBucket


@pytest.fixture(autouse=True)
def clean():
    hub.reset()
    mock_yolo.reset()
    yolo_results.reset()
    yield
    hub.reset()
    mock_yolo.reset()
    yolo_results.reset()


def at(second: int, minute: int = 3) -> datetime:
    return datetime(2026, 11, 12, 14, minute, second, tzinfo=KST)


# ----- 30초 집계 -----


def test_bucket_floor_to_30_seconds():
    assert yolo_results.bucket_floor(at(47)) == at(30)
    assert yolo_results.bucket_floor(at(29)) == at(0)
    assert yolo_results.bucket_floor(at(30)) == at(30)


def test_aggregator_accumulates_inside_bucket():
    agg = yolo_results.BucketAggregator()
    assert agg.add(1, 4, at(31), "m1") == []
    assert agg.add(1, 8, at(40), "m1") == []
    assert agg.add(1, 3, at(59), "m1") == []
    (bucket,) = agg.flush(1)
    assert bucket == YoloCountBucket(
        camera_id=1,
        bucket_start=at(30),
        person_avg=5.0,
        person_max=8,
        sample_count=3,
        crowd_level="LOW",
        model_version="m1",
    )
    assert agg.flush(1) == []  # 비워졌다


def test_aggregator_returns_finished_bucket_on_boundary():
    agg = yolo_results.BucketAggregator()
    agg.add(1, 10, at(31), "m1")
    agg.add(1, 12, at(50), "m1")
    (done,) = agg.add(1, 2, at(1, minute=4), "m1")  # 다음 구간
    assert done.bucket_start == at(30)
    assert (done.person_avg, done.person_max, done.sample_count) == (11.0, 12, 2)
    assert done.crowd_level == "HIGH"
    (current,) = agg.flush(1)
    assert current.bucket_start == at(0, minute=4)
    assert current.sample_count == 1


def test_aggregator_crowd_level_is_always_filled():
    agg = yolo_results.BucketAggregator()
    for count, level in [(0, "LOW"), (5, "LOW"), (6, "MID"), (10, "MID"), (11, "HIGH")]:
        agg.add(1, count, at(0), "m")
        (bucket,) = agg.flush(1)
        assert bucket.crowd_level == level
        assert bucket.person_avg <= bucket.person_max  # DDL CHECK


def test_aggregator_avg_never_exceeds_max_after_rounding():
    agg = yolo_results.BucketAggregator()
    for count in (5, 5, 4, 5, 5, 5, 5):
        agg.add(1, count, at(0), "m")
    (bucket,) = agg.flush(1)
    assert bucket.person_avg <= bucket.person_max


def test_aggregator_flush_due_closes_only_finished_buckets():
    agg = yolo_results.BucketAggregator()
    agg.add(1, 3, at(31), "m")  # 14:03:30 ~ 14:04:00
    agg.add(2, 6, at(10, minute=4), "m")  # 14:04:00 ~ 14:04:30
    assert agg.flush_due(at(59)) == []
    done = agg.flush_due(at(0, minute=4))
    assert [b.camera_id for b in done] == [1]
    assert [b.camera_id for b in agg.flush_due(at(31, minute=4))] == [2]


def test_aggregator_keeps_cameras_separate():
    agg = yolo_results.BucketAggregator()
    agg.add(1, 4, at(1), "m")
    agg.add(2, 9, at(1), "m")
    assert agg.flush(1)[0].person_max == 4
    assert agg.flush(2)[0].person_max == 9


# ----- dedupe_key -----


def test_dedupe_key_floors_to_10_seconds():
    key = yolo_results.dedupe_key(1, "HELP_GESTURE", 7, at(5))
    assert key == yolo_results.dedupe_key(1, "HELP_GESTURE", 7, at(9))
    assert key != yolo_results.dedupe_key(1, "HELP_GESTURE", 7, at(10))
    assert key != yolo_results.dedupe_key(1, "HELP_GESTURE", 8, at(5))
    assert key != yolo_results.dedupe_key(2, "HELP_GESTURE", 7, at(5))
    assert key.startswith("1:HELP_GESTURE:7:")
    assert yolo_results.dedupe_key(1, "HELP_GESTURE", None, at(5)).split(":")[2] == "none"


# ----- result 처리 (mock 저장소) -----


def run_result(message: dict, camera_id: int = 1) -> list:
    """result를 처리하고 그 동안 /ws/live 구독 큐에 들어온 메시지를 돌려준다."""

    async def go():
        queue = hub.subscribe_live()
        state = hub.state_for(yolo_store.get_camera(camera_id))
        await yolo_results.handle_result(state, message)
        out = []
        while not queue.empty():
            out.append(queue.get_nowait())
        return out

    return asyncio.run(go())


def gesture(track_id=7, detected_at="2026-11-12T14:03:05.120+09:00", confidence=0.83) -> dict:
    return {
        "eventType": "HELP_GESTURE",
        "trackId": track_id,
        "confidence": confidence,
        "detectedAt": detected_at,
    }


def result(count=4, events=None) -> dict:
    return {
        "type": "result",
        "cameraId": 1,
        "frameId": 1,
        "personCount": count,
        "detections": [],
        "events": events or [],
    }


def test_gesture_event_saved_and_alert_published():
    messages = run_result(result(events=[gesture()]))
    (event,) = yolo_store.list_events(None, None, 10)
    assert (event.camera_id, event.zone_id, event.event_type) == (1, 4, "HELP_GESTURE")
    assert event.review_status == YoloReviewStatus.PENDING
    assert event.detected_at == datetime(2026, 11, 12, 14, 3, 5, 120000, tzinfo=KST)

    (message,) = [m for m in messages if m.topic == "yolo_alert"]
    assert message.scope is None
    assert message.data == {
        "eventId": event.event_id,
        "cameraId": 1,
        "zoneId": 4,
        "eventType": "HELP_GESTURE",
        "confidence": 0.83,
        "detectedAt": "2026-11-12T14:03:05.120000+09:00",  # ISO 8601, +09:00
        "reviewStatus": "PENDING",
    }


def test_same_gesture_in_dedupe_window_is_saved_once_and_alerted_once():
    first = run_result(result(events=[gesture(detected_at="2026-11-12T14:03:05.000+09:00")]))
    second = run_result(result(events=[gesture(detected_at="2026-11-12T14:03:08.900+09:00")]))
    assert len(yolo_store.list_events(None, None, 10)) == 1
    assert len([m for m in first if m.topic == "yolo_alert"]) == 1
    assert [m for m in second if m.topic == "yolo_alert"] == []


def test_gesture_in_next_window_is_a_new_event():
    run_result(result(events=[gesture(detected_at="2026-11-12T14:03:05+09:00")]))
    run_result(result(events=[gesture(detected_at="2026-11-12T14:03:15+09:00")]))
    assert len(yolo_store.list_events(None, None, 10)) == 2


@pytest.mark.parametrize(
    "bad",
    [
        {
            "eventType": "FIRE",
            "trackId": 1,
            "confidence": 0.9,
            "detectedAt": "2026-11-12T14:03:05+09:00",
        },
        gesture(confidence=1.5),
        gesture(confidence=-0.1),
        gesture(confidence="high"),
        gesture(track_id="x"),
        gesture(detected_at="not a time"),
        "HELP_GESTURE",
        None,
    ],
)
def test_invalid_events_are_ignored(bad):
    messages = run_result(result(events=[bad]))
    assert yolo_store.list_events(None, None, 10) == []
    assert [m for m in messages if m.topic == "yolo_alert"] == []


def test_event_without_detected_at_uses_now():
    event = gesture()
    del event["detectedAt"]
    run_result(result(events=[event]))
    (saved,) = yolo_store.list_events(None, None, 10)
    assert abs(saved.detected_at - datetime.now(KST)) < timedelta(seconds=5)


def test_naive_detected_at_is_treated_as_kst():
    run_result(result(events=[gesture(detected_at="2026-11-12T14:03:05")]))
    (saved,) = yolo_store.list_events(None, None, 10)
    assert saved.detected_at == datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST)


def test_mock_store_only_stores_help_gesture():
    camera = yolo_store.get_camera(1)
    with pytest.raises(ValueError):
        yolo_store.save_event(camera, "FIRE", 0.9, at(1), "m", "k1")


def test_result_feeds_aggregator():
    run_result(result(count=4))
    run_result(result(count=8))
    (bucket,) = yolo_results.aggregator.flush(1)
    assert (bucket.person_avg, bucket.person_max, bucket.sample_count) == (6.0, 8, 2)


def test_invalid_person_count_is_not_aggregated():
    run_result(result(count=-1))
    run_result({**result(), "personCount": "4"})
    assert yolo_results.aggregator.flush(1) == []


def test_camera_closed_flushes_open_bucket_into_store():
    async def go():
        state = hub.state_for(yolo_store.get_camera(1))
        await yolo_results.handle_result(state, result(count=7))
        await yolo_results.handle_camera_closed(state)

    asyncio.run(go())
    (saved,) = mock_yolo.list_counts()
    assert (saved.camera_id, saved.person_max, saved.crowd_level) == (1, 7, "MID")


def test_duplicate_bucket_is_skipped_like_on_conflict_do_nothing():
    bucket = YoloCountBucket(1, at(0), 3.0, 4, 2, "LOW", "m")
    assert yolo_store.save_count(bucket) is True
    assert yolo_store.save_count(bucket) is False
    assert len(mock_yolo.list_counts()) == 1


def test_review_only_changes_pending_events():
    camera = yolo_store.get_camera(1)
    event = yolo_store.save_event(camera, "HELP_GESTURE", 0.8, at(5), "m", "k")
    reviewed_at = at(30)
    done = yolo_store.review_event(event.event_id, YoloReviewStatus.CONFIRMED, reviewed_at)
    assert (done.review_status, done.reviewed_at) == (YoloReviewStatus.CONFIRMED, reviewed_at)
    with pytest.raises(YoloEventReviewedError):
        yolo_store.review_event(event.event_id, YoloReviewStatus.FALSE_POSITIVE, at(40))
    with pytest.raises(YoloEventNotFoundError):
        yolo_store.review_event(999, YoloReviewStatus.CONFIRMED, at(40))
    assert yolo_store.list_events(None, YoloReviewStatus.PENDING, 10) == []


def test_list_events_newest_first_with_filters_and_limit():
    camera = yolo_store.get_camera(1)
    for i in range(5):
        yolo_store.save_event(camera, "HELP_GESTURE", 0.5, at(i), "m", f"k{i}")
    events = yolo_store.list_events(1, None, 3)
    assert [e.detected_at.second for e in events] == [4, 3, 2]
    assert yolo_store.list_events(2, None, 10) == []


# ----- 허브 연결: 워커 → 저장 (한 이벤트 루프에서 실제 WebSocket으로) -----


def wait_for(condition, timeout=3.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def test_worker_result_over_websocket_reaches_store_and_flushes_on_camera_close(monkeypatch):
    monkeypatch.setattr(settings, "yolo_camera_token", SecretStr("c"))
    monkeypatch.setattr(settings, "yolo_worker_token", SecretStr("w"))
    with TestClient(app) as client:  # noqa: SIM117 - lifespan이 yolo_results.install()을 부른다
        with client.websocket_connect("/ws/yolo/worker?token=w") as worker:
            worker.send_text(json.dumps({"type": "hello", "workerId": "x", "modelVersion": "m1"}))
            camera_url = "/ws/yolo/camera?cameraId=1&token=c"
            with client.websocket_connect(camera_url) as camera:
                camera.receive_json()
                worker.send_text(json.dumps(result(count=9, events=[gesture()])))
                assert wait_for(lambda: len(yolo_store.list_events(None, None, 10)) == 1)
            # 카메라 연결이 끊기면 진행 중인 구간이 저장된다
            assert wait_for(lambda: len(mock_yolo.list_counts()) == 1)
    (saved,) = mock_yolo.list_counts()
    assert (saved.person_max, saved.crowd_level, saved.model_version) == (9, "MID", "m1")


# ----- DB 쓰기 규칙 (가짜 연결로 SQL만 확인. 실제 DB에는 접속하지 않는다) -----


class FakeCursor:
    def __init__(self, log, rowcount=1, fetched=(1,)):
        self.log, self.rowcount, self.fetched = log, rowcount, fetched

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.log.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.fetched


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True


@pytest.fixture
def fake_db(monkeypatch):
    log: list = []
    state = {"rowcount": 1, "fetched": (42,)}

    def connect():
        return FakeConn(FakeCursor(log, state["rowcount"], state["fetched"]))

    monkeypatch.setattr(db_write, "_connect", connect)
    return log, state


COUNT_ROW = {
    "camera_id": 1,
    "bucket_start": at(0),
    "person_avg": 5.5,
    "person_max": 8,
    "sample_count": 3,
    "crowd_level": "LOW",
    "model_version": "m1",
}
EVENT_ROW = {
    "camera_id": 1,
    "event_type": "HELP_GESTURE",
    "confidence": 0.8,
    "detected_at": at(5),
    "model_version": "m1",
    "dedupe_key": "1:HELP_GESTURE:7:1",
}


def test_sql_uses_only_allowed_statements():
    assert "ON CONFLICT (camera_id, bucket_start) DO NOTHING" in " ".join(
        db_write.INSERT_YOLO_COUNT_SQL.split()
    )
    assert "ON CONFLICT (dedupe_key) DO NOTHING" in " ".join(db_write.INSERT_YOLO_EVENT_SQL.split())
    update = " ".join(db_write.REVIEW_YOLO_EVENT_SQL.split())
    assert update.startswith(
        "UPDATE demo_yolo_events SET review_status = %(review_status)s, reviewed_at = %(reviewed_at)s WHERE"
    )
    assert "review_status = 'PENDING'" in update
    for sql in (
        db_write.INSERT_YOLO_COUNT_SQL,
        db_write.INSERT_YOLO_EVENT_SQL,
        db_write.REVIEW_YOLO_EVENT_SQL,
    ):
        for forbidden in ("DELETE", "TRUNCATE", "DROP", "ALTER", "CREATE", "demo_yolo_cameras"):
            assert forbidden.upper() not in sql.upper()


def test_insert_count_runs_fixed_sql(fake_db):
    log, _ = fake_db
    assert db_write.insert_yolo_count(COUNT_ROW) is True
    ((sql, params),) = log
    assert sql.startswith("INSERT INTO demo_yolo_counts")
    assert params == COUNT_ROW


def test_insert_count_requires_crowd_level(fake_db):
    with pytest.raises(ValueError):
        db_write.insert_yolo_count({**COUNT_ROW, "crowd_level": None})
    assert fake_db[0] == []


def test_insert_count_duplicate_returns_false(fake_db):
    _, state = fake_db
    state["rowcount"] = 0
    assert db_write.insert_yolo_count(COUNT_ROW) is False


def test_insert_event_returns_id_or_none(fake_db):
    _, state = fake_db
    assert db_write.insert_yolo_event(EVENT_ROW) == 42
    state["fetched"] = None  # ON CONFLICT DO NOTHING이면 RETURNING 행이 없다
    assert db_write.insert_yolo_event(EVENT_ROW) is None


@pytest.mark.parametrize("event_type", ["FIRE", "KNIFE", "help_gesture", ""])
def test_insert_event_only_help_gesture(fake_db, event_type):
    with pytest.raises(ValueError):
        db_write.insert_yolo_event({**EVENT_ROW, "event_type": event_type})
    assert fake_db[0] == []


def test_review_sets_status_and_time_together(fake_db):
    log, _ = fake_db
    assert db_write.review_yolo_event(5, "CONFIRMED", at(30)) is True
    ((sql, params),) = log
    assert sql.startswith("UPDATE demo_yolo_events SET review_status")
    assert params == {"event_id": 5, "review_status": "CONFIRMED", "reviewed_at": at(30)}


@pytest.mark.parametrize("status", ["PENDING", "DONE", ""])
def test_review_rejects_other_statuses(fake_db, status):
    with pytest.raises(ValueError):
        db_write.review_yolo_event(5, status, at(30))


def test_review_requires_reviewed_at(fake_db):
    with pytest.raises(ValueError):
        db_write.review_yolo_event(5, "CONFIRMED", None)
    assert fake_db[0] == []


def test_review_already_reviewed_returns_false(fake_db):
    _, state = fake_db
    state["rowcount"] = 0
    assert db_write.review_yolo_event(5, "CONFIRMED", at(30)) is False


# ----- db 구현의 쓰기 스위치 (db_write를 가짜로 바꿔 확인) -----


@pytest.fixture
def db_yolo(monkeypatch):
    from app.services.db import yolo as db_yolo_module

    calls: list = []
    monkeypatch.setattr(
        db_yolo_module.db_write,
        "insert_yolo_count",
        lambda row: calls.append(("count", row)) or True,
    )
    monkeypatch.setattr(
        db_yolo_module.db_write, "insert_yolo_event", lambda row: calls.append(("event", row)) or 77
    )
    monkeypatch.setattr(
        db_yolo_module.db_write,
        "review_yolo_event",
        lambda *args: calls.append(("review", args)) or True,
    )
    return db_yolo_module, calls


def test_db_write_switch_off_by_default(db_yolo):
    module, calls = db_yolo
    assert settings.yolo_write_enabled is False
    camera = mock_yolo.get_camera(1)
    assert module.save_count(YoloCountBucket(1, at(0), 1.0, 1, 1, "LOW", "m")) is False
    assert module.save_event(camera, "HELP_GESTURE", 0.8, at(5), "m", "k") is None
    with pytest.raises(Exception, match="YOLO_WRITE_ENABLED"):
        module.review_event(1, YoloReviewStatus.CONFIRMED, at(30))
    assert calls == []


def test_db_write_switch_on_writes_through_db_write(db_yolo, monkeypatch):
    module, calls = db_yolo
    monkeypatch.setattr(settings, "yolo_write_enabled", True)
    camera = mock_yolo.get_camera(1)
    event = module.save_event(camera, "HELP_GESTURE", 0.8, at(5), "m", "k")
    assert (event.event_id, event.zone_id, event.review_status) == (77, 4, YoloReviewStatus.PENDING)
    assert module.save_count(YoloCountBucket(1, at(0), 1.0, 1, 1, "LOW", "m")) is True
    assert [kind for kind, _ in calls] == ["event", "count"]
    assert calls[1][1]["crowd_level"] == "LOW"


def test_yolo_results_never_imports_cv_or_stores_frames():
    from pathlib import Path

    source = Path(yolo_results.__file__).read_text(encoding="utf-8")
    for forbidden in ("cv2", "torch", "ultralytics", "latest_frame", "send_bytes"):
        assert forbidden not in source
    assert rules.YOLO_EVENT_TYPE == "HELP_GESTURE"
