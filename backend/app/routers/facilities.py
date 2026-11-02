from fastapi import APIRouter

from app.schemas import Facility
from app.services import facilities

router = APIRouter(prefix="/facilities", tags=["facilities"])


@router.get("", response_model=list[Facility])
def get_facilities():
    return facilities.list_facilities()