"""출국장 혼잡도 DB 조회.

수집기는 게이트 구역(zone_type = 'departure_gate', gate_id 예: DG3_E, DG1_A) 단위로 대기 인원을 넣는다.
출국장 번호는 hall_number를 쓰고, 비어 있으면 gate_id의 'DG<번호>'에서 꺼낸다.
같은 출국장의 구역별 최신 대기 인원을 합쳐 한 출국장으로 보여준다.
changeRate는 최신 측정 시각 기준 30분 전(±5분) 값 대비 증감률이다.
같은 구역·같은 분에 api와 yolo 값이 모두 있으면 yolo를 우선한다.
"""

from collections import defaultdict
from datetime import timedelta
from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.config import settings
from app.core.db import fetch_all
from app.core.timeutil import KST, now_kst
from app.schemas import Congestion, CongestionHour, CongestionHourly, DataSource, Hall, Terminal

_ZONES_CTE = """
    zones AS (
        SELECT
            z.zone_id,
            COALESCE(z.hall_number, substring(z.gate_id FROM 'DG(\\d+)')::int) AS hall_no
        FROM airport_zones z
        JOIN terminals t ON t.terminal_id = z.terminal_id
        WHERE t.terminal_code = %(terminal)s
          AND z.zone_type = 'departure_gate'
    )
"""


def _latest(terminal: Terminal) -> list[dict[str, Any]]:
    return fetch_all(
        f"""
        WITH {_ZONES_CTE},
        latest AS (
            SELECT DISTINCT ON (s.zone_id)
                s.zone_id, s.measured_at, s.waiting_passenger_count, s.source
            FROM congestion_snapshots s
            JOIN zones z ON z.zone_id = s.zone_id
            WHERE s.source = ANY(%(sources)s)
            ORDER BY s.zone_id, s.measured_at DESC, (s.source = 'yolo') DESC
        )
        SELECT z.hall_no, l.zone_id, l.measured_at, l.waiting_passenger_count, l.source
        FROM latest l
        JOIN zones z ON z.zone_id = l.zone_id
        WHERE z.hall_no IS NOT NULL
        """,
        {"terminal": terminal.value, "sources": settings.data_sources()},
    )


def _previous(zone_ids: list[int], target) -> dict[int, int]:
    """구역별로 target 시각에 가장 가까운(±허용 오차) 대기 인원."""
    if not zone_ids:
        return {}
    tolerance = timedelta(minutes=rules.CONGESTION_COMPARE_TOLERANCE_MINUTES)
    rows = fetch_all(
        """
        SELECT DISTINCT ON (s.zone_id) s.zone_id, s.waiting_passenger_count
        FROM congestion_snapshots s
        WHERE s.zone_id = ANY(%(zone_ids)s)
          AND s.source = ANY(%(sources)s)
          AND s.measured_at BETWEEN %(lo)s AND %(hi)s
        ORDER BY s.zone_id,
                 abs(extract(epoch FROM s.measured_at - %(target)s)),
                 (s.source = 'yolo') DESC
        """,
        {
            "zone_ids": zone_ids,
            "sources": settings.data_sources(),
            "lo": target - tolerance,
            "hi": target + tolerance,
            "target": target,
        },
    )
    return {row["zone_id"]: row["waiting_passenger_count"] for row in rows}


@ttl_cache(seconds=300)
def _hall_activity(terminal: Terminal) -> dict[int, dict[str, Any]]:
    """최근 N시간의 출국장별 측정 횟수와 최대 합산 대기 인원. 모든 구역 값이 있는 시각만 쓴다."""
    rows = fetch_all(
        f"""
        WITH {_ZONES_CTE},
        hall_zones AS (
            SELECT hall_no, count(*) AS zone_count
            FROM zones
            WHERE hall_no IS NOT NULL
            GROUP BY hall_no
        ),
        snapshots AS (
            SELECT DISTINCT ON (s.zone_id, s.measured_at)
                s.zone_id, s.measured_at, s.waiting_passenger_count
            FROM congestion_snapshots s
            JOIN zones z ON z.zone_id = s.zone_id
            WHERE s.source = ANY(%(sources)s) AND s.measured_at >= %(since)s
            ORDER BY s.zone_id, s.measured_at, (s.source = 'yolo') DESC
        ),
        totals AS (
            SELECT z.hall_no, s.measured_at, count(*) AS reported,
                   sum(s.waiting_passenger_count) AS waiting
            FROM snapshots s
            JOIN zones z ON z.zone_id = s.zone_id
            GROUP BY z.hall_no, s.measured_at
        )
        SELECT t.hall_no, count(*) AS points, max(t.waiting) AS max_waiting
        FROM totals t
        JOIN hall_zones h ON h.hall_no = t.hall_no AND h.zone_count = t.reported
        GROUP BY t.hall_no
        """,
        {
            "terminal": terminal.value,
            "sources": settings.data_sources(),
            "since": now_kst() - timedelta(hours=rules.HALL_CHECK_LOOKBACK_HOURS),
        },
    )
    return {row["hall_no"]: row for row in rows}


