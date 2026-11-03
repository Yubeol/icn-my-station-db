"""터미널별 혼잡 단계 기준 테스트."""

from datetime import datetime, timedelta

import pytest

from app.core import rules
from app.core.timeutil import KST
from app.schemas import CongestionLevel, Terminal
from app.services.alert_events import HallState, Measure, congestion_events

NOW = datetime(2026, 11, 3, 17, 0, tzinfo=KST)


@pytest.mark.parametrize(
    ("terminal", "count", "expected"),
    [
        (Terminal.T1, 199, CongestionLevel.LOW),
        (Terminal.T1, 200, CongestionLevel.MID),
        (Terminal.T1, 399, CongestionLevel.MID),
        (Terminal.T1, 400, CongestionLevel.HIGH),
        (Terminal.T2, 799, CongestionLevel.LOW),
        (Terminal.T2, 800, CongestionLevel.MID),
        (Terminal.T2, 1999, CongestionLevel.MID),
        (Terminal.T2, 2000, CongestionLevel.HIGH),
    ],
)
def test_congestion_level_by_terminal(terminal, count, expected):
    assert rules.congestion_level(count, terminal) == expected


def t2_hall(current: int, previous: int) -> HallState:
    return HallState(
        zone_id=8,
        terminal="T2",
        hall_no=1,
        source="api",
        current=Measure(current, NOW),
        previous=Measure(previous, NOW - timedelta(minutes=4)),
        past30=None,
    )


def test_t2_uses_t2_threshold_for_enter_alert():
    assert congestion_events(t2_hall(current=1000, previous=700)) == []

    rows = congestion_events(t2_hall(current=2100, previous=1900))
    assert len(rows) == 1
    assert rows[0]["previous_value"]["level"] == "MID"
    assert rows[0]["current_value"]["level"] == "HIGH"