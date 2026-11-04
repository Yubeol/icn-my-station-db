"""편의시설 DB 조회. airport_facilities 원문을 계약의 Facility로 바꾼다.

- 분류: 시설명·시설 종류·취급품목의 키워드(rules.FACILITY_CATEGORY_RULES).
- 층: floor_label이 있으면 그대로, 없으면 위치 문장에서 꺼낸다.
- 영업시간: opening_hours_note 원문을 해석한다. 해석하지 못하면 시간과 운영 여부를 null로 둔다.
- 탑승동(CONCOURSE) 시설은 T1으로 내보낸다.
- 주변 혼잡 예상: 조회 시 계산하고 저장하지 않는다. 시설 목록과 입력 데이터의 캐시를 나눈다.
"""

from collections import defaultdict
from datetime import timedelta
from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.config import settings
from app.core.db import fetch_all
from app.core.timeutil import now_kst
from app.schemas import CongestionLevel, Facility, Terminal
from app.services.db.congestion import get_congestion


@ttl_cache(seconds=300)
def _rows() -> list[dict[str, Any]]:
    """시설 정보는 하루 한 번 수집되므로 5분 캐시로 충분하다."""
    return fetch_all(
        """
        SELECT f.facility_id, f.facility_name, f.facility_type, t.terminal_code,
               f.floor_label, f.location_description, f.opening_hours_note,
               f.products_description, f.arrival_departure_area, f.phone_number
        FROM airport_facilities f
        LEFT JOIN terminals t ON t.terminal_id = f.terminal_id
        ORDER BY f.facility_id
        """
    )


@ttl_cache(seconds=60)
def _departures_by_terminal() -> dict[str, int]:
    """DB 터미널 코드별 앞으로 2시간의 출발 편수. 코드쉐어와 결항은 뺀다."""
    now = now_kst()
    rows = fetch_all(
        """
        SELECT t.terminal_code, count(*) AS flights
        FROM flight_operations f
        JOIN terminals t ON t.terminal_id = f.terminal_id
        WHERE f.flow_type = 'departure'
          AND f.source = ANY(%(sources)s)
          AND f.is_codeshare IS NOT TRUE
          AND f.status <> 'cancelled'
          AND f.scheduled_at >= %(start)s AND f.scheduled_at < %(end)s
        GROUP BY t.terminal_code
        """,
        {
            "sources": settings.data_sources(),
            "start": now,
            "end": now + timedelta(hours=rules.CROWD_FLIGHT_WINDOW_HOURS),
        },
    )
    return {row["terminal_code"]: row["flights"] for row in rows}


@ttl_cache(seconds=300)
def _hall_forecasts(target_date: str) -> dict[tuple[str, int], dict[str, int]]:
    """(터미널, 출국장 번호)별 시간대 -> 출발 승객예고. 하루 몇 번만 수집되므로 5분 캐시한다."""
    rows = fetch_all(
        """
        SELECT z.zone_code, p.time_slot, max(p.expected_passenger_count) AS expected
        FROM passenger_forecasts p
        JOIN airport_zones z ON z.zone_id = p.zone_id
        WHERE p.target_date = %(target_date)s
          AND p.flow_type = 'departure'
          AND p.source = ANY(%(sources)s)
          AND z.zone_type = 'passenger_forecast_zone'
        GROUP BY z.zone_code, p.time_slot
        """,
        {"target_date": target_date, "sources": settings.data_sources()},
    )
    forecasts: dict[tuple[str, int], dict[str, int]] = defaultdict(dict)
    for row in rows:
        match = rules.CROWD_FORECAST_ZONE_RE.match(row["zone_code"])
        if match:
            forecasts[(match.group(1), int(match.group(2)))][row["time_slot"]] = row["expected"]
    return dict(forecasts)


def _hall_levels(terminal: Terminal) -> dict[int, CongestionLevel | None]:
    """출국장별 혼잡 예상. 현재 혼잡은 get_congestion의 30초 캐시를 그대로 쓴다."""
    now = now_kst()
    congestion = get_congestion(terminal)
    max_age = timedelta(minutes=rules.CROWD_CONGESTION_MAX_AGE_MINUTES)
    is_fresh = now - congestion.measured_at <= max_age
    forecasts = _hall_forecasts(now.date().isoformat())
    current_slot, next_slot = rules.crowd_forecast_slots(now.hour)

    levels: dict[int, CongestionLevel | None] = {}
    for hall in congestion.halls:
        by_slot = forecasts.get((terminal.value, hall.hall_id), {})
        forecast = rules.forecast_crowd_level(
            by_slot.get(current_slot),
            by_slot.get(next_slot) if next_slot else None,
            max(by_slot.values(), default=None),
        )
        levels[hall.hall_id] = rules.hall_crowd_level(
            hall.level if is_fresh else None, forecast, hall.operation_status
        )
    return levels


def _to_facility(
    row: dict[str, Any],
    now_hhmm: str,
    hall_levels: dict[str, dict[int, CongestionLevel | None]],
    departures: dict[str, int],
) -> Facility:
    location = row["location_description"] or ""
    open_time, close_time, is24h = rules.parse_opening_hours(row["opening_hours_note"])
    is_open = rules.is_open_now(open_time, close_time, is24h, now_hhmm)
    terminal_code = row["terminal_code"]
    crowd_estimate, crowd_basis = rules.facility_crowd(
        rules.crowd_location(
            row["facility_name"], location, row["arrival_departure_area"], terminal_code
        ),
        is_open,
        terminal_code,
        hall_levels.get(terminal_code, {}),
        departures.get(terminal_code, 0),
    )
    return Facility(
        facility_id=str(row["facility_id"]),
        name=row["facility_name"],
        category=rules.facility_category(
            row["facility_name"], row["facility_type"], row["products_description"]
        ),
        items=row["products_description"],
        terminal=rules.to_terminal(row["terminal_code"]),
        floor=row["floor_label"] or rules.parse_floor(location),
        location=location,
        area=rules.facility_area(row["arrival_departure_area"]),
        open_time=open_time,
        close_time=close_time,
        is24h=is24h,
        is_open=is_open,
        tel=row["phone_number"],
        crowd_estimate=crowd_estimate,
        crowd_basis=crowd_basis,
    )


def list_facilities(terminal: Terminal | None = None) -> list[Facility]:
    now_hhmm = now_kst().strftime("%H:%M")
    hall_levels = {item.value: _hall_levels(item) for item in Terminal}
    departures = _departures_by_terminal()
    facilities = [_to_facility(row, now_hhmm, hall_levels, departures) for row in _rows()]
    return rules.filter_terminal(facilities, terminal)