"""백엔드가 관리하는 업무 기준값. 운항 상태 매핑, 지연 기준, 점수 공식, 혼잡 단계 기준."""

import math
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

import airportsdata

from app.schemas import (
    CongestionLevel,
    CrowdBasis,
    DelayRisk,
    FacilityArea,
    FacilityCategory,
    FlightStatus,
    HallOperationStatus,
    OperationLevel,
    Terminal,
    WeatherCondition,
)

# ---------- 운항 ----------

# 지연 기준(분)
DELAY_THRESHOLD_MINUTES = 15

# 메인 요약의 출발/도착 최대 건수
SUMMARY_FLIGHT_LIMIT = 6
# 메인 요약에 포함할 과거 편 범위(분). 이보다 오래 전에 예정된 편은 메인 목록에서 뺀다.
SUMMARY_PAST_MINUTES = 30

# 운항 상태 매핑: 원본 상태(API remark) -> 표준 코드.
# 실제 DB 값은 SELECT DISTINCT source_status로 확인해 계속 보완한다.
STATUS_MAP: dict[str, FlightStatus] = {
    "예정": FlightStatus.SCHEDULED,
    "체크인오픈": FlightStatus.SCHEDULED,
    "체크인 오픈": FlightStatus.SCHEDULED,
    "게이트변경": FlightStatus.SCHEDULED,
    "탑승준비": FlightStatus.BOARDING_SOON,
    "탑승중": FlightStatus.BOARDING,
    "마감예정": FlightStatus.BOARDING,
    "탑승마감": FlightStatus.BOARDING,
    "지연": FlightStatus.DELAYED,
    "결항": FlightStatus.CANCELLED,
    "출발": FlightStatus.DEPARTED,
    "도착": FlightStatus.ARRIVED,
    "착륙": FlightStatus.ARRIVED,
    "회항": FlightStatus.DIVERTED,
}


def resolve_status(raw_status: str | None, delay_minutes: int) -> FlightStatus:
    """원본 상태를 표준 코드로 바꾼다.

    원본이 없거나 모르는 값이면 SCHEDULED로 보고, 예정/탑승준비 상태라도 지연 기준을 넘으면 DELAYED.
    """
    key = (raw_status or "").replace(" ", "")
    code = STATUS_MAP.get(key) or STATUS_MAP.get(raw_status or "", FlightStatus.SCHEDULED)
    if (
        code in (FlightStatus.SCHEDULED, FlightStatus.BOARDING_SOON)
        and delay_minutes >= DELAY_THRESHOLD_MINUTES
    ):
        return FlightStatus.DELAYED
    return code


# DB 터미널 코드 -> 계약 터미널. 탑승동(CONCOURSE) 승객은 T1에서 체크인·출국심사를 받으므로 T1.
TERMINAL_MAP: dict[str, Terminal] = {
    "T1": Terminal.T1,
    "T2": Terminal.T2,
    "CONCOURSE": Terminal.T1,
}


def to_terminal(code: str | None) -> Terminal | None:
    return TERMINAL_MAP.get(code or "")


def airline_code(code: str | None, flight_no: str | None) -> str | None:
    """IATA 항공사 코드. 수집값이 없으면 편명 앞 두 글자(KE703 -> KE, 7C1101 -> 7C)를 쓴다."""
    value = (code or "").strip().upper()
    if value:
        return value
    match = re.match(r"[A-Z0-9]{2}(?=\d)", (flight_no or "").strip().upper())
    return match.group() if match else None


@lru_cache(maxsize=1)
def _airports() -> dict:
    return airportsdata.load("IATA")


def country_code(airport_code: str | None) -> str | None:
    """공항 IATA 코드의 ISO 3166-1 국가 코드. 모르는 공항이면 None."""
    airport = _airports().get((airport_code or "").strip().upper())
    return airport["country"] if airport else None


def format_city(value: str | None) -> str | None:
    """'도쿄/나리타', '오사카/ 간사이'처럼 들어온 도시명을 '도쿄(나리타)'로 통일한다."""
    if not value:
        return None
    parts = [p.strip() for p in value.split("/") if p.strip()]
    if len(parts) >= 2:
        return f"{parts[0]}({'/'.join(parts[1:])})"
    return parts[0] if parts else None


def parse_gate(value: str | None) -> int | None:
    """게이트 원문에서 숫자만 꺼낸다. 숫자가 없으면 None."""
    if not value:
        return None
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


# ---------- 출국장 혼잡도 ----------

