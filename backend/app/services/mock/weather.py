"""날씨·운항 여건 mock. 단위: 풍속 m/s, 기압 hPa, 기온 °C, 시정 km."""

from datetime import timedelta

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import Crosswind, OperationScore, Weather, WeatherCondition, WeatherHistoryPoint


def get_weather() -> Weather:
    observed_at = now_kst().replace(second=0)
    wind_speed = 8.0
    wind_direction = 320.0
    visibility = 10.0
    score = rules.operation_score(wind_speed, visibility)
    level = rules.operation_level(score)
    return Weather(
        observed_at=observed_at,
        condition=WeatherCondition.CLEAR,
        temperature=18.0,
        wind_speed=wind_speed,
        wind_gust=12.0,
        wind_direction=wind_direction,
        visibility=visibility,
        pressure=1016.0,
        crosswind=Crosswind(
            runway=rules.RUNWAY_NAME,
            active_runway=rules.active_runway(wind_speed, wind_direction),
            direction=wind_direction,
            speed=rules.crosswind_speed(wind_speed, wind_direction),
        ),
        operation_score=OperationScore(
            minutes_ahead=rules.OPERATION_SCORE_MINUTES_AHEAD,
            score=score,
            level=level,
            delay_risk=rules.delay_risk(level),
            basis=observed_at if score is not None else None,
            message=rules.OPERATION_MESSAGES[level]
            if level is not None
            else rules.OPERATION_MESSAGE_NO_DATA,
        ),
    )


def get_weather_history(hours: int = rules.WEATHER_HISTORY_DEFAULT_HOURS) -> list[WeatherHistoryPoint]:
    """30분 간격 관측 mock. 시각 오름차순이다."""
    now = now_kst().replace(second=0)
    latest = now.replace(minute=now.minute - now.minute % 30)
    points = []
    for step in range(hours * 2, -1, -1):
        rain = step % 16 < 3
        points.append(
            WeatherHistoryPoint(
                observed_at=latest - timedelta(minutes=30 * step),
                temperature=round(15 + 3 * (step % 12) / 12, 1),
                wind_speed=round(5 + 3 * (step % 8) / 8, 1),
                condition=WeatherCondition.RAIN if rain else WeatherCondition.CLEAR,
                phenomenon="-RA" if rain else None,
                visibility=6.0 if rain else 10.0,
                pressure=round(1012 + 4 * (step % 24) / 24, 1),
            )
        )
    return points
