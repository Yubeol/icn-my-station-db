from fastapi import APIRouter

from app.schemas import Direction, FlightStats
from app.services import stats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/flights", response_model=FlightStats)
def get_flight_stats(direction: Direction):
    return stats.get_flight_stats(direction)