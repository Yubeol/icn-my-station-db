"""메인 요약. 각 위젯 서비스의 결과를 한 응답으로 묶는다."""

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import (
    DashboardSummary,
    Direction,
    Facility,
    SummaryCongestion,
    SummaryFlights,
    SummaryStats,
    Terminal,
)
from app.services import alerts, congestion, facilities, flights, stats, weather


def _summary_facilities() -> list[Facility]:
    """운영 중인 시설을 앞에 두고 SUMMARY_FACILITY_LIMIT건만. 전체 목록은 /facilities."""
    items = facilities.list_facilities()
    items.sort(key=lambda f: {True: 0, None: 1, False: 2}[f.is_open])
    return items[: rules.SUMMARY_FACILITY_LIMIT]


def get_summary(flight_no: str | None = None) -> DashboardSummary:
    my_flight_no = flights.resolve_my_flight_no(flight_no)
    limit = rules.SUMMARY_FLIGHT_LIMIT
    return DashboardSummary(
        generated_at=now_kst(),
        my_flight_no=my_flight_no,
        flights=SummaryFlights(
            departures=flights.list_upcoming_flights(Direction.DEPARTURE, my_flight_no, limit),
            arrivals=flights.list_upcoming_flights(Direction.ARRIVAL, my_flight_no, limit),
        ),
        congestion=SummaryCongestion(
            T1=congestion.get_congestion(Terminal.T1),
            T2=congestion.get_congestion(Terminal.T2),
        ),
        stats=SummaryStats(
            departure=stats.get_flight_stats(Direction.DEPARTURE),
            arrival=stats.get_flight_stats(Direction.ARRIVAL),
        ),
        alerts=alerts.list_alerts(my_flight_no),
        weather=weather.get_weather(),
        facilities=_summary_facilities(),
    )