# 터미널별 혼잡 단계 기준 (MID 시작, HIGH 시작). 출국장 합산 대기 인원(명) 기준이다.
# 2026-11-02~03 실제 분포로 정한 임시값이며, 데이터가 더 쌓이면 다시 조정한다.
CONGESTION_LEVEL_FROM: dict[Terminal, tuple[int, int]] = {
    Terminal.T1: (200, 400),
    Terminal.T2: (800, 2000),
}

# changeRate 비교 기준: 최신 측정 시각보다 N분 전 값(앞뒤 허용 오차 M분)
CONGESTION_COMPARE_MINUTES = 30
CONGESTION_COMPARE_TOLERANCE_MINUTES = 5


def congestion_level(waiting_count: int, terminal: Terminal) -> CongestionLevel:
    mid_from, high_from = CONGESTION_LEVEL_FROM[terminal]
    if waiting_count >= high_from:
        return CongestionLevel.HIGH
    if waiting_count >= mid_from:
        return CongestionLevel.MID
    return CongestionLevel.LOW


# 운영 확인 필요 표시: 측정이 충분한데도 최대 합산 대기 인원이 매우 적은 출국장.
# 대기 인원만으로 미운영을 확정할 수 없으므로 '확인 필요'로만 표시한다.
HALL_CHECK_LOOKBACK_HOURS = 24
HALL_CHECK_MIN_POINTS = 100
HALL_CHECK_MAX_WAITING = 10


def hall_operation_status(points: int, max_waiting: int | None) -> HallOperationStatus | None:
    if points < HALL_CHECK_MIN_POINTS or max_waiting is None:
        return None
    if max_waiting <= HALL_CHECK_MAX_WAITING:
        return HallOperationStatus.CHECK_REQUIRED
    return None


def change_rate(current: int, previous: int | None) -> float | None:
    """이전 값 대비 증감률(%). 이전 값이 없거나 0이면 None."""
    if previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


# ---------- 날씨·운항 여건 ----------

# 측풍 계산용 활주로. 인천공항 주 활주로 15/33(진방위 약 150°).
RUNWAY_NAME = "15/33"
RUNWAY_HEADING_DEG = 150.0


def crosswind_speed(wind_speed: float | None, wind_direction: float | None) -> float | None:
    """활주로 방향과 직각인 바람 성분(m/s)."""
    if wind_speed is None or wind_direction is None:
        return None
    angle = math.radians(wind_direction - RUNWAY_HEADING_DEG)
    return round(abs(wind_speed * math.sin(angle)), 1)


# 활주로 끝 번호 -> 방향(도). 바람을 마주 보는 쪽 끝을 사용 활주로로 본다.
RUNWAY_ENDS: dict[str, float] = {"15": 150.0, "33": 330.0}
CALM_WIND_MS = 1.0  # 이 값 미만이면 무풍으로 보고 사용 활주로를 정하지 않는다.


def active_runway(wind_speed: float | None, wind_direction: float | None) -> str | None:
    """풍향과 각도 차이가 더 작은 활주로 끝("15" 또는 "33"). 무풍이거나 풍향을 모르면 None."""
    if wind_speed is None or wind_direction is None or wind_speed < CALM_WIND_MS:
        return None

    def gap(end_deg: float) -> float:
        diff = abs(wind_direction - end_deg) % 360
        return min(diff, 360 - diff)

    return min(RUNWAY_ENDS, key=lambda end: gap(RUNWAY_ENDS[end]))


# 일기현상(METAR 코드) -> 날씨 코드. 앞에 있는 규칙이 우선한다.
# 구름량을 아직 수집하지 않으므로 일기현상이 없으면 임시로 CLEAR. 구름량이 생기면 CLOUDY를 구분한다.
WEATHER_RULES: list[tuple[tuple[str, ...], WeatherCondition]] = [
    (("SN", "SG", "PL", "GR", "GS"), WeatherCondition.SNOW),
    (("RA", "DZ", "SH", "TS"), WeatherCondition.RAIN),
    (("FG", "BR", "HZ", "FU", "DU", "SA"), WeatherCondition.FOG),
]


def weather_phenomenon(phenomena: str | None) -> str | None:
    """일기현상 원문(WMO URL)의 마지막 코드. 예: http://codes.wmo.int/306/4678/-RA -> -RA"""
    code = (phenomena or "").strip().rsplit("/", 1)[-1]
    return code or None


