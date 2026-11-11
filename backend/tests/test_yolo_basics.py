"""YOLO DEMO 상수·설정·스키마 (docs/yolo-demo-contract.md 5·6·7장)."""

import pytest
from pydantic import ValidationError

from app.core import rules
from app.core.config import Settings
from app.schemas import (
    CongestionLevel,
    LiveTopic,
    YoloAlertLive,
    YoloCountLive,
    YoloEvent,
    YoloReviewRequest,
    YoloReviewStatus,
)


@pytest.mark.parametrize(
    ("count", "level"),
    [
        (0, CongestionLevel.LOW),
        (5, CongestionLevel.LOW),
        (6, CongestionLevel.MID),
        (10, CongestionLevel.MID),
        (11, CongestionLevel.HIGH),
        (40, CongestionLevel.HIGH),
        (5.4, CongestionLevel.LOW),
        (10.6, CongestionLevel.HIGH),
    ],
)
def test_yolo_crowd_level(count, level):
    assert rules.yolo_crowd_level(count) == level


def test_yolo_constants_match_contract():
    assert rules.YOLO_VIEW_MAX_FPS == 10
    assert rules.YOLO_WORKER_MAX_FPS == 3
    assert rules.YOLO_WORKER_TIMEOUT_SEC == 2
    assert rules.YOLO_COUNT_BUCKET_SEC == 30
    assert rules.YOLO_EVENT_DEDUPE_SEC == 10
    assert rules.YOLO_EVENT_TYPE == "HELP_GESTURE"
    assert (rules.YOLO_CLOSE_BAD_TOKEN, rules.YOLO_CLOSE_UNKNOWN_CAMERA) == (4401, 4404)
    assert rules.YOLO_CLOSE_REPLACED == 4409


def test_settings_yolo_defaults():
    s = Settings(_env_file=None)
    assert s.yolo_write_enabled is False
    assert s.yolo_camera_token is None
    assert s.yolo_worker_token is None


def test_settings_token_is_secret():
    s = Settings(_env_file=None, yolo_camera_token="abc")
    assert "abc" not in repr(s)
    assert s.yolo_camera_token.get_secret_value() == "abc"


def test_live_topics_added_without_changing_existing():
    values = [t.value for t in LiveTopic]
    assert values[:5] == ["congestion", "flights", "stats", "alerts", "weather"]
    assert values[5:] == ["yolo_camera", "yolo_count", "yolo_alert", "yolo_alert_reviewed"]


def test_yolo_models_use_camel_case_and_int_camera_id():
    from datetime import datetime

    from app.core.timeutil import KST

    now = datetime(2026, 11, 12, 14, 3, 5, tzinfo=KST)
    count = YoloCountLive(
        camera_id=1, zone_id=3, person_count=4, crowd_level=CongestionLevel.LOW, measured_at=now
    )
    dumped = count.model_dump(mode="json", by_alias=True)
    assert set(dumped) == {"cameraId", "zoneId", "personCount", "crowdLevel", "measuredAt"}
    assert dumped["cameraId"] == 1

    alert = YoloAlertLive(
        event_id=12,
        camera_id=1,
        zone_id=3,
        event_type="HELP_GESTURE",
        confidence=0.83,
        detected_at=now,
    )
    assert alert.model_dump(mode="json", by_alias=True)["reviewStatus"] == "PENDING"

    event = YoloEvent(
        event_id=1,
        camera_id=1,
        zone_id=3,
        event_type="HELP_GESTURE",
        confidence=0.5,
        detected_at=now,
        review_status=YoloReviewStatus.PENDING,
    )
    assert event.model_dump(mode="json", by_alias=True)["reviewedAt"] is None


def test_review_request_rejects_pending():
    assert YoloReviewRequest(reviewStatus="CONFIRMED").review_status == "CONFIRMED"
    with pytest.raises(ValidationError):
        YoloReviewRequest(reviewStatus="PENDING")
