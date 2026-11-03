"""응답 모델. docs/api-contract.md와 1:1로 일치해야 한다."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- 코드값 ----------


class Terminal(StrEnum):
    T1 = "T1"
    T2 = "T2"


class Direction(StrEnum):
    DEPARTURE = "DEPARTURE"
    ARRIVAL = "ARRIVAL"


class FlightStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    BOARDING_SOON = "BOARDING_SOON"
    BOARDING = "BOARDING"
    DELAYED = "DELAYED"
    CANCELLED = "CANCELLED"
    DEPARTED = "DEPARTED"
    ARRIVED = "ARRIVED"
    DIVERTED = "DIVERTED"


class CongestionLevel(StrEnum):
    LOW = "LOW"
    MID = "MID"
    HIGH = "HIGH"


class HallOperationStatus(StrEnum):
    CHECK_REQUIRED = "CHECK_REQUIRED"


class DataSource(StrEnum):
    API = "api"
    YOLO = "yolo"
    DEMO = "demo"


class StatsCategory(StrEnum):
    NORMAL = "NORMAL"
    DELAYED = "DELAYED"
    CANCELLED = "CANCELLED"
    DIVERTED = "DIVERTED"


class AlertType(StrEnum):
    DELAY = "DELAY"
    GATE_CHANGE = "GATE_CHANGE"
    CONGESTION = "CONGESTION"
    WEATHER = "WEATHER"
    BOARDING = "BOARDING"


class AlertSeverity(StrEnum):
    INFO = "INFO"
    WARN = "WARN"
    CRITICAL = "CRITICAL"


class WeatherCondition(StrEnum):
    CLEAR = "CLEAR"
    CLOUDY = "CLOUDY"
    RAIN = "RAIN"
    SNOW = "SNOW"
    FOG = "FOG"


# 운항 여건 단계는 혼잡 단계와 같은 LOW / MID / HIGH 코드를 쓴다.
OperationLevel = CongestionLevel
DelayRisk = CongestionLevel  # 출발 지연 위험. 값은 LOW / MID / HIGH


class FacilityCategory(StrEnum):
    LOUNGE = "LOUNGE"
    FOOD_CAFE = "FOOD_CAFE"
    PHARMACY = "PHARMACY"
    SHOPPING = "SHOPPING"
    ETC = "ETC"


class FacilityArea(StrEnum):
    DEPARTURE = "DEPARTURE"
    ARRIVAL = "ARRIVAL"


class LiveTopic(StrEnum):
    CONGESTION = "congestion"
    FLIGHTS = "flights"
    STATS = "stats"
    ALERTS = "alerts"
    WEATHER = "weather"


# ---------- Flight ----------


class Flight(CamelModel):
    flight_no: str
    airline: str
    type: Direction
    city: str
    airport_code: str
    scheduled_at: datetime
    estimated_at: datetime | None
    terminal: Terminal
    gate: int | None
    status: FlightStatus
    delay_minutes: int
    is_my_flight: bool


# ---------- Congestion ----------


class Hall(CamelModel):
    hall_id: int
    hall_name: str
    waiting_count: int
    level: CongestionLevel
    change_rate: float | None
    source: DataSource
    operation_status: HallOperationStatus | None = None


class Congestion(CamelModel):
    terminal: Terminal
    measured_at: datetime
    halls: list[Hall]


# ---------- FlightStats ----------


class Breakdown(CamelModel):
    category: StatsCategory
    count: int
    ratio: float
    change_rate: float | None


class Hourly(CamelModel):
    hour: int
    count: int
    delayed_count: int


class FlightStats(CamelModel):
    date: str
    direction: Direction
    total: int
    breakdown: list[Breakdown]
    hourly: list[Hourly]


# ---------- Alert ----------


class Alert(CamelModel):
    alert_id: str
    type: AlertType
    severity: AlertSeverity
    title: str
    message: str
    flight_no: str | None
    terminal: Terminal | None
    is_mine: bool
    is_important: bool
    created_at: datetime


# ---------- Weather ----------


class Crosswind(CamelModel):
    runway: str | None
    active_runway: str | None
    direction: float | None
    speed: float | None


class OperationScore(CamelModel):
    minutes_ahead: int
    score: int | None
    level: OperationLevel | None
    delay_risk: DelayRisk | None
    basis: datetime | None
    message: str


class Weather(CamelModel):
    observed_at: datetime
    condition: WeatherCondition | None
    temperature: float | None
    wind_speed: float | None
    wind_direction: float | None
    visibility: float | None
    pressure: float | None
    crosswind: Crosswind
    operation_score: OperationScore


# ---------- Facility ----------


class Facility(CamelModel):
    facility_id: str
    name: str
    category: FacilityCategory
    items: str | None
    terminal: Terminal | None
    floor: str | None
    location: str
    area: FacilityArea
    open_time: str | None
    close_time: str | None
    # to_camel("is24h")는 "is24H"가 되므로 계약의 키 is24h를 별칭으로 명시한다.
    is24h: bool = Field(alias="is24h")
    is_open: bool | None
    tel: str | None


# ---------- DashboardSummary ----------


class SummaryFlights(CamelModel):
    departures: list[Flight]
    arrivals: list[Flight]


class SummaryCongestion(CamelModel):
    # 계약의 키는 대문자 T1 / T2 이므로 별칭을 명시한다.
    t1: Congestion = Field(alias="T1")
    t2: Congestion = Field(alias="T2")


class SummaryStats(CamelModel):
    departure: FlightStats
    arrival: FlightStats


class DashboardSummary(CamelModel):
    generated_at: datetime
    my_flight_no: str | None
    flights: SummaryFlights
    congestion: SummaryCongestion
    stats: SummaryStats
    alerts: list[Alert]
    weather: Weather
    facilities: list[Facility]


# ---------- WebSocket ----------


class LiveMessage(CamelModel):
    topic: LiveTopic
    # flights·stats는 DEPARTURE/ARRIVAL, congestion은 T1/T2, alerts·weather는 null
    scope: str | None
    data: Any
    sent_at: datetime
