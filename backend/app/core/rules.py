"""백엔드가 관리하는 업무 기준값. 운항 상태 매핑, 지연 기준, 점수 공식, 혼잡 단계 기준."""

import math
import re
from datetime import datetime, timedelta
from functools import lru_cache

import airportsdata

from app.schemas import (
    CongestionLevel,
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

# 운항 여건 점수(풍속·시정 기반 자체 계산). 임시 공식이며 실제 운항 확률이 아니다.
# 풍속: WIND_OK 이하면 감점 없음, WIND_LIMIT 이상이면 최대 감점. 시정은 반대 방향.
WIND_OK_MS = 10.0
WIND_LIMIT_MS = 25.0
VISIBILITY_OK_KM = 5.0
VISIBILITY_LIMIT_KM = 0.8
MAX_PENALTY_PER_FACTOR = 50.0
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
    """ok에서 limit 쪽으로 갈수록 0 → MAX_PENALTY_PER_FACTOR로 선형 증가."""
    ratio = (value - ok) / (limit - ok)
    return MAX_PENALTY_PER_FACTOR * min(max(ratio, 0.0), 1.0)


def operation_score(wind_speed: float | None, visibility: float | None) -> int | None:
    if wind_speed is None or visibility is None:
        return None
    score = (
        100
        - _penalty(wind_speed, WIND_OK_MS, WIND_LIMIT_MS)
        - _penalty(visibility, VISIBILITY_OK_KM, VISIBILITY_LIMIT_KM)
    )
    return round(score)


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