"""YOLO 카메라 정보·집계 값 객체. mock·db 구현과 허브가 함께 쓴다."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class YoloCameraInfo:
    camera_id: int
    zone_id: int
    name: str
    is_active: bool
    # 카메라가 속한 터미널(T1/T2). /ws/live yolo_camera·yolo_count의 scope로 쓴다.
    scope: str | None


@dataclass(frozen=True)
class YoloCountBucket:
    """30초 집계 1건. demo_yolo_counts 한 행과 같다. crowd_level은 항상 값이 있다."""

    camera_id: int
    bucket_start: datetime
    person_avg: float
    person_max: int
    sample_count: int
    crowd_level: str
    model_version: str
