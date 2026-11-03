"""스마트 알림 판단 로직과 smart_alerts 쓰기 형식 검사 (docs/db-write-contract.md). DB에 접속하지 않는다."""

from datetime import datetime, timedelta

import pytest
from psycopg.types.json import Jsonb

from app.core import db_write
from app.core.timeutil import KST
from app.schemas import FlightStatus
from app.services.alert_events import (
    FlightState,
    HallState,
    Measure,
    congestion_events,
    flight_events,
)

NOW = datetime(2026, 11, 2, 18, 47, tzinfo=KST)
COLUMNS = set(db_write._COLUMNS)


def hall(current: int, previous: int | None = None, past30: int | None = None) -> HallState:
    return HallState(
        zone_id=7,
        terminal="T1",
        hall_no=2,
        source="api",
        current=Measure(current, NOW),
        previous=Measure(previous, NOW - timedelta(minutes=2)) if previous is not None else None,
        past30=Measure(past30, NOW - timedelta(minutes=30)) if past30 is not None else None,
    )


def flight(**kw) -> FlightState:
    base = {
        "flight_uid": 11,
        "source": "api",
        "flight_number": "KE703",
        "departure": True,
        "gate": "12",
        "delay_minutes": 0,
        "estimated_at": None,
        "source_status": "탑승준비",
        "status": FlightStatus.BOARDING_SOON,
    }
    base.update(kw)
    return FlightState(**base)


def assert_contract_row(row: dict):
    assert set(row) == COLUMNS
    assert row["alert_type"] in {"congestion", "delay", "gate_change"}
    assert row["severity"] in {"info", "important", "critical"}
    assert row["source"] in {"api", "yolo", "demo"}
    assert row["dedupe_key"].startswith(row["alert_type"] + ":")
    if row["alert_type"] == "congestion":
        assert row["zone_id"] is not None and row["flight_uid"] is None and row["unit"] == "명"
    else:
        assert row["flight_uid"] is not None and row["zone_id"] is None


# ---------- 혼잡 ----------


def test_congestion_enter_once_when_level_becomes_high():
    rows = congestion_events(hall(current=520, previous=350))
    assert [r["dedupe_key"] for r in rows] == ["congestion:7:enter:2026-11-02T18:30"]
    row = rows[0]
    assert_contract_row(row)
    assert row["previous_value"] == {
        "waiting_count": 350,
        "level": "MID",
        "measured_at": "2026-11-02T18:45:00+09:00",
    }
    assert row["current_value"]["level"] == "HIGH"


def test_no_enter_when_already_high_or_no_previous():
    assert congestion_events(hall(current=520, previous=450)) == []
    assert congestion_events(hall(current=520)) == []


@pytest.mark.parametrize(
    ("current", "past30", "expected"),
    [
        (260, 150, True),  # +110명, +73%
        (180, 100, False),  # +80%지만 80명 증가
        (900, 750, False),  # +150명이지만 20%
    ],
)
def test_surge_needs_rate_and_increase(current, past30, expected):
    rows = congestion_events(hall(current=current, previous=current, past30=past30))
    surge = [r for r in rows if ":surge:" in r["dedupe_key"]]
    assert bool(surge) is expected
    for row in surge:
        assert_contract_row(row)
        assert row["previous_value"]["waiting_count"] == past30


# ---------- 항공편 ----------


def test_delay_alert_and_bucket_key():
    rows = flight_events(flight(delay_minutes=25, status=FlightStatus.DELAYED), None)
    assert [r["dedupe_key"] for r in rows] == ["delay:11:15"]
    assert rows[0]["severity"] == "important"
    assert rows[0]["previous_value"] == {"delay_minutes": 0, "estimated_at": None}
    assert_contract_row(rows[0])
    # 지연이 40분으로 늘면 새 키, 60분 이상이면 critical
    assert flight_events(flight(delay_minutes=40), None)[0]["dedupe_key"] == "delay:11:30"
    assert flight_events(flight(delay_minutes=75), None)[0]["severity"] == "critical"


def test_no_delay_alert_under_threshold_or_after_departure():
    assert flight_events(flight(delay_minutes=10), None) == []
    assert flight_events(flight(delay_minutes=40, status=FlightStatus.DEPARTED), None) == []


def test_cancelled_alert():
    prev = flight()
    rows = flight_events(
        flight(source_status="결항", status=FlightStatus.CANCELLED, delay_minutes=30), prev
    )
    assert [r["dedupe_key"] for r in rows] == ["delay:11:cancelled"]
    assert rows[0]["severity"] == "critical"
    assert rows[0]["previous_value"] == {"source_status": "탑승준비"}
    assert_contract_row(rows[0])


def test_gate_change_only_when_both_gates_known():
    rows = flight_events(flight(gate="23"), flight(gate="12"))
    assert [r["dedupe_key"] for r in rows] == ["gate_change:11:12->23"]
    assert rows[0]["previous_value"] == {"gate": "12"} and rows[0]["current_value"] == {
        "gate": "23"
    }
    assert_contract_row(rows[0])
    assert flight_events(flight(gate="23"), flight(gate=None)) == []  # 첫 배정
    assert flight_events(flight(gate="23"), None) == []  # 이전 상태 모름


def test_flight_alert_source_follows_flight():
    rows = flight_events(flight(source="demo", delay_minutes=20), None)
    assert rows[0]["source"] == "demo"


# ---------- 쓰기 모듈 ----------


def test_write_sql_is_fixed_to_smart_alerts_insert():
    sql = " ".join(db_write.INSERT_ALERT_SQL.split()).upper()
    assert sql.startswith("INSERT INTO SMART_ALERTS")
    assert sql.endswith("ON CONFLICT (DEDUPE_KEY, SOURCE) DO NOTHING")
    for word in ("UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER"):
        assert word not in sql


def test_write_params_wrap_json_and_require_all_columns():
    row = flight_events(flight(delay_minutes=20), None)[0]
    params = db_write._params(row)
    assert isinstance(params["current_value"], Jsonb)
    row.pop("unit")
    with pytest.raises(ValueError):
        db_write._params(row)