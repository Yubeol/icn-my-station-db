from fastapi import APIRouter

from app.schemas import DashboardSummary, Terminal
from app.services import dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(flightNo: str | None = None, terminal: Terminal | None = None):
    return dashboard.get_summary(flightNo, terminal)
