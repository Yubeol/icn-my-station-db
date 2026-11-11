"""스마트 알림 mock."""

from datetime import timedelta

from app.core import rules
from app.core.errors import FlightNotFoundError
from app.core.timeutil import now_kst
from app.schemas import Alert, AlertSeverity, AlertType, Terminal
from app.services.flights import get_flight, resolve_my_flight_no

# (id, 종류, 중요도, 제목, 내용, 편명, 중요 알림 여부, 발생 시각 오프셋(분))
_MOCK_ROWS: list[tuple] = [
    (
        "a1",
        AlertType.DELAY,
        AlertSeverity.CRITICAL,
        "KE671 항공편",
        "출발이 25분 지연되었습니다.",
        "KE671",
        True,
        -5,
    ),
    (
        "a2",
        AlertType.GATE_CHANGE,
        AlertSeverity.WARN,
        "KE703 항공편",
        "탑승구가 248번으로 변경되었습니다.",
        "KE703",
        True,
        -12,
    ),
    (
        "a3",
        AlertType.BOARDING,
        AlertSeverity.INFO,
        "OZ102 항공편",
        "곧 탑승이 시작됩니다.",
        "OZ102",
        False,
        -20,
    ),
    (
        "a4",
        AlertType.CONGESTION,
        AlertSeverity.WARN,
        "T1 2번 출국장",
        "대기 인원이 많아 혼잡합니다.",
        None,
        True,
        -30,
    ),
    (
        "a5",
        AlertType.WEATHER,
        AlertSeverity.INFO,
        "기상 안내",
        "현재 운항 여건은 양호합니다.",
        None,
        False,
        -45,
    ),
]


# 혼잡 알림의 구역 터미널. 항공편 알림(지연·게이트 변경·탑승)은 편명의 항공편 터미널을 따른다(DB 모드와 같은 규칙).
_MOCK_TERMINALS: dict[str, Terminal] = {"a4": Terminal.T1}


def _flight_terminal_code(flight_no: str | None) -> str | None:
    if not flight_no:
        return None
    try:
        return get_flight(flight_no).terminal.value
    except FlightNotFoundError:
        return None


def _alert_terminal(alert_id: str, kind: AlertType, flight_no: str | None) -> Terminal | None:
    zone = _MOCK_TERMINALS.get(alert_id)
    return rules.alert_terminal(
        kind.value.lower(), zone.value if zone else None, _flight_terminal_code(flight_no)
    )


def list_alerts(flight_no: str | None = None, terminal: Terminal | None = None) -> list[Alert]:
    my_flight_no = resolve_my_flight_no(flight_no)
    now = now_kst()
    alerts = [
        Alert(
            alert_id=alert_id,
            type=kind,
            severity=severity,
            title=title,
            message=message,
            flight_no=alert_flight_no,
            terminal=_alert_terminal(alert_id, kind, alert_flight_no),
            is_mine=my_flight_no is not None and alert_flight_no == my_flight_no,
            is_important=is_important,
            created_at=now + timedelta(minutes=offset),
        )
        for alert_id, kind, severity, title, message, alert_flight_no, is_important, offset in _MOCK_ROWS
    ]
    return rules.filter_alert_terminal(alerts, terminal)