def weather_condition(phenomena: str | None) -> WeatherCondition:
    """일기현상 원문을 날씨 코드로 바꾼다.

    수집 값은 WMO 코드 URL 형식이다(예: http://codes.wmo.int/306/4678/-RA).
    URL 전체에서 찾으면 주소 글자에 걸릴 수 있으므로 마지막 '/' 뒤 코드만 보고, 강도 기호(+, -)는 뗀다.
    """
    text = (phenomena or "").strip().rsplit("/", 1)[-1].lstrip("+-").upper()
    for codes, condition in WEATHER_RULES:
        if any(code in text for code in codes):
            return condition
    return WeatherCondition.CLEAR


# METAR 이력 조회 범위(시간)
WEATHER_HISTORY_DEFAULT_HOURS = 24
WEATHER_HISTORY_MAX_HOURS = 48
WEATHER_HISTORY_LIMIT = 300

# 운항 여건 점수(풍속·돌풍 기반 자체 계산). 임시 공식이며 실제 운항 확률이 아니다.
# 풍속(돌풍이 더 크면 돌풍): WIND_OK 이하면 감점 없음, WIND_LIMIT 이상이면 최대 감점.
WIND_OK_MS = 10.0
WIND_LIMIT_MS = 25.0
MAX_PENALTY = 100.0
SCORE_HIGH_FROM = 80
SCORE_MID_FROM = 50
OPERATION_SCORE_MINUTES_AHEAD = 60
# 관측값이 이보다 오래되면 점수를 내지 않는다(데이터 부족).
WEATHER_MAX_AGE_MINUTES = 120

OPERATION_MESSAGES: dict[OperationLevel, str] = {
    OperationLevel.HIGH: "운항 여건 양호",
    OperationLevel.MID: "운항 여건 보통",
    OperationLevel.LOW: "운항 여건 주의",
}
OPERATION_MESSAGE_NO_DATA = "데이터 부족"


def _penalty(value: float, ok: float, limit: float) -> float:
    """ok에서 limit 쪽으로 갈수록 0 → MAX_PENALTY로 선형 증가."""
    ratio = (value - ok) / (limit - ok)
    return MAX_PENALTY * min(max(ratio, 0.0), 1.0)


def operation_score(wind_speed: float | None, wind_gust: float | None = None) -> int | None:
    """돌풍은 관측될 때만 값이 있으므로 없으면 풍속만 본다."""
    if wind_speed is None:
        return None
    wind = max(wind_speed, wind_gust or 0.0)
    return round(100 - _penalty(wind, WIND_OK_MS, WIND_LIMIT_MS))


def filter_terminal(items: list, terminal: Terminal | None) -> list:
    """운항·편의시설 목록을 터미널로 거른다. terminal이 없으면 그대로, 터미널을 모르는 항목은 지정 시 제외."""
    if terminal is None:
        return items
    return [item for item in items if item.terminal == terminal]


def filter_alert_terminal(alerts: list, terminal: Terminal | None) -> list:
    """알림을 터미널로 거른다. 지정하면 같은 터미널의 알림과 공통(terminal=None) 알림만 남긴다."""
    if terminal is None:
        return alerts
    return [a for a in alerts if a.terminal is None or a.terminal == terminal]


def delay_risk(level: OperationLevel | None) -> DelayRisk | None:
    """출발 지연 위험. 운항 여건 등급을 뒤집은 값(HIGH → LOW, LOW → HIGH)."""
    if level is None:
        return None
    return {
        OperationLevel.HIGH: DelayRisk.LOW,
        OperationLevel.MID: DelayRisk.MID,
        OperationLevel.LOW: DelayRisk.HIGH,
    }[level]


def operation_level(score: int | None) -> OperationLevel | None:
    if score is None:
        return None
    if score >= SCORE_HIGH_FROM:
        return OperationLevel.HIGH
    if score >= SCORE_MID_FROM:
        return OperationLevel.MID
    return OperationLevel.LOW


# ---------- 편의시설 ----------

# 메인 요약에 넣을 편의시설 최대 건수(운영 중인 시설 우선). 전체 목록은 /facilities.
SUMMARY_FACILITY_LIMIT = 20

