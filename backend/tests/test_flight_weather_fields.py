"""항공사·국가 코드, 돌풍, METAR 이력 테스트."""

from datetime import datetime

import pytest

from app.core import rules
from tests.contract import load_contract_fields

API = "/api/v1"
CONTRACT = load_contract_fields()


@pytest.mark.parametrize(
    ("code", "flight_no", "expected"),
    [
        ("ke", "KE703", "KE"),
        (None, "KE703", "KE"),
        ("", "7C1101", "7C"),
        (None, "TW202", "TW"),
        (None, "", None),
        (None, None, None),
    ],
)
def test_airline_code(code, flight_no, expected):
    assert rules.airline_code(code, flight_no) == expected


@pytest.mark.parametrize(
    ("airport", "expected"),
    [("NRT", "JP"), ("sea", "US"), ("CDG", "FR"), ("ZZZZ", None), ("", None), (None, None)],
)
def test_country_code(airport, expected):
    assert rules.country_code(airport) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("http://codes.wmo.int/306/4678/-RA", "-RA"), ("BR", "BR"), ("", None), (None, None)],
)
def test_weather_phenomenon(raw, expected):
    assert rules.weather_phenomenon(raw) == expected


def test_flights_include_airline_and_country(client):
    flights = client.get(f"{API}/flights", params={"type": "DEPARTURE"}).json()
    first = next(f for f in flights if f["flightNo"] == "KE703")
    assert first["airlineCode"] == "KE"
    assert first["countryCode"] == "JP"


def test_weather_includes_gust(client):
    assert client.get(f"{API}/weather").json()["windGust"] == 12.0


def test_weather_history_contract_and_order(client):
    points = client.get(f"{API}/weather/history").json()
    assert points
    assert set(points[0]) == CONTRACT["WeatherHistoryPoint"]
    times = [datetime.fromisoformat(p["observedAt"]) for p in points]
    assert times == sorted(times)
    assert all(t.utcoffset().total_seconds() == 9 * 3600 for t in times)


@pytest.mark.parametrize(("hours", "status"), [(1, 200), (48, 200), (0, 422), (49, 422)])
def test_weather_history_hours_range(client, hours, status):
    assert client.get(f"{API}/weather/history", params={"hours": hours}).status_code == status


def test_weather_history_includes_visibility_and_pressure(client):
    point = client.get(f"{API}/weather/history").json()[0]
    assert point["visibility"] > 0
    assert point["pressure"] > 0
