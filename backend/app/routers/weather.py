from fastapi import APIRouter, Query

from app.core import rules
from app.schemas import Weather, WeatherHistoryPoint
from app.services import weather

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("", response_model=Weather)
def get_weather():
    return weather.get_weather()


@router.get("/history", response_model=list[WeatherHistoryPoint])
def get_weather_history(
    hours: int = Query(
        default=rules.WEATHER_HISTORY_DEFAULT_HOURS, ge=1, le=rules.WEATHER_HISTORY_MAX_HOURS
    ),
):
    return weather.get_weather_history(hours)
