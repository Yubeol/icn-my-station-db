from fastapi import APIRouter

from app.schemas import Facility, Terminal
from app.services import facilities

router = APIRouter(prefix="/facilities", tags=["facilities"])


@router.get("", response_model=list[Facility])
def get_facilities(terminal: Terminal | None = None):
    return facilities.list_facilities(terminal)