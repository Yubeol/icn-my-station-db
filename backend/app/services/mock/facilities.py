"""편의시설 mock."""

from datetime import datetime, time

from app.core.timeutil import now_kst
from app.schemas import Facility, FacilityArea, FacilityCategory, Terminal

# (id, 이름, 분류, 취급품목, 터미널, 층, 위치, 구역, 시작, 종료, 24시간, 전화)
_MOCK_ROWS: list[tuple] = [
    (
        "f1",
        "와이파이도시락",
        FacilityCategory.SHOPPING,
        "포켓와이파이",
        Terminal.T2,
        "1F",
        "제2여객터미널 1층 일반지역",
        FacilityArea.DEPARTURE,
        "06:00",
        "22:00",
        False,
        "1566-9070",
    ),
    (
        "f2",
        "스카이허브 라운지",
        FacilityCategory.LOUNGE,
        "샤워, 음료",
        Terminal.T1,
        "3F",
        "제1여객터미널 3층 출국장",
        FacilityArea.DEPARTURE,
        None,
        None,
        True,
        "032-741-2000",
    ),
    (
        "f3",
        "공항 약국",
        FacilityCategory.PHARMACY,
        "일반의약품",
        Terminal.T1,
        "1F",
        "제1여객터미널 1층 입국장",
        FacilityArea.ARRIVAL,
        "07:00",
        "21:00",
        False,
        "032-741-3000",
    ),
    (
        "f4",
        "버거 카페",
        FacilityCategory.FOOD_CAFE,
        "버거, 커피",
        Terminal.T2,
        "3F",
        "제2여객터미널 3층 면세구역",
        FacilityArea.DEPARTURE,
        "05:30",
        "01:00",
        False,
        None,
    ),
    (
        "f5",
        "여행자 센터",
        FacilityCategory.ETC,
        None,
        None,
        None,
        "여객터미널 일반지역 안내데스크 옆",
        FacilityArea.ARRIVAL,
        None,
        None,
        False,
        None,
    ),
]


def _parse_hhmm(value: str) -> time | None:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError:
        return None


def _is_open(open_time: str | None, close_time: str | None, is24h: bool, now: time) -> bool | None:
    if is24h:
        return True
    if open_time is None or close_time is None:
        return None
    start, end = _parse_hhmm(open_time), _parse_hhmm(close_time)
    if start is None or end is None:
        return None
    if start <= end:
        return start <= now < end
    return now >= start or now < end  # 자정을 넘기는 운영


def list_facilities() -> list[Facility]:
    now = now_kst().time()
    return [
        Facility(
            facility_id=facility_id,
            name=name,
            category=category,
            items=items,
            terminal=terminal,
            floor=floor,
            location=location,
            area=area,
            open_time=open_time,
            close_time=close_time,
            is24h=is24h,
            is_open=_is_open(open_time, close_time, is24h, now),
            tel=tel,
        )
        for (
            facility_id,
            name,
            category,
            items,
            terminal,
            floor,
            location,
            area,
            open_time,
            close_time,
            is24h,
            tel,
        ) in _MOCK_ROWS
    ]
