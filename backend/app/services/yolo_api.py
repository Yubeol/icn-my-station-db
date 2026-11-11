"""YOLO DEMO REST 로직 (docs/yolo-demo-contract.md 6장).

카메라 목록은 저장소의 카메라 정보에 허브의 연결 상태를 붙인다. 판정이 바뀌면 /ws/live로 yolo_alert_reviewed를 보낸다.
DB 호출은 asyncio.to_thread로, 허브 상태 읽기·푸시는 이벤트 루프 안에서 한다.
"""

import asyncio

from app.core.timeutil import now_kst
from app.core.yolo_hub import hub
from app.schemas import (
    LiveTopic,
    YoloAlertReviewedLive,
    YoloCamera,
    YoloConnState,
    YoloEvent,
    YoloReviewStatus,
)
from app.services import yolo_store


async def list_cameras() -> list[YoloCamera]:
    infos = await asyncio.to_thread(yolo_store.list_cameras)
    cameras = []
    for info in infos:
        state = hub.state_for(info)
        live = hub.camera_live(state)
        cameras.append(
            YoloCamera(
                camera_id=info.camera_id,
                zone_id=info.zone_id,
                name=info.name,
                is_active=info.is_active,
                camera=live.camera if state.online else YoloConnState.OFFLINE,
                worker=live.worker,
            )
        )
    return cameras


async def list_events(
    camera_id: int | None, review_status: YoloReviewStatus | None, limit: int
) -> list[YoloEvent]:
    return await asyncio.to_thread(yolo_store.list_events, camera_id, review_status, limit)


async def review_event(event_id: int, review_status: YoloReviewStatus) -> YoloEvent:
    """PENDING 이벤트의 판정을 바꾼다. 없으면 404, 이미 판정됐으면 409(예외는 main.py에서 변환)."""
    reviewed_at = now_kst()
    event = await asyncio.to_thread(yolo_store.review_event, event_id, review_status, reviewed_at)
    hub.publish_live(
        LiveTopic.YOLO_ALERT_REVIEWED,
        None,
        YoloAlertReviewedLive(
            event_id=event.event_id,
            review_status=event.review_status,
            reviewed_at=event.reviewed_at or reviewed_at,
        ),
    )
    return event
