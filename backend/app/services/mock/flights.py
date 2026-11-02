"""운항 현황 mock. DATA_MODE=mock일 때 쓰인다."""

from datetime import timedelta

from app.core import rules
from app.core.errors import FlightNotFoundError
from app.core.timeutil import now_kst
from app.schemas import Direction, Flight, Terminal

# (편명, 항공사, 방향, 도시, 공항코드, 예정 시각 오프셋(분), 지연(분), 터미널, 게이트, 원본 상태)
_MOCK_ROWS: list[tuple] = [
    ("KE703", "대한항공", Direction.DEPARTURE, "도쿄(나리타)", "NRT", -10, 0, Terminal.T1, 248, "탑승중"),
    ("OZ102", "아시아나항공", Direction.DEPARTURE, "도쿄(하네다)", "HND", 15, 0, Terminal.T1, 112, "탑승준비"),
    ("KE671", "대한항공", Direction.DEPARTURE, "오사카(간사이)", "KIX", 30, 25, Terminal.T2, 255, "예정"),
    ("DL158", "델타항공", Direction.DEPARTURE, "시애틀", "SEA", 45, 0, Terminal.T2, 266, "예정"),
    ("7C1101", "제주항공", Direction.DEPARTURE, "방콕", "BKK", 60, 0, Terminal.T1, 30, "예정"),
    ("KE901", "대한항공", Direction.DEPARTURE, "뉴욕(JFK)", "JFK", 80, 0, Terminal.T2, 250, "예정"),
    ("AF267", "에어프랑스", Direction.DEPARTURE, "파리", "CDG", 95, 0, Terminal.T2, None, "예정"),
    ("TW202", "티웨이항공", Direction.DEPARTURE, "후쿠오카", "FUK", -40, 0, Terminal.T1, 18, "출발"),
    ("KE706", "대한항공", Direction.ARRIVAL, "도쿄(나리타)", "NRT", -5, 0, Terminal.T2, None, "도착"),
    ("OZ101", "아시아나항공", Direction.ARRIVAL, "도쿄(하네다)", "HND", 10, 0, Terminal.T1, None, "예정"),
    ("KE672", "대한항공", Direction.ARRIVAL, "오사카(간사이)", "KIX", 25, 20, Terminal.T2, None, "예정"),
    ("DL159", "델타항공", Direction.ARRIVAL, "시애틀", "SEA", 40, 0, Terminal.T2, None, "예정"),
    ("7C1102", "제주항공", Direction.ARRIVAL, "방콕", "BKK", 55, 0, Terminal.T1, None, "예정"),
    ("KE902", "대한항공", Direction.ARRIVAL, "뉴욕(JFK)", "JFK", 70, 0, Terminal.T2, None, "예정"),
    ("AF268", "에어프랑스", Direction.ARRIVAL, "파리", "CDG", 90, 0, Terminal.T2, None, "회항"),
    ("TW201", "티웨이항공", Direction.ARRIVAL, "후쿠오카", "FUK", -30, 0, Terminal.T1, None, "도착"),
]


def _normalize(flight_no: str | None) -> str | None:
    if flight_no is None:
        return None
    return flight_no.strip().upper() or None


def resolve_my_flight_no(flight_no: str | None) -> str | None:
    """요청한 편명이 있으면 정규화해서 돌려주고, 없는 편명이면 None(강조 없음)으로 처리한다."""
    normalized = _normalize(flight_no)
    if normalized is None or all(row[0] != normalized for row in _MOCK_ROWS):
        return None
    return normalized


def _to_flight(row: tuple, my_flight_no: str | None) -> Flight:
    no, airline, kind, city, code, offset, delay, terminal, gate, raw_status = row
    # 지금 시각 기준으로 예정 시각을 잡아, 언제 호출해도 메인 요약에 같은 편들이 보이게 한다.
    base = now_kst().replace(second=0)
    scheduled = base.replace(minute=base.minute - base.minute % 5) + timedelta(minutes=offset)
    return Flight(
        flight_no=no,
        airline=airline,
        type=kind,
        city=city,
        airport_code=code,
        scheduled_at=scheduled,
        estimated_at=scheduled + timedelta(minutes=delay) if delay else None,
        terminal=terminal,
        gate=gate,
        status=rules.resolve_status(raw_status, delay),
        delay_minutes=delay,
        is_my_flight=no == my_flight_no,
    )


def list_flights(direction: Direction, flight_no: str | None = None) -> list[Flight]:
    my_flight_no = resolve_my_flight_no(flight_no)
    flights = [_to_flight(row, my_flight_no) for row in _MOCK_ROWS if row[2] == direction]
    return sorted(flights, key=lambda f: f.scheduled_at)


def list_upcoming_flights(
    direction: Direction, my_flight_no: str | None, limit: int
) -> list[Flight]:
    """메인 요약용. 지금보다 SUMMARY_PAST_MINUTES 전 이후 예정된 편부터 limit건."""
    since = now_kst() - timedelta(minutes=rules.SUMMARY_PAST_MINUTES)
    flights = [_to_flight(row, my_flight_no) for row in _MOCK_ROWS if row[2] == direction]
    flights.sort(key=lambda f: f.scheduled_at)
    return [f for f in flights if f.scheduled_at >= since][:limit]


def get_flight(flight_no: str) -> Flight:
    """단건 조회. 없는 편명이면 FlightNotFoundError."""
    normalized = _normalize(flight_no) or flight_no
    for row in _MOCK_ROWS:
        if row[0] == normalized:
            return _to_flight(row, normalized)
    raise FlightNotFoundError(normalized)