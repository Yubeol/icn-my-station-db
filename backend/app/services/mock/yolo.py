"""YOLO DEMO mock. 카메라는 1대(camera_id=1, T1 3번 출국장)로 고정한다. 공유 DB에는 쿼리를 보내지 않는다."""

from app.services.yolo_types import YoloCameraInfo

_CAMERAS = [
    YoloCameraInfo(camera_id=1, zone_id=1, name="T1 3번 출국장 DEMO", is_active=True, scope="T1")
]


def list_cameras() -> list[YoloCameraInfo]:
    return list(_CAMERAS)


def get_camera(camera_id: int) -> YoloCameraInfo | None:
    return next((c for c in _CAMERAS if c.camera_id == camera_id), None)
