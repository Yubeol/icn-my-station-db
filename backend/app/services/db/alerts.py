"""스마트 알림 DB 조회.

- 저장된 알림: smart_alerts의 최근 ALERT_LIST_HOURS시간(혼잡·지연·게이트 변경).
- 계산 알림(저장하지 않음): 탑승 시작, 기상 주의. 조회할 때마다 현재 데이터로 만든다.
- DB 표기를 계약(docs/api-contract.md) 코드로 바꾼다. important → WARN.
"""

from datetime import timedelta
from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.config import settings
from app.core.db import fetch_all
from app.core.timeutil import KST, now_kst
from app.schemas import (
    Alert,
    AlertSeverity,
    AlertType,
    Direction,
    FlightStatus,
    OperationLevel,
    Terminal,
)
from app.services.db import weather
from app.services.db.flights import fetch_today_rows, my_flight_numbers

_TYPE = {
    "congestion": AlertType.CONGESTION,
    "delay": AlertType.DELAY,
    "gate_change": AlertType.GATE_CHANGE,
}
_SEVERITY = {
    "info": AlertSeverity.INFO,
    "important": AlertSeverity.WARN,
    "critical": AlertSeverity.CRITICAL,
}


@ttl_cache(seconds=30)
def _stored_rows() -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT a.alert_id, a.alert_type, a.severity, a.title, a.message, a.created_at,
               f.flight_number, f.master_flight_number, t.terminal_code
        FROM smart_alerts a
        LEFT JOIN airport_zones z ON z.zone_id = a.zone_id
        LEFT JOIN terminals t ON t.terminal_id = z.terminal_id
        LEFT JOIN flight_operations f ON f.flight_uid = a.flight_uid AND f.source = a.source
        WHERE a.source = ANY(%(sources)s)
          AND a.alert_type = ANY(%(types)s)
          AND a.created_at >= %(since)s
        ORDER BY a.created_at DESC
        LIMIT %(limit)s
        """,
        {
            "sources": settings.data_sources(),
            "types": list(_TYPE),
            "since": now_kst() - timedelta(hours=rules.ALERT_LIST_HOURS),
            "limit": rules.ALERT_LIST_LIMIT,
        },
    )


def _stored(mine: set[str]) -> list[Alert]:
    alerts = []
    for row in _stored_rows():
        numbers = {
            n.strip().upper() for n in (row["flight_number"], row["master_flight_number"]) if n
        }
        severity = _SEVERITY.get(row["severity"], AlertSeverity.INFO)
        alerts.append(
            Alert(
                alert_id=f"db-{row['alert_id']}",
                type=_TYPE[row["alert_type"]],
                severity=severity,
                title=row["title"],
                message=row["message"],
                flight_no=row["flight_number"],
                # 혼잡 알림만 출국장의 터미널(탑승동은 T1). 나머지는 공통.
                terminal=rules.to_terminal(row["terminal_code"])
                if row["alert_type"] == "congestion"
                else None,
                is_mine=bool(numbers & mine),
                is_important=severity != AlertSeverity.INFO,
                created_at=row["created_at"].astimezone(KST),
            )
        )
    return alerts


def _boarding(mine: set[str]) -> list[Alert]:
    """탑승 중이고 예정 시각이 곧인 출발편. 저장하지 않는 계산 알림."""
    now = now_kst()
    until = now + timedelta(minutes=rules.BOARDING_ALERT_WITHIN_MINUTES)
    since = now - timedelta(minutes=rules.SUMMARY_PAST_MINUTES)
    alerts = []
    for row in fetch_today_rows(Direction.DEPARTURE):
        scheduled = row["scheduled_at"]
        if scheduled is None or not (since <= scheduled <= until):
            continue
        if rules.resolve_status(row["source_status"], 0) != FlightStatus.BOARDING:
            continue
        number = row["flight_number"]
        gate = rules.parse_gate(row["gate"])
        alerts.append(
            Alert(
                alert_id=f"boarding-{number}-{scheduled.astimezone(KST):%Y%m%d%H%M}",
                type=AlertType.BOARDING,
                severity=AlertSeverity.INFO,
                title=f"{number} 항공편",
                message=f"탑승이 시작되었습니다. (게이트 {gate})"
                if gate
                else "탑승이 시작되었습니다.",
                flight_no=number,
                terminal=None,
                is_mine=number.strip().upper() in mine,
                is_important=False,
                created_at=now.replace(second=0),
            )
        )
    return alerts


def _weather() -> list[Alert]:
    """운항 여건 점수가 낮을 때만. 저장하지 않는 계산 알림."""
    w = weather.get_weather()
    score = w.operation_score
    if score.level != OperationLevel.LOW:
        return []
    return [
        Alert(
            alert_id=f"weather-{w.observed_at:%Y%m%d%H%M}",
            type=AlertType.WEATHER,
            severity=AlertSeverity.WARN,
            title="기상 안내",
            message=f"운항 여건 점수가 {score.score}점으로 낮습니다. 운항 정보를 확인하세요.",
            flight_no=None,
            terminal=None,
            is_mine=False,
            is_important=True,
            created_at=w.observed_at,
        )
    ]


def list_alerts(flight_no: str | None = None, terminal: Terminal | None = None) -> list[Alert]:
    mine = my_flight_numbers(flight_no)
    alerts = rules.filter_alert_terminal(_stored(mine) + _boarding(mine) + _weather(), terminal)
    alerts.sort(key=lambda a: a.created_at, reverse=True)
    return alerts[: rules.ALERT_LIST_LIMIT]