# 이름·취급품목 키워드 -> 분류. 앞에 있는 규칙이 우선한다.
FACILITY_CATEGORY_RULES: list[tuple[tuple[str, ...], FacilityCategory]] = [
    (("라운지",), FacilityCategory.LOUNGE),
    (("약국", "의약품"), FacilityCategory.PHARMACY),
    (
        (
            "카페", "커피", "베이커리", "제과", "식당", "푸드", "레스토랑", "버거",
            "음식", "분식", "치킨", "도넛", "주스", "음료", "라면", "한식", "일식",
            "중식", "양식", "다이닝",
        ),
        FacilityCategory.FOOD_CAFE,
    ),
    (
        (
            "면세", "화장품", "기념품", "의류", "가방", "패션", "편의점", "서점", "도서",
            "전자", "주얼리", "향수", "잡화", "쇼핑", "선물", "주류", "담배",
        ),
        FacilityCategory.SHOPPING,
    ),
]


def facility_category(*texts: str | None) -> FacilityCategory:
    joined = " ".join(t for t in texts if t)
    for keywords, category in FACILITY_CATEGORY_RULES:
        if any(keyword in joined for keyword in keywords):
            return category
    return FacilityCategory.ETC


def facility_area(raw: str | None) -> FacilityArea:
    """원본 입/출국 구분(A: 입국장, D: 출국장). 값이 없으면 출국장으로 본다."""
    return FacilityArea.ARRIVAL if (raw or "").strip().upper() == "A" else FacilityArea.DEPARTURE


def parse_floor(location: str | None) -> str | None:
    """위치 문장에서 층을 꺼낸다. '지하 1층' -> 'B1', '3층' -> '3F'."""
    if not location:
        return None
    match = re.search(r"(지하\s*)?(\d+)\s*층", location)
    if not match:
        return None
    return f"B{match.group(2)}" if match.group(1) else f"{match.group(2)}F"


def parse_opening_hours(note: str | None) -> tuple[str | None, str | None, bool]:
    """영업시간 원문을 (시작, 종료, 24시간 여부)로 바꾼다. 해석하지 못하면 (None, None, False).

    '24:00'은 '00:00'으로 바꾼다. 시작>종료면 자정을 넘기는 운영으로 처리된다.
    """
    if not note:
        return None, None, False
    if "24시간" in note.replace(" ", ""):
        return None, None, True
    match = re.search(r"(\d{1,2}):?(\d{2})\s*[~\-–]\s*(\d{1,2}):?(\d{2})", note)
    if not match:
        return None, None, False
    sh, sm, eh, em = (int(x) for x in match.groups())
    # 원본에 '00:00 ~ 00:00'으로 들어온 시설(256건)은 24시간 운영으로 본다.
    if (sh, sm) == (0, 0) and (eh, em) in ((0, 0), (24, 0), (23, 59)):
        return None, None, True
    if sh > 24 or eh > 24 or sm > 59 or em > 59:
        return None, None, False
    return f"{sh % 24:02d}:{sm:02d}", f"{eh % 24:02d}:{em:02d}", False


def is_open_now(
    open_time: str | None, close_time: str | None, is24h: bool, now_hhmm: str
) -> bool | None:
    """현재 시각(HH:MM)에 운영 중인지. 시간을 모르면 None. 자정을 넘기는 운영도 처리한다."""
    if is24h:
        return True
    if open_time is None or close_time is None:
        return None
    if open_time <= close_time:
        return open_time <= now_hhmm < close_time
    return now_hhmm >= open_time or now_hhmm < close_time



# ---------- 스마트 알림 (docs/db-write-contract.md) ----------

# 혼잡 급증: 30분 전 대비 증가율과 증가 인원을 둘 다 넘어야 알린다(작은 숫자의 큰 비율을 거르기 위해).
SURGE_MIN_RATE = 30.0
SURGE_MIN_INCREASE = 100
# 같은 출국장의 같은 종류 혼잡 알림은 이 시간 안에 다시 저장하지 않는다.
CONGESTION_ALERT_COOLDOWN_MINUTES = 30
# 지연 알림 단위(분). 지연이 이 단위만큼 늘 때마다 새 알림이 생긴다.
DELAY_ALERT_STEP_MINUTES = 15
# 이 시간 이상 지연이면 critical
DELAY_CRITICAL_FROM_MINUTES = 60
# 감지에 쓰는 데이터가 이보다 오래됐으면 알림을 만들지 않는다(과거 데이터로 '지금 혼잡' 알림 방지).
ALERT_MAX_DATA_AGE_MINUTES = 15
# 알림 감지 대상 항공편 범위: 지금 기준 과거/미래 시간
ALERT_FLIGHT_PAST_HOURS = 3
ALERT_FLIGHT_FUTURE_HOURS = 12
# 알림 목록: 최근 N시간, 최대 M건
ALERT_LIST_HOURS = 6
ALERT_LIST_LIMIT = 30
# 탑승 시작 알림(저장하지 않고 계산): 예정 시각이 지금부터 N분 안인 탑승중 편
BOARDING_ALERT_WITHIN_MINUTES = 60


