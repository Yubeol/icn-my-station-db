"""알림 terminal 채우기 테스트: 혼잡은 구역 기준, 지연·게이트 변경·탑승은 항공편 기준. DB에 접속하지 않는다."""

from datetime import datetime, timedelta

import pytest

from app.core import rules
from app.core.timeutil import KST
from app.schemas import Terminal
from app.services.db import alerts as db_alerts

NOW = datetime(2026, 11, 8, 21, 0, tzinfo=KST)


@pytest.mark.parametrize(
    ("alert_type", "zone", "flight", "expected"),
    [
        ("congestion", "T1", None, Terminal.T1),
        ("congestion", "T2", "T1", Terminal.T2),  # 혼잡은 항공편이 아니라 구역 기준
        ("gate_change", None, "T2", Terminal.T2),
        ("delay", "T1", "T2", Terminal.T2),  # 항공편 알림은 구역이 아니라 항공편 기준
        ("delay", None, "CONCOURSE", Terminal.T1),  # 탑승동은 T1
        ("delay", None, None, None),  # 특정할 수 없으면 공통
        ("boarding", None, "T2", Terminal.T2),
    ],
)
def test_alert_terminal(alert_type, zone, flight, expected):
    assert rules.alert_terminal(alert_type, zone, flight) == expected


def stored_row(alert_id: int, alert_type: str, zone: str | None, flight: str | None) -> dict:
    return {
        "alert_id": alert_id,
        "alert_type": alert_type,
        "severity": "important",
        "title": "제목",
        "message": "내용",
        "created_at": NOW,
        "flight_number": "LJ045" if alert_type != "congestion" else None,
        "master_flight_number": None,
        "terminal_code": zone,
        "flight_terminal_code": flight,
    }


def test_stored_alerts_fill_terminal_by_type(monkeypatch):
    rows = [
        stored_row(1, "congestion", "T1", None),
        stored_row(2, "gate_change", None, "T2"),  # LJ045 게이트 243 -> T2
        stored_row(3, "delay", None, "CONCOURSE"),
        stored_row(4, "delay", None, None),
    ]
    monkeypatch.setattr(db_alerts, "_stored_rows", lambda: rows)

    terminals = {a.alert_id: a.terminal for a in db_alerts._stored(set())}

    assert terminals == {"db-1": Terminal.T1, "db-2": Terminal.T2, "db-3": Terminal.T1, "db-4": None}


def test_terminal_filter_now_applies_to_flight_alerts(monkeypatch):
    rows = [stored_row(2, "gate_change", None, "T2"), stored_row(3, "delay", None, "T1"), stored_row(4, "delay", None, None)]
    monkeypatch.setattr(db_alerts, "_stored_rows", lambda: rows)

    alerts = rules.filter_alert_terminal(db_alerts._stored(set()), Terminal.T2)

    # T2를 지정하면 T1 항공편 알림은 빠지고, 터미널을 모르는 공통 알림은 남는다.
    assert {a.alert_id for a in alerts} == {"db-2", "db-4"}


def test_boarding_alert_gets_flight_terminal(monkeypatch):
    row = {
        "flight_number": "LJ045",
        "scheduled_at": NOW + timedelta(minutes=20),
        "source_status": "탑승중",
        "gate": "243",
        "terminal_code": "T2",
        "last_collected_at": NOW - timedelta(minutes=3),
    }
    monkeypatch.setattr(db_alerts, "now_kst", lambda: NOW)
    monkeypatch.setattr(db_alerts, "fetch_today_rows", lambda direction: [row])

    alerts = db_alerts._boarding(set())

    assert [a.terminal for a in alerts] == [Terminal.T2]


def test_mock_flight_alerts_follow_flight_terminal(client):
    """mock 모드도 DB 모드와 같은 규칙: 항공편 알림의 terminal은 그 항공편의 터미널이다."""
    alerts = client.get("/api/v1/alerts").json()
    flight_alerts = [a for a in alerts if a["flightNo"]]
    assert flight_alerts
    for alert in flight_alerts:
        flight = client.get(f"/api/v1/flights/{alert['flightNo']}").json()
        assert alert["terminal"] == flight["terminal"]
    assert {a["alertId"]: a["terminal"] for a in alerts if a["type"] in ("CONGESTION", "WEATHER")} == {
        "a4": "T1",
        "a5": None,
    }
