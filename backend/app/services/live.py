"""WebSocket으로 보낼 메시지를 만든다. data는 해당 REST 응답과 같은 모양이다."""

from pydantic import BaseModel

from app.core import rules
from app.core.timeutil import now_kst
from app.core.yolo_hub import hub
from app.schemas import Direction, LiveMessage, LiveTopic, Terminal, YoloCountLive
from app.services import alerts, congestion, flights, stats, weather, yolo_store
from app.services.yolo_types import YoloCameraInfo


def _dump(data: BaseModel | list[BaseModel]):
    if isinstance(data, list):
        return [item.model_dump(mode="json", by_alias=True) for item in data]
    return data.model_dump(mode="json", by_alias=True)


def build_snapshot() -> list[LiveMessage]:
    """토픽별 현재 상태. congestion은 터미널별, flights·stats는 방향별로 따로 보낸다."""
    sent_at = now_kst()
    payloads: list[tuple[LiveTopic, str | None, BaseModel | list[BaseModel]]] = [
        *((LiveTopic.CONGESTION, t.value, congestion.get_congestion(t)) for t in Terminal),
        *((LiveTopic.FLIGHTS, d.value, flights.list_flights(d)) for d in Direction),
        *((LiveTopic.STATS, d.value, stats.get_flight_stats(d)) for d in Direction),
        (LiveTopic.ALERTS, None, alerts.list_alerts()),
        (LiveTopic.WEATHER, None, weather.get_weather()),
    ]
    return [
        LiveMessage(topic=topic, scope=scope, data=_dump(data), sent_at=sent_at)
        for topic, scope, data in payloads
    ]


def fetch_yolo_cameras() -> list[YoloCameraInfo]:
    """등록된 YOLO 카메라. db 모드에서는 DB 조회라 별도 스레드에서 부른다."""
    return yolo_store.list_cameras()


def yolo_count_message(state) -> LiveMessage | None:
    """카메라의 마지막 인원으로 yolo_count를 만든다. 아직 result를 받은 적이 없으면 None."""
    if state.last_person_count is None or state.last_measured_at is None:
        return None
    data = YoloCountLive(
        camera_id=state.camera_id,
        zone_id=state.info.zone_id,
        person_count=state.last_person_count,
        crowd_level=rules.yolo_crowd_level(state.last_person_count),
        measured_at=state.last_measured_at,
    )
    return LiveMessage(
        topic=LiveTopic.YOLO_COUNT,
        scope=state.info.scope,
        data=_dump(data),
        sent_at=now_kst(),
    )


def build_yolo_snapshot(cameras: list[YoloCameraInfo]) -> list[LiveMessage]:
    """접속 직후 yolo 스냅샷: 카메라마다 yolo_camera, 마지막 인원이 있으면 yolo_count.

    판정 대기 중인 알림은 넣지 않는다. 프론트가 GET /api/v1/yolo/events?reviewStatus=PENDING으로 조회한다.
    """
    sent_at = now_kst()
    messages: list[LiveMessage] = []
    for info in cameras:
        state = hub.state_for(info)
        messages.append(
            LiveMessage(
                topic=LiveTopic.YOLO_CAMERA,
                scope=info.scope,
                data=_dump(hub.camera_live(state)),
                sent_at=sent_at,
            )
        )
        count = yolo_count_message(state)
        if count is not None:
            messages.append(count)
    return messages
