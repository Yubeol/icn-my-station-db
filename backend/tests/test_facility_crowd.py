"""편의시설 주변 혼잡 예상 테스트."""

from datetime import timedelta

import pytest

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import (
    Congestion,
    CongestionLevel,
    CrowdBasis,
    DataSource,
    Hall,
    HallOperationStatus,
    Terminal,
)
from app.services.db import facilities as db_facilities

API = "/api/v1"
LOW, MID, HIGH = CongestionLevel.LOW, CongestionLevel.MID, CongestionLevel.HIGH


@pytest.mark.parametrize(
    ("name", "location", "area", "terminal", "basis", "hall"),
    [
        (
            "샤넬",
            "제2여객터미널 3층 면세지역 252번 게이트 부근",
            "D",
            "T2",
            CrowdBasis.FLIGHTS,
            None,
        ),
        ("화장실", "제1여객터미널 3층 동편 9번 탑승구 맞은편", "D", "T1", CrowdBasis.FLIGHTS, None),
        ("BHC", "탑승동 3층 122번 게이트 부근", "D", "CONCOURSE", CrowdBasis.FLIGHTS, None),
        ("약국", "탑승동 3층 중앙부", "D", "CONCOURSE", CrowdBasis.FLIGHTS, None),
        ("환전소", "제1여객터미널 3층 일반지역 2번 출국장 부근", "D", "T1", CrowdBasis.HALL, 2),
        ("화장실", "제1여객터미널 3층 동편 4번출국장 우측", "D", "T1", CrowdBasis.HALL, 4),
        (
            "카페",
            "제1여객터미널 3층 일반지역 H 체크인카운터 부근",
            "D",
            "T1",
            CrowdBasis.TERMINAL,
            None,
        ),
    ],
)
def test_crowd_location(name, location, area, terminal, basis, hall):
    rules.crowd_location.cache_clear()
    assert rules.crowd_location(name, location, area, terminal) == rules.CrowdLocation(basis, hall)


@pytest.mark.parametrize(
    ("name", "location", "area", "terminal"),
    [
        ("약국", "3층 일반지역 H 체크인카운터 부근", "D", None),
        ("AED(T1 F3)", "제1여객터미널 3층 면세지역", "D", "T1"),
        ("공항버스 승차장 29", "제2여객터미널", "D", "T2"),
        ("커피", "제1여객터미널 교통센터 지하 1층 중앙", "D", "T1"),
        ("AED(T2 F2)", "제2여객터미널 2층 서측 입국심사장", "A", "T2"),
        ("식당", "제1여객터미널 3층 일반지역 A입국장 부근", "D", "T1"),
        ("한진택배", "제2여객터미널 1층 서편 끝 1번 게이트 부근", "D", "T2"),
        ("공차", "제1여객터미널 1층 일반지역 6번 출입구 부근", "D", "T1"),
        ("니맛", "제1여객터미널 4층 동편", "D", "T1"),
        ("카페", "제2여객터미널", "D", "T2"),
    ],
)
def test_crowd_location_without_evidence(name, location, area, terminal):
    assert rules.crowd_location(name, location, area, terminal) is None


def test_forecast_slots():
    assert rules.crowd_forecast_slots(7) == ("07_08", "08_09")
    assert rules.crowd_forecast_slots(22) == ("22_23", "23_00")
    assert rules.crowd_forecast_slots(23) == ("23_00", None)


@pytest.mark.parametrize(
    ("current", "upcoming", "peak", "expected"),
    [
        (100, 100, 1000, LOW),
        (399, None, 1000, LOW),
        (400, None, 1000, MID),
        (100, 700, 1000, HIGH),
        (235, 0, 335, HIGH),
        (None, 500, 1000, None),
        (0, 0, 0, None),
    ],
)
def test_forecast_level(current, upcoming, peak, expected):
    assert rules.forecast_crowd_level(current, upcoming, peak) == expected


