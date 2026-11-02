from fastapi import APIRouter

from app.schemas import Congestion, Terminal
from app.services import congestion

router = APIRouter(prefix="/congestion", tags=["congestion"])


@router.get("", response_model=Congestion)
def get_congestion(terminal: Terminal):
    return congestion.get_congestion(terminal)