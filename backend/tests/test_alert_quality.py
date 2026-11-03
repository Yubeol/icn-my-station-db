"""알림 신선도, 혼잡 알림 재알림 방지, 출국장 운영 확인 표시 테스트."""

from datetime import datetime, timedelta

import pytest

from app.core import rules
from app.core.timeutil import KST
from app.schemas import HallOperationStatus
from app.services.alert_events import drop_recent_congestion
from app.services.db import alerts as db_alerts

NOW = datetime(2026, 11, 3, 18, 0, tzinfo=KST)


@pytest.mark.parametrize(
    ("points", "max_waiting", "expected"),
    [
        (386, 4, HallOperationStatus.CHECK_REQUIRED),
        (386, 10, HallOperationStatus.CHECK_REQUIRED),
        (386, 11, None),
        (99, 0, None),
        (0, None, None),
    ],
)
def test_hall_operation_status(points, max_waiting, expected):
    assert rules.hall_operation_status(points, max_waiting) == expected


@pytest.mark.parametrize(("age", "expected"), [(0, True), (15, True), (16, False)])
def test_is_fresh(age, expected):
    assert rules.is_fresh(NOW - timedelta(minutes=age), NOW) is expected


def test_is_fresh_without_collection_time():
    assert rules.is_fresh(None, NOW) is False


def row(key: str, alert_type: str = "congestion") -> dict:
    return {"alert_type": alert_type, "dedupe_key": key}


def test_drop_recent_congestion_across_bucket_boundary():
    rows = [
        row("congestion:8:surge:2026-11-03T17:30"),
        row("congestion:8:enter:2026-11-03T17:30"),
        row("congestion:7:surge:2026-11-03T17:30"),
        row("delay:1:30", "delay"),
    ]
    kept = drop_recent_congestion(rows, ["congestion:8:surge:2026-11-03T17:00"])
    assert [r["dedupe_key"] for r in kept] == [
        "congestion:8:enter:2026-11-03T17:30",
        "congestion:7:surge:2026-11-03T17:30",
        "delay:1:30",
    ]


def boarding_row(number: str, collected_age: int | None) -> dict:
    collected = None if collected_age is None else NOW - timedelta(minutes=collected_age)
    return {
        "flight_number": number,
        "scheduled_at": NOW + timedelta(minutes=20),
        "source_status": "탑승중",
        "gate": "12",
        "last_collected_at": collected,
    }


def test_boarding_alert_uses_only_fresh_flights(monkeypatch):
    rows = [boarding_row("KE1", 5), boarding_row("KE2", 40), boarding_row("KE3", None)]
    monkeypatch.setattr(db_alerts, "now_kst", lambda: NOW)
    monkeypatch.setattr(db_alerts, "fetch_today_rows", lambda direction: rows)

    alerts = db_alerts._boarding(set())

    assert [a.flight_no for a in alerts] == ["KE1"]
    assert alerts[0].created_at == NOW - timedelta(minutes=5)