def is_fresh(collected_at: datetime | None, now: datetime) -> bool:
    """알림을 만들어도 될 만큼 최근에 수집된 데이터인지."""
    if collected_at is None:
        return False
    return now - collected_at <= timedelta(minutes=ALERT_MAX_DATA_AGE_MINUTES)


def delay_bucket(delay_minutes: int) -> int:
    """지연 분을 알림 단위로 내린다. 25분 -> 15, 40분 -> 30."""
    return delay_minutes // DELAY_ALERT_STEP_MINUTES * DELAY_ALERT_STEP_MINUTES


def is_surge(current: int, past: int | None) -> bool:
    if past is None:
        return False
    rate = change_rate(current, past)
    return rate is not None and rate >= SURGE_MIN_RATE and current - past >= SURGE_MIN_INCREASE


# ---------- 편의시설 주변 혼잡 예상 ----------

# 실측값이 아니라 현재 혼잡·승객예고·출발 편수로 정한 단계다. 인원수나 대기 시간은 내지 않는다.
CROWD_LEVELS = (CongestionLevel.LOW, CongestionLevel.MID, CongestionLevel.HIGH)

# 이보다 오래된 출국장 측정값은 현재 혼잡으로 쓰지 않는다.
CROWD_CONGESTION_MAX_AGE_MINUTES = 30
# 승객예고는 출국장별 규모 차이가 커서 당일 최댓값 대비 비율로 판정한다. (MID 시작, HIGH 시작)
CROWD_FORECAST_RATIO_FROM = (0.4, 0.7)
# 면세구역·탑승구 쪽 시설이 보는 출발 편수 범위(시간)
CROWD_FLIGHT_WINDOW_HOURS = 2
# DB의 출발편이 지금부터 이 시간(분) 뒤까지 없으면 수집이 덜 된 것으로 보고 판정하지 않는다.
CROWD_FLIGHT_MIN_COVERAGE_MINUTES = 100
# 터미널별 2시간 출발 편수 기준 (MID 시작, HIGH 시작). 코드쉐어를 뺀 값이다.
# 2026-11-02~04의 부분 수집 분포로 정한 임시값이며, 전체 수집이 안정되면 다시 조정한다.
CROWD_FLIGHT_LEVEL_FROM: dict[str, tuple[int, int]] = {
    "T1": (14, 22),
    "CONCOURSE": (13, 19),
    "T2": (28, 42),
}
# 승객예고 구역 코드(T1DG3)와 출국장 번호가 대응한다. EG는 입국 구역이라 쓰지 않는다.
CROWD_FORECAST_ZONE_RE = re.compile(r"^(T[12])DG(\d+)$")

_CROWD_EXCLUDED_NAME_RE = re.compile(r"AED|셔틀|버스|주차")
_CROWD_EXCLUDED_LOCATION_RE = re.compile(r"주차장|교통센터|승강장")
_CROWD_ARRIVAL_RE = re.compile(r"입국장|입국심사")
_CROWD_AIRSIDE_RE = re.compile(r"면세|에어사이드")
_CROWD_LANDSIDE_RE = re.compile(r"일반지역|일반구역")
_CROWD_GATE_RE = re.compile(r"\d+\s*번?\s*(?:게이트|탑승구|탑승교)")
_CROWD_HALL_RE = re.compile(r"(\d+)\s*번\s*출국장")
_CROWD_TERMINAL_RE = re.compile(r"일반지역|일반구역|체크인|출국장")


@dataclass(frozen=True)
class CrowdLocation:
    """시설이 어떤 입력으로 혼잡을 추정하는지. 출국장 기준이면 hall_no가 있다."""

    basis: CrowdBasis
    hall_no: int | None = None


