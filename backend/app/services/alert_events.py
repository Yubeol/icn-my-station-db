"""스마트 알림 이벤트 판단 (DB와 무관한 순수 함수). docs/db-write-contract.md의 형식대로 행을 만든다.

DB 조회는 services/db/alert_detector.py가 하고, 여기서는 넘겨받은 상태만 보고 어떤 알림을 만들지 정한다.
DB 없이 테스트할 수 있게 분리했다.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core import rules
from app.schemas import CongestionLevel, FlightStatus


@dataclass(frozen=True)
class Measure:
    count: int
    measured_at: datetime


@dataclass(frozen=True)
class HallState:
    """출국장 하나의 대기 인원 상태. zone_id는 출국장(부모 구역) ID."""

    zone_id: int
    terminal: str
    hall_no: int
    source: str
    current: Measure
    previous: Measure | None  # 직전 측정
    past30: Measure | None  # 30분 전(±허용 오차) 측정


@dataclass(frozen=True)
class FlightState:
    flight_uid: int
    source: str
    flight_number: str
    departure: bool
    gate: str | None
    delay_minutes: int
    estimated_at: datetime | None
    source_status: str | None
    status: FlightStatus


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _bucket_30(dt: datetime) -> str:
    """30분 단위로 내린 시각. 예: 18:47 -> 2026-11-02T18:30"""
    return dt.replace(minute=dt.minute - dt.minute % 30, second=0, microsecond=0).strftime(
        "%Y-%m-%dT%H:%M"
    )


def _measure_json(m: Measure) -> dict[str, Any]:
    return {
        "waiting_count": m.count,
        "level": rules.congestion_level(m.count).value,
        "measured_at": _iso(m.measured_at),
    }


def _row(**values: Any) -> dict[str, Any]:
    base = {"zone_id": None, "flight_uid": None, "unit": None}
    base.update(values)
    return base


def congestion_events(hall: HallState) -> list[dict[str, Any]]:
    """혼잡 진입(직전 측정은 HIGH 아님 → 지금 HIGH)과 30분 전 대비 급증."""
    events = []
    title = f"{hall.terminal} {hall.hall_no}번 출국장"
    bucket = _bucket_30(hall.current.measured_at)
    now_level = rules.congestion_level(hall.current.count)

    if (
        now_level == CongestionLevel.HIGH
        and hall.previous is not None
        and rules.congestion_level(hall.previous.count) != CongestionLevel.HIGH
    ):
        events.append(
            _row(
                source=hall.source,
                alert_type="congestion",
                severity="important",
                title=title,
                message=f"대기 인원이 {hall.current.count}명으로 혼잡합니다.",
                zone_id=hall.zone_id,
                previous_value=_measure_json(hall.previous),
                current_value=_measure_json(hall.current),
                unit="명",
                dedupe_key=f"congestion:{hall.zone_id}:enter:{bucket}",
            )
        )

    past = hall.past30.count if hall.past30 else None
    if hall.past30 is not None and rules.is_surge(hall.current.count, past):
        increase = hall.current.count - hall.past30.count
        rate = rules.change_rate(hall.current.count, hall.past30.count)
        events.append(
            _row(
                source=hall.source,
                alert_type="congestion",
                severity="important",
                title=title,
                message=f"대기 인원이 30분 전보다 {increase}명({rate:.0f}%) 늘었습니다.",
                zone_id=hall.zone_id,
                previous_value=_measure_json(hall.past30),
                current_value=_measure_json(hall.current),
                unit="명",
                dedupe_key=f"congestion:{hall.zone_id}:surge:{bucket}",
            )
        )
    return events


def flight_events(flight: FlightState, previous: FlightState | None) -> list[dict[str, Any]]:
    """결항, 지연(15분 단위로 늘 때마다), 게이트 변경. previous는 직전 감지 때의 상태(없으면 None)."""
    events = []
    title = f"{flight.flight_number} 항공편"
    common = {"source": flight.source, "flight_uid": flight.flight_uid, "title": title}

    if flight.status == FlightStatus.CANCELLED:
        events.append(
            _row(
                **common,
                alert_type="delay",
                severity="critical",
                message=f"{flight.flight_number} 항공편이 결항되었습니다.",
                previous_value={"source_status": previous.source_status if previous else None},
                current_value={"source_status": flight.source_status},
                dedupe_key=f"delay:{flight.flight_uid}:cancelled",
            )
        )
    elif flight.delay_minutes >= rules.DELAY_THRESHOLD_MINUTES and flight.status not in (
        FlightStatus.DEPARTED,
        FlightStatus.ARRIVED,
    ):
        word = "출발" if flight.departure else "도착"
        events.append(
            _row(
                **common,
                alert_type="delay",
                severity="critical"
                if flight.delay_minutes >= rules.DELAY_CRITICAL_FROM_MINUTES
                else "important",
                message=f"{word}이 {flight.delay_minutes}분 지연되었습니다.",
                previous_value={
                    "delay_minutes": previous.delay_minutes if previous else 0,
                    "estimated_at": _iso(previous.estimated_at) if previous else None,
                },
                current_value={
                    "delay_minutes": flight.delay_minutes,
                    "estimated_at": _iso(flight.estimated_at),
                    "source_status": flight.source_status,
                },
                unit="분",
                dedupe_key=f"delay:{flight.flight_uid}:{rules.delay_bucket(flight.delay_minutes)}",
            )
        )

    # 게이트가 처음 배정되는 경우(없음 → 값)는 변경으로 보지 않는다.
    if previous is not None and previous.gate and flight.gate and previous.gate != flight.gate:
        events.append(
            _row(
                **common,
                alert_type="gate_change",
                severity="important",
                message=f"탑승구가 {previous.gate}번에서 {flight.gate}번으로 변경되었습니다.",
                previous_value={"gate": previous.gate},
                current_value={"gate": flight.gate},
                dedupe_key=f"gate_change:{flight.flight_uid}:{previous.gate}->{flight.gate}",
            )
        )
    return events