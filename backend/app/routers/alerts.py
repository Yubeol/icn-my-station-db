from fastapi import APIRouter

from app.schemas import Alert, Terminal
from app.services import alerts

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[Alert])
def get_alerts(flightNo: str | None = None, terminal: Terminal | None = None):
    return alerts.list_alerts(flightNo, terminal)