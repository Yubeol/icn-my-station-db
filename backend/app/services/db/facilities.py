"""편의시설 DB 조회. airport_facilities 원문을 계약의 Facility로 바꾼다.

- 분류: 시설명·시설 종류·취급품목의 키워드(rules.FACILITY_CATEGORY_RULES).
- 층: floor_label이 있으면 그대로, 없으면 위치 문장에서 꺼낸다.
- 영업시간: opening_hours_note 원문을 해석한다. 해석하지 못하면 시간과 운영 여부를 null로 둔다.
- 탑승동(CONCOURSE) 시설은 T1으로 내보낸다.
"""

from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.db import fetch_all
from app.core.timeutil import now_kst
from app.schemas import Facility


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


def _to_facility(row: dict[str, Any], now_hhmm: str) -> Facility:
    location = row["location_description"] or ""
    open_time, close_time, is24h = rules.parse_opening_hours(row["opening_hours_note"])
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
        is_open=rules.is_open_now(open_time, close_time, is24h, now_hhmm),
        tel=row["phone_number"],
    )


def list_facilities() -> list[Facility]:
    now_hhmm = now_kst().strftime("%H:%M")
    return [_to_facility(row, now_hhmm) for row in _rows()]