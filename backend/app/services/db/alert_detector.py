"""스마트 알림 감지. 혼잡도·운항 데이터를 읽어 알림을 만들고, 설정이 켜져 있으면 smart_alerts에 넣는다.

- 판단 로직은 services/alert_events.py(순수 함수), 쓰기는 core/db_write.py(smart_alerts INSERT만)가 한다.
- 게이트 변경과 지연 증가는 '직전 감지 때의 상태'와 비교한다. 이 상태는 메모리에만 둔다.
  서버를 재시작하면 첫 감지에서는 게이트 변경을 알 수 없고, 다음 감지부터 다시 비교한다.
- 감지에 쓰는 데이터가 ALERT_MAX_DATA_AGE_MINUTES보다 오래됐으면 알림을 만들지 않는다.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from threading import Lock
from typing import Any

from app.core import rules
from app.core.config import settings
from app.core.db import fetch_all
from app.core.db_write import insert_alerts
from app.core.timeutil import KST, now_kst
from app.services.alert_events import (
    FlightState,
    HallState,
    Measure,
    congestion_events,
    flight_events,
)
from app.services.db.flights import delay_minutes

logger = logging.getLogger(__name__)


# ---------- 혼잡도 ----------


def _gate_zones() -> list[dict[str, Any]]:
    """게이트 구역과 그 부모(출국장) 구역."""
    return fetch_all(
        """
        SELECT z.zone_id, z.parent_zone_id, t.terminal_code,
               COALESCE(z.hall_number, substring(z.gate_id FROM 'DG(\\d+)')::int) AS hall_no
        FROM airport_zones z
        JOIN terminals t ON t.terminal_id = z.terminal_id
        WHERE z.zone_type = 'departure_gate' AND z.parent_zone_id IS NOT NULL
        """
    )


def _recent_snapshots(since: datetime) -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT zone_id, measured_at, waiting_passenger_count, source
        FROM congestion_snapshots
        WHERE source = ANY(%(sources)s) AND measured_at >= %(since)s
        ORDER BY measured_at
        """,
        {"sources": settings.data_sources(), "since": since},
    )


def _hall_states(now: datetime) -> list[HallState]:
    zones = _gate_zones()
    window = rules.CONGESTION_COMPARE_MINUTES + rules.CONGESTION_COMPARE_TOLERANCE_MINUTES + 10
    snapshots = _recent_snapshots(now - timedelta(minutes=window))

    # 시각별·구역별 값. 같은 구역·같은 분에 api와 yolo가 있으면 yolo 우선.
    values: dict[datetime, dict[int, tuple[int, str]]] = defaultdict(dict)
    for s in snapshots:
        slot = values[s["measured_at"]]
        if s["zone_id"] not in slot or s["source"] == "yolo":
            slot[s["zone_id"]] = (s["waiting_passenger_count"], s["source"])

    halls: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for z in zones:
        halls[z["parent_zone_id"]].append(z)

    states = []
    for parent_id, members in halls.items():
        zone_ids = {m["zone_id"] for m in members}
        # 출국장의 모든 게이트 구역 값이 있는 시각만 쓴다(일부만 있으면 합계가 왜곡된다).
        totals: list[tuple[datetime, int, set[str]]] = []
        for at in sorted(values):
            slot = values[at]
            if zone_ids <= slot.keys():
                totals.append(
                    (at, sum(slot[z][0] for z in zone_ids), {slot[z][1] for z in zone_ids})
                )
        if not totals:
            continue
        current_at, current_count, current_sources = totals[-1]
        if now - current_at > timedelta(minutes=rules.ALERT_MAX_DATA_AGE_MINUTES):
            continue  # 오래된 데이터로 '지금' 알림을 만들지 않는다
        previous = totals[-2] if len(totals) >= 2 else None
        target = current_at - timedelta(minutes=rules.CONGESTION_COMPARE_MINUTES)
        tolerance = timedelta(minutes=rules.CONGESTION_COMPARE_TOLERANCE_MINUTES)
        near = [t for t in totals if abs(t[0] - target) <= tolerance]
        past30 = min(near, key=lambda t: abs(t[0] - target)) if near else None
        source = "yolo" if "yolo" in current_sources else min(current_sources)
        states.append(
            HallState(
                zone_id=parent_id,
                terminal=str(rules.to_terminal(members[0]["terminal_code"]) or "T1"),
                hall_no=members[0]["hall_no"],
                source=source,
                current=Measure(current_count, current_at.astimezone(KST)),
                previous=Measure(previous[1], previous[0].astimezone(KST)) if previous else None,
                past30=Measure(past30[1], past30[0].astimezone(KST)) if past30 else None,
            )
        )
    return states


# ---------- 항공편 ----------


def _flight_states(now: datetime) -> list[FlightState]:
    rows = fetch_all(
        """
        SELECT flight_uid, source, flight_number, flow_type, gate,
               scheduled_at, estimated_at, source_status, last_collected_at
        FROM flight_operations
        WHERE source = ANY(%(sources)s)
          AND is_codeshare IS NOT TRUE
          AND scheduled_at BETWEEN %(lo)s AND %(hi)s
        """,
        {
            "sources": settings.data_sources(),
            "lo": now - timedelta(hours=rules.ALERT_FLIGHT_PAST_HOURS),
            "hi": now + timedelta(hours=rules.ALERT_FLIGHT_FUTURE_HOURS),
        },
    )
    max_age = timedelta(minutes=rules.ALERT_MAX_DATA_AGE_MINUTES)
    states = []
    for row in rows:
        if row["last_collected_at"] is None or now - row["last_collected_at"] > max_age:
            continue  # 최근 수집되지 않은 편은 상태가 현재와 다를 수 있다
        delay = delay_minutes(row)
        states.append(
            FlightState(
                flight_uid=row["flight_uid"],
                source=row["source"],
                flight_number=row["flight_number"],
                departure=row["flow_type"] == "departure",
                gate=(row["gate"] or "").strip() or None,
                delay_minutes=delay,
                estimated_at=row["estimated_at"].astimezone(KST) if row["estimated_at"] else None,
                source_status=row["source_status"],
                status=rules.resolve_status(row["source_status"], delay),
            )
        )
    return states


# ---------- 감지 실행 ----------


class AlertDetector:
    def __init__(self) -> None:
        self._last_flights: dict[int, FlightState] = {}
        self._lock = Lock()

    def detect(self, now: datetime | None = None) -> list[dict[str, Any]]:
        """이번 감지에서 생긴 알림 행 목록(docs/db-write-contract.md 형식)."""
        now = now or now_kst()
        with self._lock:
            rows: list[dict[str, Any]] = []
            for hall in _hall_states(now):
                rows.extend(congestion_events(hall))
            current = {f.flight_uid: f for f in _flight_states(now)}
            for uid, flight in current.items():
                rows.extend(flight_events(flight, self._last_flights.get(uid)))
            # 이번에 안 보인 편의 이전 상태도 남겨 둔다(한 번 수집이 빠져도 비교가 끊기지 않게).
            self._last_flights.update(current)
            return rows

    def scan_once(self, write: bool | None = None) -> tuple[int, int]:
        """감지하고, write가 켜져 있으면 smart_alerts에 넣는다. (감지 건수, 실제 INSERT 건수)"""
        write = settings.alert_write_enabled if write is None else write
        rows = self.detect()
        inserted = insert_alerts(rows) if write and rows else 0
        logger.info("알림 감지 %d건, 저장 %d건 (write=%s)", len(rows), inserted, write)
        return len(rows), inserted


detector = AlertDetector()