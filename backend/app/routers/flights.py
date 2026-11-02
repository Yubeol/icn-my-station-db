from fastapi import APIRouter

from app.schemas import Direction, Flight
from app.services import flights

router = APIRouter(prefix="/flights", tags=["flights"])


@router.get("", response_model=list[Flight])
def get_flights(type: Direction, flightNo: str | None = None):
    return flights.list_flights(type, flightNo)


@router.get("/{flightNo}", response_model=Flight)
def get_flight(flightNo: str):
    return flights.get_flight(flightNo)