@pytest.mark.parametrize(
    ("flights", "terminal", "expected"),
    [
        (0, "T1", None),
        (13, "T1", LOW),
        (14, "T1", MID),
        (22, "T1", HIGH),
        (19, "CONCOURSE", HIGH),
        (27, "T2", LOW),
        (28, "T2", MID),
        (42, "T2", HIGH),
    ],
)
def test_flight_level(flights, terminal, expected):
    assert rules.flight_crowd_level(flights, terminal) == expected


def test_hall_level_uses_higher_input():
    assert rules.hall_crowd_level(LOW, HIGH, None) == HIGH
    assert rules.hall_crowd_level(MID, None, None) == MID
    assert rules.hall_crowd_level(None, LOW, None) == LOW
    assert rules.hall_crowd_level(None, None, None) is None


def test_hall_level_skips_hall_needing_check():
    assert rules.hall_crowd_level(LOW, LOW, HallOperationStatus.CHECK_REQUIRED) is None


@pytest.mark.parametrize(
    ("levels", "expected"),
    [
        ([LOW, HIGH], MID),
        ([LOW, MID], MID),
        ([MID, HIGH], HIGH),
        ([LOW, LOW, MID], LOW),
        ([None, HIGH], HIGH),
        ([None], None),
        ([], None),
    ],
)
def test_terminal_level(levels, expected):
    assert rules.terminal_crowd_level(levels) == expected


def test_facility_crowd_by_basis():
    halls = {2: HIGH, 3: LOW, 4: None}
    hall = rules.CrowdLocation(CrowdBasis.HALL, 2)
    terminal = rules.CrowdLocation(CrowdBasis.TERMINAL)
    flights = rules.CrowdLocation(CrowdBasis.FLIGHTS)

    assert rules.facility_crowd(hall, True, "T1", halls, 0) == (HIGH, CrowdBasis.HALL)
    assert rules.facility_crowd(terminal, None, "T1", halls, 0) == (MID, CrowdBasis.TERMINAL)
    assert rules.facility_crowd(flights, True, "T1", {}, 22) == (HIGH, CrowdBasis.FLIGHTS)


def test_facility_crowd_returns_null_pair():
    hall = rules.CrowdLocation(CrowdBasis.HALL, 4)
    flights = rules.CrowdLocation(CrowdBasis.FLIGHTS)

    assert rules.facility_crowd(None, True, "T1", {}, 30) == (None, None)
    assert rules.facility_crowd(flights, False, "T1", {}, 30) == (None, None)
    assert rules.facility_crowd(flights, True, "T1", {}, 0) == (None, None)
    assert rules.facility_crowd(hall, True, "T1", {4: None}, 0) == (None, None)
    assert rules.facility_crowd(hall, True, "T1", {}, 0) == (None, None)


def _hall(hall_id: int, level: CongestionLevel, status=None) -> Hall:
    return Hall(
        hall_id=hall_id,
        hall_name=f"{hall_id}번 출국장",
        waiting_count=0,
        level=level,
        change_rate=None,
        source=DataSource.API,
        operation_status=status,
    )


def test_hall_levels_ignore_stale_congestion_and_other_terminal(monkeypatch):
    now = now_kst()
    slot, _ = rules.crowd_forecast_slots(now.hour)
    congestion = Congestion(
        terminal=Terminal.T1,
        measured_at=now - timedelta(minutes=rules.CROWD_CONGESTION_MAX_AGE_MINUTES + 1),
        halls=[_hall(2, HIGH), _hall(3, HIGH)],
    )
    monkeypatch.setattr(db_facilities, "get_congestion", lambda terminal: congestion)
    monkeypatch.setattr(
        db_facilities,
        "_hall_forecasts",
        lambda target_date: {("T1", 2): {slot: 100, "peak": 1000}, ("T2", 3): {slot: 1000}},
    )

    assert db_facilities._hall_levels(Terminal.T1) == {2: LOW, 3: None}


def test_mock_facilities_include_crowd_fields(client):
    facilities = client.get(f"{API}/facilities").json()
    by_id = {item["facilityId"]: item for item in facilities}

    assert by_id["f4"]["crowdEstimate"] == "HIGH"
    assert by_id["f4"]["crowdBasis"] == "FLIGHTS"
    assert by_id["f1"]["crowdEstimate"] is None
    assert by_id["f1"]["crowdBasis"] is None