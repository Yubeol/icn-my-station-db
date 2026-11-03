"""날씨·운항 여건 mock. 단위: 풍속 m/s, 기압 hPa, 기온 °C, 시정 km."""

from app.core import rules
from app.core.timeutil import now_kst
from app.schemas import Crosswind, OperationScore, Weather, WeatherCondition


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
