"""공유 DB 쓰기. 허용하는 쓰기는 아래뿐이다.

- smart_alerts INSERT (docs/db-write-contract.md)
- demo_yolo_counts INSERT ... ON CONFLICT (camera_id, bucket_start) DO NOTHING
- demo_yolo_events INSERT ... ON CONFLICT (dedupe_key) DO NOTHING, UPDATE는 review_status·reviewed_at 두 컬럼만
  (docs/yolo-demo-contract.md 8장). demo_yolo_cameras는 쓰지 않는다.

조회용 연결 풀(core/db.py)은 읽기 전용이라 쓰기를 할 수 없다. 쓰기는 이 모듈에서만, 짧은 연결을 따로 열어 한다.
실행할 SQL은 이 파일 안에 고정되어 있고 바깥에서 SQL을 받지 않으므로, 다른 테이블을 바꾸는 쿼리가 나갈 수 없다.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.core import rules
from app.core.config import settings

INSERT_ALERT_SQL = """
    INSERT INTO smart_alerts (
        source, alert_type, severity, title, message,
        zone_id, flight_uid, previous_value, current_value, unit, dedupe_key
    ) VALUES (
        %(source)s, %(alert_type)s, %(severity)s, %(title)s, %(message)s,
        %(zone_id)s, %(flight_uid)s, %(previous_value)s, %(current_value)s, %(unit)s, %(dedupe_key)s
    )
    ON CONFLICT (dedupe_key, source) DO NOTHING
"""

_COLUMNS = (
    "source",
    "alert_type",
    "severity",
    "title",
    "message",
    "zone_id",
    "flight_uid",
    "previous_value",
    "current_value",
    "unit",
    "dedupe_key",
)


def _params(row: dict[str, Any]) -> dict[str, Any]:
    missing = [c for c in _COLUMNS if c not in row]
    if missing:
        raise ValueError(f"smart_alerts 행에 컬럼이 없습니다: {missing}")
    params = {c: row[c] for c in _COLUMNS}
    for key in ("previous_value", "current_value"):
        if params[key] is not None:
            params[key] = Jsonb(params[key])
    return params


def insert_alerts(rows: Sequence[dict[str, Any]]) -> int:
    """알림 행들을 넣고 실제로 들어간 건수를 돌려준다. 이미 있는 dedupe_key는 건너뛴다."""
    if not rows:
        return 0
    inserted = 0
    kwargs = settings.db_connect_kwargs()
    with psycopg.connect(**kwargs, connect_timeout=10, options="-c TimeZone=Asia/Seoul") as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(INSERT_ALERT_SQL, _params(row))
                inserted += cur.rowcount
        conn.commit()
    return inserted


# ---------- YOLO DEMO ----------

INSERT_YOLO_COUNT_SQL = """
    INSERT INTO demo_yolo_counts (
        camera_id, bucket_start, person_avg, person_max, sample_count, crowd_level, model_version
    ) VALUES (
        %(camera_id)s, %(bucket_start)s, %(person_avg)s, %(person_max)s, %(sample_count)s,
        %(crowd_level)s, %(model_version)s
    )
    ON CONFLICT (camera_id, bucket_start) DO NOTHING
"""

INSERT_YOLO_EVENT_SQL = """
    INSERT INTO demo_yolo_events (
        camera_id, event_type, confidence, detected_at, model_version, dedupe_key
    ) VALUES (
        %(camera_id)s, %(event_type)s, %(confidence)s, %(detected_at)s, %(model_version)s,
        %(dedupe_key)s
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
"""

# review_status와 reviewed_at은 항상 함께 바꾼다(DDL CHECK). 아직 PENDING인 행만 바꾼다.
REVIEW_YOLO_EVENT_SQL = """
    UPDATE demo_yolo_events
    SET review_status = %(review_status)s, reviewed_at = %(reviewed_at)s
    WHERE id = %(event_id)s AND review_status = 'PENDING'
"""

_YOLO_COUNT_KEYS = (
    "camera_id",
    "bucket_start",
    "person_avg",
    "person_max",
    "sample_count",
    "crowd_level",
    "model_version",
)
_YOLO_EVENT_KEYS = ("camera_id", "event_type", "confidence", "detected_at", "model_version", "dedupe_key")
_YOLO_REVIEW_STATUSES = ("CONFIRMED", "FALSE_POSITIVE")


def _connect() -> psycopg.Connection:
    kwargs = settings.db_connect_kwargs()
    return psycopg.connect(**kwargs, connect_timeout=10, options="-c TimeZone=Asia/Seoul")


def _pick(row: dict[str, Any], keys: Sequence[str], table: str) -> dict[str, Any]:
    missing = [k for k in keys if row.get(k) is None]
    if missing:
        raise ValueError(f"{table} 행에 값이 없습니다: {missing}")
    return {k: row[k] for k in keys}


def insert_yolo_count(row: dict[str, Any]) -> bool:
    """30초 집계 1건을 넣는다. 이미 있는 (camera_id, bucket_start)면 건너뛰고 False. crowd_level은 항상 채운다."""
    params = _pick(row, _YOLO_COUNT_KEYS, "demo_yolo_counts")
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(INSERT_YOLO_COUNT_SQL, params)
            inserted = cur.rowcount > 0
        conn.commit()
    return inserted


def insert_yolo_event(row: dict[str, Any]) -> int | None:
    """제스처 이벤트 1건을 넣고 id를 돌려준다. 이미 있는 dedupe_key면 None. event_type은 HELP_GESTURE·FINGER_GUN만 저장한다."""
    params = _pick(row, _YOLO_EVENT_KEYS, "demo_yolo_events")
    if params["event_type"] not in rules.YOLO_EVENT_TYPES:
        raise ValueError(
            f"event_type은 {rules.YOLO_EVENT_TYPES} 중 하나만 저장합니다: {params['event_type']}"
        )
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(INSERT_YOLO_EVENT_SQL, params)
            found = cur.fetchone()
        conn.commit()
    return found[0] if found else None


def review_yolo_event(event_id: int, review_status: str, reviewed_at: datetime) -> bool:
    """PENDING 이벤트의 판정을 바꾼다. 바뀌었으면 True, 이미 판정됐거나 없으면 False."""
    if review_status not in _YOLO_REVIEW_STATUSES:
        raise ValueError(f"review_status는 {_YOLO_REVIEW_STATUSES}만 가능합니다: {review_status}")
    if reviewed_at is None:
        raise ValueError("reviewed_at은 review_status와 함께 바꿔야 합니다")
    params = {"event_id": event_id, "review_status": review_status, "reviewed_at": reviewed_at}
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(REVIEW_YOLO_EVENT_SQL, params)
            changed = cur.rowcount > 0
        conn.commit()
    return changed
