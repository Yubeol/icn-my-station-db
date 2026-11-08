from fastapi import APIRouter

from app.schemas import Congestion, CongestionHourly, Terminal
from app.services import congestion

router = APIRouter(prefix="/congestion", tags=["congestion"])


@router.get("", response_model=Congestion)
def get_congestion(terminal: Terminal):
    return congestion.get_congestion(terminal)


@router.get("/hourly", response_model=CongestionHourly)
def get_congestion_hourly(terminal: Terminal):
    return congestion.get_congestion_hourly(terminal)