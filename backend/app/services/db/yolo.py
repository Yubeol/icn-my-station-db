"""YOLO DEMO DB 구현.

- 조회(demo_yolo_cameras, demo_yolo_events)는 읽기 전용 풀로 SELECT만 한다.
- 쓰기(demo_yolo_counts, demo_yolo_events)는 core/db_write의 고정 SQL로만 하며, YOLO_WRITE_ENABLED가 True일 때만 한다.
- scope(T1/T2)는 demo_yolo_cameras → airport_zones → terminals로 구한다.
"""

import logging
from datetime import datetime
from typing import Any

from app.core import db_write
from app.core.config import settings
from app.core.db import fetch_all
from app.core.errors import YoloEventNotFoundError, YoloEventReviewedError, YoloWriteDisabledError
from app.core.timeutil import KST
from app.schemas import YoloEvent, YoloReviewStatus
from app.services.yolo_types import YoloCameraInfo, YoloCountBucket

logger = logging.getLogger(__name__)

_CAMERA_SQL = """
    SELECT c.camera_id, c.zone_id, c.name, c.is_active, t.terminal_code
    FROM demo_yolo_cameras c
    LEFT JOIN airport_zones z ON z.zone_id = c.zone_id
    LEFT JOIN terminals t ON t.terminal_id = z.terminal_id
    {where}
    ORDER BY c.camera_id
"""

_EVENT_SQL = """
    SELECT e.id, e.camera_id, c.zone_id, e.event_type, e.confidence, e.detected_at,
           e.review_status, e.reviewed_at
    FROM demo_yolo_events e
    JOIN demo_yolo_cameras c ON c.camera_id = e.camera_id
    WHERE (%(camera_id)s::bigint IS NULL OR e.camera_id = %(camera_id)s::bigint)
      AND (%(review_status)s::text IS NULL OR e.review_status = %(review_status)s::text)
      AND (%(event_id)s::bigint IS NULL OR e.id = %(event_id)s::bigint)
    ORDER BY e.detected_at DESC, e.id DESC
    LIMIT %(limit)s
"""


def _info(row: dict[str, Any]) -> YoloCameraInfo:
    return YoloCameraInfo(
        camera_id=row["camera_id"],
        zone_id=row["zone_id"],
        name=row["name"],
        is_active=row["is_active"],
        scope=row["terminal_code"],
    )


def _event(row: dict[str, Any]) -> YoloEvent:
    reviewed_at = row["reviewed_at"]
    return YoloEvent(
        event_id=row["id"],
        camera_id=row["camera_id"],
        zone_id=row["zone_id"],
        event_type=row["event_type"],
        confidence=float(row["confidence"]),
        detected_at=row["detected_at"].astimezone(KST),
        review_status=YoloReviewStatus(row["review_status"]),
        reviewed_at=reviewed_at.astimezone(KST) if reviewed_at else None,
    )


def list_cameras() -> list[YoloCameraInfo]:
    return [_info(r) for r in fetch_all(_CAMERA_SQL.format(where=""))]


def get_camera(camera_id: int) -> YoloCameraInfo | None:
    rows = fetch_all(
        _CAMERA_SQL.format(where="WHERE c.camera_id = %(camera_id)s"), {"camera_id": camera_id}
    )
    return _info(rows[0]) if rows else None


def save_count(bucket: YoloCountBucket) -> bool:
    if not settings.yolo_write_enabled:
        logger.debug("YOLO_WRITE_ENABLED가 꺼져 있어 30초 집계를 저장하지 않았습니다.")
        return False
    return db_write.insert_yolo_count(
        {
            "camera_id": bucket.camera_id,
            "bucket_start": bucket.bucket_start,
            "person_avg": bucket.person_avg,
            "person_max": bucket.person_max,
            "sample_count": bucket.sample_count,
            "crowd_level": bucket.crowd_level,
            "model_version": bucket.model_version,
        }
    )


def save_event(
    camera: YoloCameraInfo,
    event_type: str,
    confidence: float,
    detected_at: datetime,
    model_version: str,
    dedupe_key: str,
) -> YoloEvent | None:
    """새로 저장했으면 이벤트를, 이미 있거나 쓰기가 꺼져 있으면 None을 돌려준다."""
    if not settings.yolo_write_enabled:
        logger.info("YOLO_WRITE_ENABLED가 꺼져 있어 제스처 이벤트를 저장하지 않았습니다.")
        return None
    event_id = db_write.insert_yolo_event(
        {
            "camera_id": camera.camera_id,
            "event_type": event_type,
            "confidence": confidence,
            "detected_at": detected_at,
            "model_version": model_version,
            "dedupe_key": dedupe_key,
        }
    )
    if event_id is None:
        return None
    return YoloEvent(
        event_id=event_id,
        camera_id=camera.camera_id,
        zone_id=camera.zone_id,
        event_type=event_type,
        confidence=confidence,
        detected_at=detected_at,
        review_status=YoloReviewStatus.PENDING,
    )


def list_events(
    camera_id: int | None, review_status: YoloReviewStatus | None, limit: int
) -> list[YoloEvent]:
    rows = fetch_all(
        _EVENT_SQL,
        {
            "camera_id": camera_id,
            "review_status": review_status.value if review_status else None,
            "event_id": None,
            "limit": limit,
        },
    )
    return [_event(r) for r in rows]


def _get_event(event_id: int) -> YoloEvent | None:
    rows = fetch_all(
        _EVENT_SQL, {"camera_id": None, "review_status": None, "event_id": event_id, "limit": 1}
    )
    return _event(rows[0]) if rows else None


def review_event(
    event_id: int, review_status: YoloReviewStatus, reviewed_at: datetime
) -> YoloEvent:
    if not settings.yolo_write_enabled:
        raise YoloWriteDisabledError
    changed = db_write.review_yolo_event(event_id, review_status.value, reviewed_at)
    event = _get_event(event_id)
    if event is None:
        raise YoloEventNotFoundError(event_id)
    if not changed:
        raise YoloEventReviewedError(event_id)
    return event
