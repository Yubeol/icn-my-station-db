"""응답 키가 docs/api-contract.md와 같은지 확인한다."""

from datetime import datetime

import pytest

from tests.contract import load_contract_fields, response_paths

CONTRACT = load_contract_fields()
API = "/api/v1"


def assert_matches(model: str, data: dict) -> None:
    documented = CONTRACT[model]
    assert response_paths(data, documented) == documented, model


def assert_kst(value: str) -> None:
    assert datetime.fromisoformat(value).utcoffset().total_seconds() == 9 * 3600


def test_contract_parser_found_all_models():
    expected = {
        "DashboardSummary",
        "Flight",
        "Congestion",
        "Hall",
        "FlightStats",
        "Breakdown",
        "Hourly",
        "Alert",
        "Weather",
        "Facility",
    }
    assert expected <= CONTRACT.keys()


def test_summary(client):
    body = client.get(f"{API}/dashboard/summary").json()
    assert_matches("DashboardSummary", body)
    assert body["myFlightNo"] is None
    assert len(body["flights"]["departures"]) <= 6
    assert len(body["flights"]["arrivals"]) <= 6
    assert_matches("Flight", body["flights"]["departures"][0])
    assert_matches("Congestion", body["congestion"]["T1"])
    assert_matches("FlightStats", body["stats"]["departure"])
    assert_matches("Alert", body["alerts"][0])
    assert_matches("Weather", body["weather"])
    assert_matches("Facility", body["facilities"][0])
    assert_kst(body["generatedAt"])


def test_summary_with_flight_no(client):
    body = client.get(f"{API}/dashboard/summary", params={"flightNo": "ke703"}).json()
    assert body["myFlightNo"] == "KE703"
    mine = [f for f in body["flights"]["departures"] if f["isMyFlight"]]
    assert [f["flightNo"] for f in mine] == ["KE703"]


@pytest.mark.parametrize("kind", ["DEPARTURE", "ARRIVAL"])
def test_flights(client, kind):
    flights = client.get(f"{API}/flights", params={"type": kind}).json()
    assert flights
    for flight in flights:
        assert_matches("Flight", flight)
        assert flight["type"] == kind
        assert_kst(flight["scheduledAt"])
        assert not flight["isMyFlight"]


def test_flights_my_flight_and_delay_rule(client):
    flights = client.get(f"{API}/flights", params={"type": "DEPARTURE", "flightNo": "KE671"}).json()
    mine = [f for f in flights if f["isMyFlight"]]
    assert [f["flightNo"] for f in mine] == ["KE671"]
    assert mine[0]["status"] == "DELAYED"
    assert mine[0]["delayMinutes"] >= 15
    assert mine[0]["estimatedAt"] is not None


def test_unknown_flight_no_is_200_without_highlight(client):
    flights = client.get(f"{API}/flights", params={"type": "DEPARTURE", "flightNo": "ZZ0000"})
    assert flights.status_code == 200
    assert not any(f["isMyFlight"] for f in flights.json())

    alerts = client.get(f"{API}/alerts", params={"flightNo": "ZZ0000"})
    assert alerts.status_code == 200
    assert not any(a["isMine"] for a in alerts.json())

    summary = client.get(f"{API}/dashboard/summary", params={"flightNo": "ZZ0000"})
    assert summary.status_code == 200
    body = summary.json()
    assert body["myFlightNo"] is None
    assert not any(f["isMyFlight"] for f in body["flights"]["departures"])
    assert not any(a["isMine"] for a in body["alerts"])


def test_flight_detail(client):
    response = client.get(f"{API}/flights/ke671")
    assert response.status_code == 200
    body = response.json()
    assert_matches("Flight", body)
    assert body["flightNo"] == "KE671"
    assert body["isMyFlight"] is True
    assert body["status"] == "DELAYED"


def test_flight_detail_unknown_is_404(client):
    response = client.get(f"{API}/flights/ZZ0000")
    assert response.status_code == 404
    assert set(response.json()) == {"detail"}


def test_invalid_enum_is_422(client):
    assert client.get(f"{API}/flights", params={"type": "SIDEWAYS"}).status_code == 422
    assert client.get(f"{API}/congestion", params={"terminal": "T3"}).status_code == 422
    assert client.get(f"{API}/congestion").status_code == 422


