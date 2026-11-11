"""YOLO DEMO mock. 카메라는 1대(camera_id=1, T1 3번 출국장)로 고정하고 결과는 메모리에만 둔다.

공유 DB에는 쿼리를 보내지 않는다. 저장 규칙은 DB와 같다: counts는 (camera_id, bucket_start),
events는 dedupe_key가 같으면 건너뛰고(ON CONFLICT DO NOTHING), 판정 갱신은 PENDING인 이벤트만 한다.
"""

import threading
from datetime import datetime

from app.core import rules
from app.core.errors import YoloEventNotFoundError, YoloEventReviewedError
from app.schemas import YoloEvent, YoloReviewStatus
from app.services.yolo_types import YoloCameraInfo, YoloCountBucket

_CAMERAS = [
    YoloCameraInfo(camera_id=1, zone_id=4, name="cam-t1-hall3", is_active=True, scope="T1")
]

_lock = threading.Lock()
_counts: dict[tuple[int, datetime], YoloCountBucket] = {}
_events: list[YoloEvent] = []
_dedupe_keys: set[str] = set()
_next_id = 1


def reset() -> None:
    """테스트용. 메모리 저장소를 비운다."""
    global _next_id
    with _lock:
        _counts.clear()
        _events.clear()
        _dedupe_keys.clear()
        _next_id = 1


def list_cameras() -> list[YoloCameraInfo]:
    return list(_CAMERAS)


def get_camera(camera_id: int) -> YoloCameraInfo | None:
    return next((c for c in _CAMERAS if c.camera_id == camera_id), None)


def save_count(bucket: YoloCountBucket) -> bool:
    with _lock:
        key = (bucket.camera_id, bucket.bucket_start)
        if key in _counts:
            return False
        _counts[key] = bucket
        return True


def list_counts() -> list[YoloCountBucket]:
    with _lock:
        return list(_counts.values())


def save_event(
    camera: YoloCameraInfo,
    event_type: str,
    confidence: float,
    detected_at: datetime,
    model_version: str,
    dedupe_key: str,
) -> YoloEvent | None:
    global _next_id
    if event_type != rules.YOLO_EVENT_TYPE:
        raise ValueError(f"event_type은 {rules.YOLO_EVENT_TYPE}만 저장합니다: {event_type}")
    with _lock:
        if dedupe_key in _dedupe_keys:
            return None
        _dedupe_keys.add(dedupe_key)
        event = YoloEvent(
            event_id=_next_id,
            camera_id=camera.camera_id,
            zone_id=camera.zone_id,
            event_type=event_type,
            confidence=confidence,
            detected_at=detected_at,
            review_status=YoloReviewStatus.PENDING,
        )
        _next_id += 1
        _events.append(event)
        return event


def list_events(
    camera_id: int | None, review_status: YoloReviewStatus | None, limit: int
) -> list[YoloEvent]:
    with _lock:
        rows = [
            e
            for e in _events
            if (camera_id is None or e.camera_id == camera_id)
            and (review_status is None or e.review_status == review_status)
        ]
    rows.sort(key=lambda e: (e.detected_at, e.event_id), reverse=True)
    return rows[:limit]


def review_event(
    event_id: int, review_status: YoloReviewStatus, reviewed_at: datetime
) -> YoloEvent:
    with _lock:
        for i, event in enumerate(_events):
            if event.event_id != event_id:
                continue
            if event.review_status != YoloReviewStatus.PENDING:
                raise YoloEventReviewedError(event_id)
            updated = event.model_copy(
                update={"review_status": review_status, "reviewed_at": reviewed_at}
            )
            _events[i] = updated
            return updated
    raise YoloEventNotFoundError(event_id)
