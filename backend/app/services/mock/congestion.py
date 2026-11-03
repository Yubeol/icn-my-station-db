"""출국장 혼잡도 mock. 출국장 범위는 데이터에서 정해지며 코드에 고정하지 않는다."""

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import Congestion, DataSource, Hall, Terminal

# 터미널별 (hall_id, 대기 인원, 전일 대비 %)
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
        (1, 430, 15.0),
        (2, 210, -3.5),
    ],
}


def get_congestion(terminal: Terminal) -> Congestion:
    measured_at = now_kst().replace(second=0)
    halls = [
        Hall(
            hall_id=hall_id,
            hall_name=f"{hall_id}번 출국장",
            waiting_count=count,
            level=rules.congestion_level(count),
            change_rate=change_rate,
            source=DataSource.DEMO,
        )
        for hall_id, count, change_rate in _MOCK_HALLS[terminal]
    ]
    return Congestion(terminal=terminal, measured_at=measured_at, halls=halls)
