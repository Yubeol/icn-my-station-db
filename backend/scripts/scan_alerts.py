"""알림 감지를 한 번 돌려서 결과를 보여준다. backend 폴더에서 실행한다.

    uv run python scripts/scan_alerts.py          # 감지만 하고 DB에 쓰지 않는다(기본)
    uv run python scripts/scan_alerts.py --write  # smart_alerts에 넣는다(ALERT_WRITE_ENABLED=true일 때만)

--write를 줘도 .env의 ALERT_WRITE_ENABLED가 true가 아니면 쓰지 않는다. 두 단계로 막아 실수로 쓰는 일을 막는다.
게이트 변경은 직전 감지와 비교해야 하므로 한 번 실행으로는 나오지 않는다.
"""

import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ["DATA_MODE"] = "db"

from app.core.config import settings
from app.core.db_write import insert_alerts
from app.services.db.alert_detector import detector


def main() -> int:
    want_write = "--write" in sys.argv
    rows = detector.detect()
    print(f"감지 {len(rows)}건")
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, default=str))

    if not want_write:
        print("DB에 쓰지 않았습니다. 넣으려면 --write와 ALERT_WRITE_ENABLED=true가 모두 필요합니다.")
        return 0
    if not settings.alert_write_enabled:
        print("ALERT_WRITE_ENABLED가 true가 아니라서 쓰지 않았습니다.")
        return 1
    print(f"smart_alerts에 {insert_alerts(rows)}건 넣었습니다(중복 제외).")
    return 0


if __name__ == "__main__":
    sys.exit(main())