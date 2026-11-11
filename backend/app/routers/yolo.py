from fastapi import APIRouter, Query

from app.schemas import YoloCamera, YoloEvent, YoloReviewRequest, YoloReviewStatus
from app.services import yolo_api

router = APIRouter(prefix="/yolo", tags=["yolo"])


@router.get("/cameras", response_model=list[YoloCamera])
async def get_cameras():
    return await yolo_api.list_cameras()


@router.get("/events", response_model=list[YoloEvent])
async def get_events(
    cameraId: int | None = None,
    reviewStatus: YoloReviewStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    return await yolo_api.list_events(cameraId, reviewStatus, limit)


@router.patch(
    "/events/{eventId}",
    response_model=YoloEvent,
    responses={404: {"description": "이벤트 없음"}, 409: {"description": "이미 판정됨"}},
)
async def review_event(eventId: int, body: YoloReviewRequest):
    return await yolo_api.review_event(eventId, YoloReviewStatus(body.review_status))
