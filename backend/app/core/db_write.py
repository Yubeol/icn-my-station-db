"""공유 DB 쓰기. smart_alerts INSERT만 허용한다 (docs/db-write-contract.md).

조회용 연결 풀(core/db.py)은 읽기 전용이라 쓰기를 할 수 없다. 쓰기는 이 모듈에서만, 짧은 연결을 따로 열어 한다.
실행할 SQL은 이 파일 안에 고정되어 있고 바깥에서 SQL을 받지 않으므로, 다른 테이블을 바꾸는 쿼리가 나갈 수 없다.
"""

from collections.abc import Sequence
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

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