"""YOLO 카메라 정보. mock·db 구현과 허브가 함께 쓰는 값 객체."""

from dataclasses import dataclass


@dataclass(frozen=True)
class YoloCameraInfo:
    camera_id: int
    zone_id: int
    name: str
    is_active: bool
    # 카메라가 속한 터미널(T1/T2). /ws/live yolo_camera·yolo_count의 scope로 쓴다.
    scope: str | None
