"""워커 result 처리. 인원 30초 집계, 제스처 이벤트 저장(dedupe_key), 긴급 알림 발행.

- 백엔드는 추론하지 않는다. 워커가 보낸 personCount와 events를 받아 처리만 한다.
- DB 호출은 yolo_store(입구)를 asyncio.to_thread로 부른다. 상태 변경은 이벤트 루프 안에서만 한다.
- 이미지·박스 좌표·trackId는 저장하지 않는다. trackId는 dedupe_key에만 쓴다.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core import rules
from app.core.timeutil import KST, now_kst
from app.core.yolo_hub import CameraState, hub
from app.schemas import LiveTopic, YoloAlertLive
from app.services import yolo_store
from app.services.yolo_types import YoloCountBucket

logger = logging.getLogger(__name__)


def bucket_floor(moment: datetime) -> datetime:
    """시각을 COUNT_BUCKET_SEC(30초) 경계로 내린다. 예: 14:03:47 → 14:03:30."""
    seconds = int(moment.timestamp())
    return datetime.fromtimestamp(seconds - seconds % rules.YOLO_COUNT_BUCKET_SEC, KST)


def dedupe_key(camera_id: int, event_type: str, track_id: int | None, detected_at: datetime) -> str:
    """{cameraId}:{eventType}:{trackId}:{detectedAt를 10초로 내림}. 내림한 시각은 epoch 초로 쓴다."""
    seconds = int(detected_at.timestamp())
    floored = seconds - seconds % rules.YOLO_EVENT_DEDUPE_SEC
    return f"{camera_id}:{event_type}:{track_id if track_id is not None else 'none'}:{floored}"


@dataclass
class _OpenBucket:
    start: datetime
    model_version: str
    total: int = 0
    peak: int = 0
    samples: int = 0


class BucketAggregator:
    """카메라마다 진행 중인 30초 구간 하나에 result의 인원을 합·최대·개수로 누적한다."""

    def __init__(self) -> None:
        self._open: dict[int, _OpenBucket] = {}

    @staticmethod
    def _close(camera_id: int, bucket: _OpenBucket) -> YoloCountBucket:
        average = round(bucket.total / bucket.samples, 2)
        return YoloCountBucket(
            camera_id=camera_id,
            bucket_start=bucket.start,
            person_avg=average,
            person_max=bucket.peak,
            sample_count=bucket.samples,
            crowd_level=rules.yolo_crowd_level(average).value,  # 항상 값을 채운다
            model_version=bucket.model_version,
        )

    def add(
        self, camera_id: int, person_count: int, now: datetime, model_version: str
    ) -> list[YoloCountBucket]:
        """result 하나를 더한다. 30초 경계를 넘었으면 끝난 구간을 돌려준다."""
        start = bucket_floor(now)
        finished: list[YoloCountBucket] = []
        current = self._open.get(camera_id)
        if current is not None and current.start != start:
            finished.append(self._close(camera_id, self._open.pop(camera_id)))
            current = None
        if current is None:
            current = self._open[camera_id] = _OpenBucket(start, model_version)
        current.total += person_count
        current.peak = max(current.peak, person_count)
        current.samples += 1
        return finished

    def flush(self, camera_id: int) -> list[YoloCountBucket]:
        """진행 중인 구간을 끝낸다. 카메라 연결이 끊겼을 때 쓴다."""
        bucket = self._open.pop(camera_id, None)
        return [self._close(camera_id, bucket)] if bucket else []

    def flush_due(self, now: datetime) -> list[YoloCountBucket]:
        """끝나는 시각이 지난 구간을 모두 끝낸다. 새 result가 오지 않아도 구간이 닫히게 한다."""
        span = rules.YOLO_COUNT_BUCKET_SEC
        due = [
            camera_id
            for camera_id, bucket in self._open.items()
            if bucket.start.timestamp() + span <= now.timestamp()
        ]
        return [self._close(c, self._open.pop(c)) for c in due]


aggregator = BucketAggregator()


def reset() -> None:
    """테스트용."""
    global aggregator
    aggregator = BucketAggregator()


async def _save_buckets(buckets: list[YoloCountBucket]) -> None:
    for bucket in buckets:
        try:
            await asyncio.to_thread(yolo_store.save_count, bucket)
        except Exception:  # 한 건이 실패해도 나머지 구간은 계속 저장한다
            logger.exception("30초 인원 집계 저장 실패")


def _parse_event(raw: Any, camera_id: int) -> tuple[str, int | None, float, datetime] | None:
    """워커 event를 검사한다. 저장 대상 eventType(rules.YOLO_EVENT_TYPES)이 아니거나 값이 이상하면 None."""
    if not isinstance(raw, dict):
        return None
    event_type = raw.get("eventType")
    if event_type not in rules.YOLO_EVENT_TYPES:
        return None
    confidence = raw.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, int | float):
        return None
    if not 0 <= confidence <= 1:
        return None
    track_id = raw.get("trackId")
    if isinstance(track_id, bool) or not (track_id is None or isinstance(track_id, int)):
        return None
    detected_raw = raw.get("detectedAt")
    if detected_raw is None:
        detected_at = now_kst()
    else:
        try:
            detected_at = datetime.fromisoformat(str(detected_raw))
        except ValueError:
            return None
        if detected_at.tzinfo is None:
            detected_at = detected_at.replace(tzinfo=KST)
        detected_at = detected_at.astimezone(KST)
    return event_type, track_id, round(float(confidence), 4), detected_at


async def _handle_event(state: CameraState, raw: Any) -> None:
    parsed = _parse_event(raw, state.camera_id)
    if parsed is None:
        return
    event_type, track_id, confidence, detected_at = parsed
    key = dedupe_key(state.camera_id, event_type, track_id, detected_at)
    event = await asyncio.to_thread(
        yolo_store.save_event,
        state.info,
        event_type,
        confidence,
        detected_at,
        hub.model_version,
        key,
    )
    if event is None:  # 같은 dedupe_key가 이미 있거나 쓰기가 꺼져 있다
        return
    hub.publish_live(
        LiveTopic.YOLO_ALERT,
        None,
        YoloAlertLive(
            event_id=event.event_id,
            camera_id=event.camera_id,
            zone_id=event.zone_id,
            event_type=event.event_type,
            confidence=event.confidence,
            detected_at=event.detected_at,
        ),
    )


async def handle_result(state: CameraState, message: dict[str, Any]) -> None:
    """허브가 result를 뷰어에게 전달한 뒤 부른다. 인원 집계와 제스처 이벤트를 처리한다."""
    count = message.get("personCount")
    if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
        finished = aggregator.add(state.camera_id, count, now_kst(), hub.model_version)
        await _save_buckets(finished)
    events = message.get("events")
    if isinstance(events, list):
        for raw in events:
            try:
                await _handle_event(state, raw)
            except Exception:  # 이벤트 하나가 실패해도 다음 이벤트와 result 처리는 계속한다
                logger.exception("제스처 이벤트 처리 실패")


async def handle_camera_closed(state: CameraState) -> None:
    """카메라 연결이 끊기면 진행 중인 30초 구간도 저장한다."""
    await _save_buckets(aggregator.flush(state.camera_id))


async def flush_due() -> None:
    await _save_buckets(aggregator.flush_due(now_kst()))


def install() -> None:
    hub.on_result = handle_result
    hub.on_camera_closed = handle_camera_closed