@lru_cache(maxsize=4096)
def crowd_location(
    name: str, location: str | None, area: str | None, terminal_code: str | None
) -> CrowdLocation | None:
    """시설명·위치 문구로 추정 기준을 정한다. 연결 근거가 없으면 None."""
    text = location or ""
    if terminal_code not in CROWD_FLIGHT_LEVEL_FROM:
        return None
    if _CROWD_EXCLUDED_NAME_RE.search(name) or _CROWD_EXCLUDED_LOCATION_RE.search(text):
        return None
    if facility_area(area) is FacilityArea.ARRIVAL or _CROWD_ARRIVAL_RE.search(text):
        return None
    if terminal_code == "CONCOURSE" or _CROWD_AIRSIDE_RE.search(text):
        return CrowdLocation(CrowdBasis.FLIGHTS)

    floor = parse_floor(text)
    is_upper_floor = floor is None or not (floor == "1F" or floor.startswith("B"))
    if is_upper_floor and _CROWD_GATE_RE.search(text) and not _CROWD_LANDSIDE_RE.search(text):
        return CrowdLocation(CrowdBasis.FLIGHTS)

    hall = _CROWD_HALL_RE.search(text)
    if hall:
        return CrowdLocation(CrowdBasis.HALL, int(hall.group(1)))
    if floor == "3F" and _CROWD_TERMINAL_RE.search(text):
        return CrowdLocation(CrowdBasis.TERMINAL)
    return None


def crowd_forecast_slots(hour: int) -> tuple[str, str | None]:
    """현재 시각의 승객예고 시간대와 같은 날의 다음 시간대. 23시 다음은 내일 데이터라 None."""

    def slot(start: int) -> str:
        return f"{start:02d}_{(start + 1) % 24:02d}"

    return slot(hour), slot(hour + 1) if hour < 23 else None


def _level_from(value: float, mid_from: float, high_from: float) -> CongestionLevel:
    if value >= high_from:
        return CongestionLevel.HIGH
    if value >= mid_from:
        return CongestionLevel.MID
    return CongestionLevel.LOW


def forecast_crowd_level(
    current: int | None, upcoming: int | None, peak: int | None
) -> CongestionLevel | None:
    """현재·다음 시간대 예고 중 큰 값을 그 출국장의 당일 최댓값과 비교한다."""
    if current is None or not peak:
        return None
    return _level_from(max(current, upcoming or 0) / peak, *CROWD_FORECAST_RATIO_FROM)


def flight_crowd_level(flights: int, terminal_code: str) -> CongestionLevel | None:
    """2시간 출발 편수의 단계. 0편은 수집 범위 문제일 수 있어 판정하지 않는다."""
    if flights <= 0 or terminal_code not in CROWD_FLIGHT_LEVEL_FROM:
        return None
    return _level_from(flights, *CROWD_FLIGHT_LEVEL_FROM[terminal_code])


def has_flight_coverage(last_scheduled: datetime | None, now: datetime) -> bool:
    """출발편 데이터가 편수 범위를 대부분 덮는지 확인한다. 일부만 세면 LOW로 잘못 나온다."""
    if last_scheduled is None:
        return False
    return last_scheduled >= now + timedelta(minutes=CROWD_FLIGHT_MIN_COVERAGE_MINUTES)


def hall_crowd_level(
    current: CongestionLevel | None,
    forecast: CongestionLevel | None,
    operation_status: HallOperationStatus | None,
) -> CongestionLevel | None:
    """현재 혼잡과 승객예고 중 높은 단계. 운영 확인이 필요한 출국장은 판정하지 않는다."""
    if operation_status is HallOperationStatus.CHECK_REQUIRED:
        return None
    levels = [level for level in (current, forecast) if level is not None]
    return max(levels, key=CROWD_LEVELS.index, default=None)


def terminal_crowd_level(levels: Iterable[CongestionLevel | None]) -> CongestionLevel | None:
    """출국장 단계의 평균을 반올림한다. 판정된 출국장이 없으면 None."""
    ranks = [CROWD_LEVELS.index(level) for level in levels if level is not None]
    if not ranks:
        return None
    return CROWD_LEVELS[math.floor(sum(ranks) / len(ranks) + 0.5)]


def facility_crowd(
    location: CrowdLocation | None,
    is_open: bool | None,
    terminal_code: str | None,
    hall_levels: Mapping[int, CongestionLevel | None],
    flights: int,
) -> tuple[CongestionLevel | None, CrowdBasis | None]:
    """시설 한 곳의 (혼잡 예상, 기준). 영업 종료가 확인된 시설은 판정하지 않는다."""
    if location is None or is_open is False:
        return None, None
    if location.basis is CrowdBasis.FLIGHTS:
        level = flight_crowd_level(flights, terminal_code or "")
    elif location.basis is CrowdBasis.HALL:
        level = hall_levels.get(location.hall_no)
    else:
        level = terminal_crowd_level(hall_levels.values())
    return (level, location.basis) if level is not None else (None, None)