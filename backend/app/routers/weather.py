from fastapi import APIRouter

from app.schemas import Weather
from app.services import weather

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("", response_model=Weather)
def get_weather():
    return weather.get_weather()