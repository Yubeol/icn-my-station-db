"""운항 통계 DB 조회. 운항 현황과 같은 오늘 편 목록(코드쉐어 제외)을 집계한다.

- 분류: 결항 → CANCELLED, 회항 → DIVERTED, 지연 상태이거나 지연 기준 이상 늦은 편 → DELAYED, 나머지 → NORMAL.
  이미 출발·도착한 편도 지연 기준 이상 늦었으면 DELAYED로 센다.
- 시간대별 막대는 예정 시각(KST)의 시(hour) 기준.
- changeRate(전일 대비)는 이력 데이터가 쌓이기 전까지 null.
"""

from typing import Any

from app.core import rules
from app.core.timeutil import KST, now_kst
from app.schemas import Breakdown, Direction, FlightStats, FlightStatus, Hourly, StatsCategory
from app.services.db.flights import delay_minutes, fetch_today_rows


def _category(row: dict[str, Any]) -> StatsCategory:
    delay = delay_minutes(row)
    status = rules.resolve_status(row["source_status"], delay)
    if status == FlightStatus.CANCELLED:
        return StatsCategory.CANCELLED
    if status == FlightStatus.DIVERTED:
        return StatsCategory.DIVERTED
    if status == FlightStatus.DELAYED or delay >= rules.DELAY_THRESHOLD_MINUTES:
        return StatsCategory.DELAYED
    return StatsCategory.NORMAL


def get_flight_stats(direction: Direction) -> FlightStats:
    rows = [row for row in fetch_today_rows(direction) if row["scheduled_at"] is not None]
    counts = dict.fromkeys(StatsCategory, 0)
    hourly_total = [0] * 24
    hourly_delayed = [0] * 24

    for row in rows:
        category = _category(row)
        counts[category] += 1
        hour = row["scheduled_at"].astimezone(KST).hour
        hourly_total[hour] += 1
        if category == StatsCategory.DELAYED:
            hourly_delayed[hour] += 1

    total = len(rows)
    return FlightStats(
        date=now_kst().date().isoformat(),
        direction=direction,
        total=total,
        breakdown=[
            Breakdown(
                category=category,
                count=count,
                ratio=round(count / total * 100, 1) if total else 0.0,
                change_rate=None,
            )
            for category, count in counts.items()
        ],
        hourly=[
            Hourly(hour=hour, count=hourly_total[hour], delayed_count=hourly_delayed[hour])
            for hour in range(24)
        ],
    )