@ttl_cache(seconds=30)
def get_congestion(terminal: Terminal) -> Congestion:
    rows = _latest(terminal)
    if not rows:
        return Congestion(terminal=terminal, measured_at=now_kst().replace(second=0), halls=[])

    measured_at = max(row["measured_at"] for row in rows)
    target = measured_at - timedelta(minutes=rules.CONGESTION_COMPARE_MINUTES)
    previous = _previous([row["zone_id"] for row in rows], target)
    activity = _hall_activity(terminal)

    by_hall: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_hall[row["hall_no"]].append(row)

    halls = []
    for hall_no in sorted(by_hall):
        zone_rows = by_hall[hall_no]
        count = sum(r["waiting_passenger_count"] for r in zone_rows)
        # 구역 하나라도 30분 전 값이 없으면 비교가 왜곡되므로 null
        past = [previous.get(r["zone_id"]) for r in zone_rows]
        past_total = None if any(p is None for p in past) else sum(past)
        source = (
            DataSource.YOLO
            if any(r["source"] == "yolo" for r in zone_rows)
            else DataSource(zone_rows[0]["source"])
        )
        stats = activity.get(hall_no)
        halls.append(
            Hall(
                hall_id=hall_no,
                hall_name=f"{hall_no}번 출국장",
                waiting_count=count,
                level=rules.congestion_level(count, terminal),
                change_rate=rules.change_rate(count, past_total),
                source=source,
                operation_status=rules.hall_operation_status(
                    stats["points"] if stats else 0,
                    stats["max_waiting"] if stats else None,
                ),
            )
        )
    return Congestion(terminal=terminal, measured_at=measured_at.astimezone(KST), halls=halls)
@ttl_cache(seconds=300)
def get_congestion_hourly(terminal: Terminal) -> CongestionHourly:
    """오늘과 어제의 시간대별 평균 대기 인원. 측정이 없는 시간은 null이다.

    출국장의 모든 구역이 함께 측정된 시각만 쓰고, 출국장별 시간 평균을 더해 터미널 값으로 만든다.
    """
    now = now_kst()
    today = now.date()
    yesterday = today - timedelta(days=1)
    rows = fetch_all(
        f"""
        WITH {_ZONES_CTE},
        hall_zones AS (
            SELECT hall_no, count(*) AS zone_count
            FROM zones
            WHERE hall_no IS NOT NULL
            GROUP BY hall_no
        ),
        snapshots AS (
            SELECT DISTINCT ON (s.zone_id, s.measured_at)
                s.zone_id, s.measured_at, s.waiting_passenger_count
            FROM congestion_snapshots s
            JOIN zones z ON z.zone_id = s.zone_id
            WHERE s.source = ANY(%(sources)s) AND s.measured_at >= %(since)s
            ORDER BY s.zone_id, s.measured_at, (s.source = 'yolo') DESC
        ),
        totals AS (
            SELECT z.hall_no, s.measured_at, count(*) AS reported,
                   sum(s.waiting_passenger_count) AS waiting
            FROM snapshots s
            JOIN zones z ON z.zone_id = s.zone_id
            WHERE z.hall_no IS NOT NULL
            GROUP BY z.hall_no, s.measured_at
        ),
        hall_hours AS (
            SELECT t.hall_no,
                   (t.measured_at AT TIME ZONE 'Asia/Seoul')::date AS day,
                   extract(hour FROM t.measured_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
                   avg(t.waiting) AS waiting
            FROM totals t
            JOIN hall_zones h ON h.hall_no = t.hall_no AND h.zone_count = t.reported
            GROUP BY 1, 2, 3
        )
        SELECT day, hour, sum(waiting) AS total, count(*) AS halls
        FROM hall_hours
        GROUP BY day, hour
        """,
        {
            "terminal": terminal.value,
            "sources": settings.data_sources(),
            "since": now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1),
        },
    )
    values = {(row["day"], row["hour"]): row for row in rows}
    hours = []
    for hour in range(24):
        current = values.get((today, hour))
        previous = values.get((yesterday, hour))
        hours.append(
            CongestionHour(
                hour=hour,
                today=round(current["total"]) if current else None,
                yesterday=round(previous["total"]) if previous else None,
                level=rules.congestion_level(round(current["total"] / current["halls"]), terminal)
                if current
                else None,
            )
        )
    return CongestionHourly(terminal=terminal, date=today.isoformat(), hours=hours)