"""T1/T2 탭용 terminal 필터 테스트 (mock 모드)."""

API = "/api/v1"


def test_summary_terminal_t2(client):
    data = client.get(f"{API}/dashboard/summary", params={"terminal": "T2"}).json()
    flights = data["flights"]["departures"] + data["flights"]["arrivals"]
    assert flights and all(f["terminal"] == "T2" for f in flights)
    assert data["facilities"] and all(f["terminal"] == "T2" for f in data["facilities"])
    assert all(a["terminal"] in ("T2", None) for a in data["alerts"])
    assert "a4" not in {a["alertId"] for a in data["alerts"]}
    # 혼잡도는 터미널과 상관없이 T1·T2 모두
    assert set(data["congestion"]) == {"T1", "T2"}


def test_summary_filters_before_limit(client):
    """거른 다음에 자른다: T2 출발편이 6건 미만이 아니라 T2 전체에서 채워져야 한다."""
    t2 = client.get(f"{API}/dashboard/summary", params={"terminal": "T2"}).json()
    all_t2 = [
        f
        for f in client.get(f"{API}/flights", params={"type": "DEPARTURE", "terminal": "T2"}).json()
    ]
    assert len(t2["flights"]["departures"]) == min(6, len(all_t2))


def test_flights_terminal_t1(client):
    items = client.get(f"{API}/flights", params={"type": "DEPARTURE", "terminal": "T1"}).json()
    assert items and all(f["terminal"] == "T1" for f in items)


def test_alerts_terminal_t2_drops_t1_congestion_keeps_common(client):
    everything = client.get(f"{API}/alerts").json()
    t2 = client.get(f"{API}/alerts", params={"terminal": "T2"}).json()
    ids = {a["alertId"] for a in t2}
    assert "a4" not in ids
    assert {a["alertId"] for a in everything if a["terminal"] is None} <= ids
    t1 = client.get(f"{API}/alerts", params={"terminal": "T1"}).json()
    assert "a4" in {a["alertId"] for a in t1}


def test_facilities_terminal_excludes_unknown(client):
    everything = client.get(f"{API}/facilities").json()
    t1 = client.get(f"{API}/facilities", params={"terminal": "T1"}).json()
    assert t1 and all(f["terminal"] == "T1" for f in t1)
    assert any(f["terminal"] is None for f in everything)  # terminal 없이는 터미널 미상도 포함


def test_without_terminal_is_unchanged(client):
    assert len(client.get(f"{API}/alerts").json()) == 5
    assert len(client.get(f"{API}/facilities").json()) == 5
    assert len(client.get(f"{API}/flights", params={"type": "DEPARTURE"}).json()) == 8
    assert len(client.get(f"{API}/flights", params={"type": "ARRIVAL"}).json()) == 8


def test_invalid_terminal_is_422(client):
    for path, params in (
        ("/dashboard/summary", {"terminal": "T3"}),
        ("/flights", {"type": "DEPARTURE", "terminal": "T3"}),
        ("/alerts", {"terminal": "T3"}),
        ("/facilities", {"terminal": "T3"}),
    ):
        assert client.get(f"{API}{path}", params=params).status_code == 422, path
