"""DB 연결 확인. terminals 테이블을 SELECT만 해본다. backend 폴더에서 실행한다.

읽기 전용 세션으로 연결하고 고정된 SELECT 한 개만 실행한다. 비밀번호는 출력하지 않는다.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import psycopg

from app.core.config import settings

QUERY = "SELECT * FROM terminals LIMIT 50"


def main() -> int:
    try:
        kwargs = settings.db_connect_kwargs()
        print(
            f"접속 대상: {kwargs['host']}:{kwargs['port']}/{kwargs['dbname']} "
            f"(user={kwargs['user']}, sslmode={kwargs['sslmode']})"
        )
        with psycopg.connect(**kwargs, connect_timeout=10) as conn:
            conn.read_only = True  # 서버에 읽기 전용 트랜잭션으로 요청
            with conn.cursor() as cur:
                cur.execute(QUERY)
                columns = [col.name for col in cur.description]
                rows = cur.fetchall()
    except (psycopg.Error, RuntimeError) as exc:  # 접속 정보가 담기지 않도록 종류와 메시지만 출력
        print(f"실패: {type(exc).__name__}: {exc}")
        return 1

    print(f"terminals: {len(rows)}행, 컬럼 {columns}")
    for row in rows:
        print(row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
