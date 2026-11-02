"""운항 통계 mock. 편수는 코드쉐어를 제외한 마스터 편 기준이다."""

from app.core.timeutil import now_kst
from app.schemas import Breakdown, Direction, FlightStats, Hourly, StatsCategory

# 0~23시 시간대별 운항 편수
_HOURLY_COUNTS: dict[Direction, list[int]] = {
    Direction.DEPARTURE: [
        8,
        4,
        2,
        1,
        2,
        6,
        18,
        32,
        40,
        38,
        36,
        34,
        30,
        32,
        34,
        38,
        40,
        36,
        32,
        28,
        24,
        18,
        14,
        10,
    ],
    Direction.ARRIVAL: [
        10,
        6,
        4,
        3,
        4,
        8,
        20,
        30,
        36,
        34,
        32,
        30,
        28,
        30,
        32,
        34,
        36,
        34,
        30,
        26,
        22,
        18,
        14,
        12,
    ],
}

_DELAYED_RATIO = 0.15
_CANCELLED_RATIO = 0.02
_BREAKDOWN_CHANGE_RATES: dict[StatsCategory, float | None] = {
    StatsCategory.NORMAL: -2.0,
    StatsCategory.DELAYED: 20.0,
    StatsCategory.CANCELLED: None,
    StatsCategory.DIVERTED: None,
}


def get_flight_stats(direction: Direction) -> FlightStats:
    counts = _HOURLY_COUNTS[direction]
    total = sum(counts)
    delayed = round(total * _DELAYED_RATIO)
    cancelled = round(total * _CANCELLED_RATIO)
    diverted = 1
    category_counts = {
        StatsCategory.NORMAL: total - delayed - cancelled - diverted,
        StatsCategory.DELAYED: delayed,
        StatsCategory.CANCELLED: cancelled,
        StatsCategory.DIVERTED: diverted,
    }
    return FlightStats(
        date=now_kst().date().isoformat(),
        direction=direction,
        total=total,
        breakdown=[
            Breakdown(
                category=category,
                count=count,
                ratio=round(count / total * 100, 1),
                change_rate=_BREAKDOWN_CHANGE_RATES[category],
            )
            for category, count in category_counts.items()
        ],
        hourly=[
            Hourly(hour=hour, count=count, delayed_count=round(count * _DELAYED_RATIO))
            for hour, count in enumerate(counts)
        ],
    )
