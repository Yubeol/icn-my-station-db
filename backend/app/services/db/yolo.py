"""YOLO DEMO DB 조회. demo_yolo_cameras는 SELECT만 한다.

scope(T1/T2)는 demo_yolo_cameras → airport_zones → terminals로 구한다.
"""

from typing import Any

from app.core.db import fetch_all
from app.services.yolo_types import YoloCameraInfo

_CAMERA_SQL = """
    SELECT c.camera_id, c.zone_id, c.name, c.is_active, t.terminal_code
    FROM demo_yolo_cameras c
    LEFT JOIN airport_zones z ON z.zone_id = c.zone_id
    LEFT JOIN terminals t ON t.terminal_id = z.terminal_id
    {where}
    ORDER BY c.camera_id
"""


def _info(row: dict[str, Any]) -> YoloCameraInfo:
    return YoloCameraInfo(
        camera_id=row["camera_id"],
        zone_id=row["zone_id"],
        name=row["name"],
        is_active=row["is_active"],
        scope=row["terminal_code"],
    )


def list_cameras() -> list[YoloCameraInfo]:
    return [_info(r) for r in fetch_all(_CAMERA_SQL.format(where=""))]


def get_camera(camera_id: int) -> YoloCameraInfo | None:
    rows = fetch_all(
        _CAMERA_SQL.format(where="WHERE c.camera_id = %(camera_id)s"), {"camera_id": camera_id}
    )
    return _info(rows[0]) if rows else None