@pytest.mark.parametrize(("terminal", "hall_ids"), [("T1", range(1, 7)), ("T2", range(1, 3))])
def test_congestion(client, terminal, hall_ids):
    body = client.get(f"{API}/congestion", params={"terminal": terminal}).json()
    assert_matches("Congestion", body)
    assert body["terminal"] == terminal
    assert [h["hallId"] for h in body["halls"]] == list(hall_ids)
    for hall in body["halls"]:
        assert_matches("Hall", hall)
        assert hall["level"] in {"LOW", "MID", "HIGH"}
        assert hall["source"] == "demo"
    assert_kst(body["measuredAt"])


@pytest.mark.parametrize("direction", ["DEPARTURE", "ARRIVAL"])
def test_stats(client, direction):
    body = client.get(f"{API}/stats/flights", params={"direction": direction}).json()
    assert_matches("FlightStats", body)
    assert body["direction"] == direction
    for item in body["breakdown"]:
        assert_matches("Breakdown", item)
    assert {b["category"] for b in body["breakdown"]} == {
        "NORMAL",
        "DELAYED",
        "CANCELLED",
        "DIVERTED",
    }
    assert sum(b["count"] for b in body["breakdown"]) == body["total"]
    assert [h["hour"] for h in body["hourly"]] == list(range(24))
    for item in body["hourly"]:
        assert_matches("Hourly", item)
    assert sum(h["count"] for h in body["hourly"]) == body["total"]


def test_alerts(client):
    alerts = client.get(f"{API}/alerts", params={"flightNo": "KE671"}).json()
    assert alerts
    for alert in alerts:
        assert_matches("Alert", alert)
        assert_kst(alert["createdAt"])
    assert {a["alertId"] for a in alerts if a["isMine"]} == {"a1"}
    assert not any(a["isMine"] for a in client.get(f"{API}/alerts").json())


def test_weather(client):
    body = client.get(f"{API}/weather").json()
    assert_matches("Weather", body)
    assert_kst(body["observedAt"])
    assert 0 <= body["operationScore"]["score"] <= 100


def test_facilities(client):
    facilities = client.get(f"{API}/facilities").json()
    assert facilities
    for facility in facilities:
        assert_matches("Facility", facility)
    assert any(f["isOpen"] is None for f in facilities)
    assert all(f["isOpen"] for f in facilities if f["is24h"])


def test_websocket_messages(client):
    with client.websocket_connect("/ws/live") as ws:
        messages = [ws.receive_json() for _ in range(8)]
    for message in messages:
        assert set(message) == CONTRACT["WebSocket"]
        assert_kst(message["sentAt"])
    topics = [m["topic"] for m in messages]
    assert set(topics) == {"congestion", "flights", "stats", "alerts", "weather"}
    scopes = {(m["topic"], m["scope"]) for m in messages}
    assert scopes == {
        ("congestion", "T1"),
        ("congestion", "T2"),
        ("flights", "DEPARTURE"),
        ("flights", "ARRIVAL"),
        ("stats", "DEPARTURE"),
        ("stats", "ARRIVAL"),
        ("alerts", None),
        ("weather", None),
    }
    congestion = {m["scope"]: m["data"] for m in messages if m["topic"] == "congestion"}
    assert all(scope == data["terminal"] for scope, data in congestion.items())
    for data in congestion.values():
        assert_matches("Congestion", data)
    for message in messages:
        if message["topic"] == "flights":
            assert_matches("Flight", message["data"][0])
        elif message["topic"] == "stats":
            assert_matches("FlightStats", message["data"])
        elif message["topic"] == "alerts":
            assert_matches("Alert", message["data"][0])
        elif message["topic"] == "weather":
            assert_matches("Weather", message["data"])


def test_openapi_has_all_rest_paths(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert set(paths) == {
        f"{API}/dashboard/summary",
        f"{API}/flights",
        f"{API}/flights/{{flightNo}}",
        f"{API}/congestion",
        f"{API}/stats/flights",
        f"{API}/alerts",
        f"{API}/weather",
        f"{API}/facilities",
    }
