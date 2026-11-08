API = "/api/v1/congestion/hourly"


def test_hourly_has_every_hour(client):
    body = client.get(API, params={"terminal": "T1"}).json()
    assert body["terminal"] == "T1"
    assert [hour["hour"] for hour in body["hours"]] == list(range(24))
    assert set(body["hours"][0]) == {"hour", "today", "yesterday", "level"}


def test_hourly_rejects_unknown_terminal(client):
    assert client.get(API, params={"terminal": "T9"}).status_code == 422