"""날씨·운항 여건 DB 조회.

- 현재 기상: weather_observations(METAR)의 인천공항(RKSI) 최신 관측.
- 운항 여건 점수: OPERATION_SCORE_MINUTES_AHEAD분 뒤에 가장 가까운 이륙예보의 풍속을 쓰고,
  예보가 없으면 현재 관측 풍속을 쓴다. 돌풍은 예보에 없으므로 현재 관측값을 쓴다.
  관측이 WEATHER_MAX_AGE_MINUTES보다 오래됐으면 점수를 내지 않는다(데이터 부족).
- 수집 단계에서 단위를 변환해 저장한다(풍속 m/s, 기압 hPa, 시정 km).
"""

from datetime import datetime, timedelta
from typing import Any

from app.core import rules
from app.core.cache import ttl_cache
from app.core.config import settings
from app.core.db import fetch_all
from app.core.timeutil import KST, now_kst
from app.schemas import Crosswind, OperationScore, Weather, WeatherHistoryPoint

AIRPORT_ICAO = "RKSI"


def _float(value: Any) -> float | None:
    return None if value is None else round(float(value), 1)


def _latest_observation() -> dict[str, Any] | None:
    rows = fetch_all(
        """
        SELECT observed_at, wind_direction_degrees, wind_speed_mps, wind_gust_mps, temperature_c,
               pressure_hpa, visibility_km, weather_phenomena
        FROM weather_observations
        WHERE airport_icao = %(icao)s AND source = ANY(%(sources)s)
        ORDER BY observed_at DESC
        LIMIT 1
        """,
        {"icao": AIRPORT_ICAO, "sources": settings.data_sources()},
    )
    return rows[0] if rows else None


def _forecast_near(target: datetime) -> dict[str, Any] | None:
    rows = fetch_all(
        """
        SELECT valid_at, wind_speed_mps
        FROM takeoff_weather_forecasts
        WHERE airport_icao = %(icao)s AND source = ANY(%(sources)s)
          AND valid_at BETWEEN %(lo)s AND %(hi)s
        ORDER BY abs(extract(epoch FROM valid_at - %(target)s)), issued_at DESC NULLS LAST
        LIMIT 1
        """,
        {
            "icao": AIRPORT_ICAO,
            "sources": settings.data_sources(),
            "lo": target - timedelta(hours=1),
            "hi": target + timedelta(hours=1),
            "target": target,
        },
    )
    return rows[0] if rows else None


@ttl_cache(seconds=60)
def get_weather() -> Weather:
    now = now_kst()
    obs = _latest_observation()
    if obs is None:
        return Weather(
            observed_at=now.replace(second=0),
            condition=None,
            temperature=None,
            wind_speed=None,
            wind_gust=None,
            wind_direction=None,
            visibility=None,
            pressure=None,
            crosswind=Crosswind(runway=rules.RUNWAY_NAME, active_runway=None, direction=None, speed=None),
            operation_score=OperationScore(
                minutes_ahead=rules.OPERATION_SCORE_MINUTES_AHEAD,
                score=None,
                level=None,
                delay_risk=None,
                basis=None,
                message=rules.OPERATION_MESSAGE_NO_DATA,
            ),
        )

    observed_at = obs["observed_at"].astimezone(KST)
    wind_speed = _float(obs["wind_speed_mps"])
    wind_direction = _float(obs["wind_direction_degrees"])
    wind_gust = _float(obs["wind_gust_mps"])

    fresh = now - observed_at <= timedelta(minutes=rules.WEATHER_MAX_AGE_MINUTES)
    forecast = _forecast_near(now + timedelta(minutes=rules.OPERATION_SCORE_MINUTES_AHEAD))
    forecast_wind = _float(forecast["wind_speed_mps"]) if forecast else None
    score_wind = forecast_wind if forecast_wind is not None else wind_speed
    score = rules.operation_score(score_wind, wind_gust) if fresh else None
    level = rules.operation_level(score)

    return Weather(
        observed_at=observed_at,
        condition=rules.weather_condition(obs["weather_phenomena"]),
        temperature=_float(obs["temperature_c"]),
        wind_speed=wind_speed,
        wind_gust=wind_gust,
        wind_direction=wind_direction,
        visibility=_float(obs["visibility_km"]),
        pressure=_float(obs["pressure_hpa"]),
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


@ttl_cache(seconds=60)
def get_weather_history(hours: int = rules.WEATHER_HISTORY_DEFAULT_HOURS) -> list[WeatherHistoryPoint]:
    """최근 N시간 METAR 관측. 시각 오름차순이고 같은 시각의 중복 출처는 하나만 쓴다."""
    rows = fetch_all(
        """
        SELECT * FROM (
            SELECT DISTINCT ON (observed_at)
                observed_at, temperature_c, wind_speed_mps, weather_phenomena,
                visibility_km, pressure_hpa
            FROM weather_observations
            WHERE airport_icao = %(icao)s AND source = ANY(%(sources)s) AND observed_at >= %(since)s
            ORDER BY observed_at DESC
            LIMIT %(limit)s
        ) recent
        ORDER BY observed_at
        """,
        {
            "icao": AIRPORT_ICAO,
            "sources": settings.data_sources(),
            "since": now_kst() - timedelta(hours=hours),
            "limit": rules.WEATHER_HISTORY_LIMIT,
        },
    )
    return [
        WeatherHistoryPoint(
            observed_at=row["observed_at"].astimezone(KST),
            temperature=_float(row["temperature_c"]),
            wind_speed=_float(row["wind_speed_mps"]),
            condition=rules.weather_condition(row["weather_phenomena"]),
            phenomenon=rules.weather_phenomenon(row["weather_phenomena"]),
            visibility=_float(row["visibility_km"]),
            pressure=_float(row["pressure_hpa"]),
        )
        for row in rows
    ]
