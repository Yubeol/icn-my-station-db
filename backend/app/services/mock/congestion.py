"""출국장 혼잡도 mock. 출국장 범위는 데이터에서 정해지며 코드에 고정하지 않는다."""

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import Congestion, CongestionHour, CongestionHourly, DataSource, Hall, Terminal

# 터미널별 (hall_id, 대기 인원, 30분 전 대비 %)
_MOCK_HALLS: dict[Terminal, list[tuple[int, int, float | None]]] = {
    Terminal.T1: [
        (1, 120, -5.0),
        (2, 510, 28.0),
        (3, 330, 4.5),
        (4, 260, None),
        (5, 90, -12.0),
        (6, 180, 0.0),
    ],
    Terminal.T2: [
        (1, 2100, 15.0),
        (2, 900, -3.5),
    ],
}


def get_congestion(terminal: Terminal) -> Congestion:
    measured_at = now_kst().replace(second=0)
    halls = [
        Hall(
            hall_id=hall_id,
            hall_name=f"{hall_id}번 출국장",
            waiting_count=count,
            level=rules.congestion_level(count, terminal),
            change_rate=change_rate,
            source=DataSource.DEMO,
        )
        for hall_id, count, change_rate in _MOCK_HALLS[terminal]
    ]
    return Congestion(terminal=terminal, measured_at=measured_at, halls=halls)


# 시간대별 터미널 평균 대기 인원 비율. 새벽에 낮고 오전·저녁에 높은 임의 곡선이다.
_HOURLY_SHAPE = [
    0.15, 0.1, 0.1, 0.15, 0.3, 0.55, 0.8, 1.0, 0.95, 0.8, 0.7, 0.65,
    0.6, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.75, 0.6, 0.45, 0.3, 0.2,
]
_HOURLY_PEAK_PER_HALL = {Terminal.T1: 420, Terminal.T2: 1900}


def get_congestion_hourly(terminal: Terminal) -> CongestionHourly:
    now = now_kst()
    hall_count = len(_MOCK_HALLS[terminal])
    hours = []
    for hour, ratio in enumerate(_HOURLY_SHAPE):
        per_hall = round(_HOURLY_PEAK_PER_HALL[terminal] * ratio)
        passed = hour <= now.hour
        hours.append(
            CongestionHour(
                hour=hour,
                today=per_hall * hall_count if passed else None,
                yesterday=round(per_hall * 0.9) * hall_count,
                level=rules.congestion_level(per_hall, terminal) if passed else None,
            )
        )
    return CongestionHourly(terminal=terminal, date=now.date().isoformat(), hours=hours)