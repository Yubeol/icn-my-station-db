"""운항 현황 DB 조회. flight_operations를 읽어 계약의 Flight로 바꾼다.

- 코드쉐어(is_codeshare = TRUE)는 목록과 집계에서 빼고 마스터 편만 쓴다. 단건 조회는 코드쉐어 편명도 찾는다.
- status 컬럼은 수집 단계에서 unknown으로 들어오므로, source_status(원문)를 rules.resolve_status로 변환한다.
- 탑승동(CONCOURSE) 편은 T1으로 내보낸다.
"""

from datetime import datetime, timedelta
from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.config import settings
from app.core.db import fetch_all
from app.core.errors import FlightNotFoundError
from app.core.timeutil import KST, now_kst
from app.schemas import Direction, Flight, Terminal

_FLOW = {Direction.DEPARTURE: "departure", Direction.ARRIVAL: "arrival"}

_COLUMNS = """
    f.flight_number,
    f.master_flight_number,
    f.is_codeshare,
    f.airline_name,
    f.flow_type,
    f.departure_airport_code,
    f.arrival_airport_code,
    f.departure_airport_name,
    f.arrival_airport_name,
    f.departure_city_name,
    f.arrival_city_name,
    f.scheduled_at,
    f.estimated_at,
    t.terminal_code,
    f.gate,
    f.source_status,
    f.last_collected_at
"""


def _today_range() -> tuple[datetime, datetime]:
    start = now_kst().replace(hour=0, minute=0, second=0)
    return start, start + timedelta(days=1)


@ttl_cache(seconds=30)
def fetch_today_rows(direction: Direction) -> list[dict[str, Any]]:
    """오늘(KST, 예정 시각 기준) 해당 방향의 마스터 편 원본 행. 통계도 이 결과를 쓴다."""
    start, end = _today_range()
    return fetch_all(
        f"""
        SELECT {_COLUMNS}
        FROM flight_operations f
        LEFT JOIN terminals t ON t.terminal_id = f.terminal_id
        WHERE f.flow_type = %(flow)s
          AND f.source = ANY(%(sources)s)
          AND f.is_codeshare IS NOT TRUE
          AND f.scheduled_at >= %(start)s AND f.scheduled_at < %(end)s
        ORDER BY f.scheduled_at, f.flight_number
        """,
        {
            "flow": _FLOW[direction],
            "sources": settings.data_sources(),
            "start": start,
            "end": end,
        },
    )


def delay_minutes(row: dict[str, Any]) -> int:
    scheduled, estimated = row["scheduled_at"], row["estimated_at"]
    if scheduled is None or estimated is None:
        return 0
    return max(0, int((estimated - scheduled).total_seconds() // 60))


def _to_flight(row: dict[str, Any], my_numbers: set[str]) -> Flight | None:
    terminal = rules.to_terminal(row["terminal_code"])
    if terminal is None or row["scheduled_at"] is None:
        return None  # 계약상 필수인 터미널·예정 시각이 없으면 화면에 낼 수 없다
    departure = row["flow_type"] == "departure"
    # 출발편은 도착지, 도착편은 출발지가 상대 공항
    side = "arrival" if departure else "departure"
    city = (
            rules.format_city(row[f"{side}_city_name"])
            or rules.format_city(row[f"{side}_airport_name"])
            or row[f"{side}_airport_code"]
            or ""
    )
    delay = delay_minutes(row)
    estimated = row["estimated_at"]
    return Flight(
        flight_no=row["flight_number"],
        airline=row["airline_name"] or "",
        type=Direction.DEPARTURE if departure else Direction.ARRIVAL,
        city=city,
        airport_code=row[f"{side}_airport_code"] or "",
        scheduled_at=row["scheduled_at"].astimezone(KST),
        estimated_at=estimated.astimezone(KST) if estimated and delay > 0 else None,
        terminal=terminal,
        gate=rules.parse_gate(row["gate"]),
        status=rules.resolve_status(row["source_status"], delay),
        delay_minutes=delay,
        is_my_flight=row["flight_number"] in my_numbers,
    )


def _normalize(flight_no: str | None) -> str | None:
    if flight_no is None:
        return None
    return flight_no.strip().upper() or None


@ttl_cache(seconds=30)
def _find_rows(flight_no: str) -> list[dict[str, Any]]:
    """편명으로 찾기(코드쉐어 포함). 오늘에 가까운 편이 먼저 온다."""
    return fetch_all(
        f"""
        SELECT {_COLUMNS}
        FROM flight_operations f
        LEFT JOIN terminals t ON t.terminal_id = f.terminal_id
        WHERE upper(f.flight_number) = %(no)s
          AND f.source = ANY(%(sources)s)
          AND f.scheduled_at IS NOT NULL
        ORDER BY abs(extract(epoch FROM f.scheduled_at - now()))
        LIMIT 5
        """,
        {"no": flight_no, "sources": settings.data_sources()},
    )


def resolve_my_flight_no(flight_no: str | None) -> str | None:
    """요청한 편명이 DB에 있으면 정규화해서 돌려주고, 없으면 None(강조 없음)."""
    normalized = _normalize(flight_no)
    if normalized is None or not _find_rows(normalized):
        return None
    return normalized


def _my_numbers(my_flight_no: str | None) -> set[str]:
    """강조할 편명들. 코드쉐어 편명을 검색했으면 그 마스터 편명도 강조한다."""
    if my_flight_no is None:
        return set()
    numbers = {my_flight_no}
    for row in _find_rows(my_flight_no):
        if row["master_flight_number"]:
            numbers.add(row["master_flight_number"].strip().upper())
    return numbers

def my_flight_numbers(flight_no: str | None) -> set[str]:
    """요청 편명 기준으로 '내 항공편'으로 볼 편명들. 없는 편명이면 빈 집합."""
    return _my_numbers(resolve_my_flight_no(flight_no))

def _flights(rows: list[dict[str, Any]], my_flight_no: str | None) -> list[Flight]:
    my_numbers = _my_numbers(my_flight_no)
    return [f for row in rows if (f := _to_flight(row, my_numbers)) is not None]


def list_flights(
    direction: Direction, flight_no: str | None = None, terminal: Terminal | None = None
) -> list[Flight]:
    """오늘 운항편 전체(예정 시각순). terminal을 주면 그 터미널만."""
    flights = _flights(fetch_today_rows(direction), resolve_my_flight_no(flight_no))
    return rules.filter_terminal(flights, terminal)


def list_upcoming_flights(
    direction: Direction, my_flight_no: str | None, limit: int, terminal: Terminal | None = None
) -> list[Flight]:
    """메인 요약용. 지금보다 SUMMARY_PAST_MINUTES 전 이후 예정된 편부터 limit건."""
    since = now_kst() - timedelta(minutes=rules.SUMMARY_PAST_MINUTES)
    flights = rules.filter_terminal(_flights(fetch_today_rows(direction), my_flight_no), terminal)
    return [f for f in flights if f.scheduled_at >= since][:limit]


def get_flight(flight_no: str) -> Flight:
    """단건 조회. 코드쉐어 편명도 찾는다. 없으면 FlightNotFoundError."""
    normalized = _normalize(flight_no) or flight_no
    for row in _find_rows(normalized):
        flight = _to_flight(row, {normalized})
        if flight is not None:
            return flight
    raise FlightNotFoundError(normalized)

