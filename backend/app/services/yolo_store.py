"""YOLO DEMO 저장소 입구. DATA_MODE에 따라 mock 또는 DB 구현을 쓴다."""

from app.core.config import settings

if settings.data_mode == "db":
    from app.services.db.yolo import get_camera, list_cameras
else:
    from app.services.mock.yolo import get_camera, list_cameras

__all__ = ["get_camera", "list_cameras"]
