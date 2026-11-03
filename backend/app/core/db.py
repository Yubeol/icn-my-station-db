"""공유 RDS 조회용 연결 풀.

- 모든 세션을 읽기 전용(default_transaction_read_only)으로 연다. 실수로 쓰기 쿼리를 보내도 DB가 거부한다.
- 세션 시간대를 Asia/Seoul로 맞춘다.
- 풀은 처음 조회할 때 열리고, 앱이 종료될 때 close_pool()로 닫는다.
"""

from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import settings

_pool: ConnectionPool | None = None


def _open_pool() -> ConnectionPool:
    kwargs = settings.db_connect_kwargs()
    pool = ConnectionPool(
        kwargs={
            **kwargs,
            "connect_timeout": 10,
            "options": "-c default_transaction_read_only=on -c TimeZone=Asia/Seoul",
            "autocommit": True,
            "row_factory": dict_row,
        },
        min_size=1,
        max_size=5,
        open=False,
    )
    pool.open(wait=True, timeout=15)
    return pool


def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """SELECT 결과를 dict 목록으로 돌려준다."""
    global _pool
    if _pool is None:
        _pool = _open_pool()
    with _pool.connection() as conn:
        return conn.execute(sql, params or {}).fetchall()


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None