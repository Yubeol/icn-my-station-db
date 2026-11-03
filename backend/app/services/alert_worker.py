"""스마트 알림 감지를 주기적으로 돌리는 백그라운드 작업.

db 모드에서만 돈다. 감지는 DB 조회라 오래 걸릴 수 있으므로 별도 스레드에서 실행해 API 응답을 막지 않는다.
공유 DB에 쓰는지는 ALERT_WRITE_ENABLED 설정이 정한다(기본 False: 감지만 하고 로그로 남김).
"""

import asyncio
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


async def run_alert_worker() -> None:
    from app.services.db.alert_detector import detector

    while True:
        try:
            await asyncio.to_thread(detector.scan_once)
        except Exception:  # 감지가 실패해도 서버는 계속 돌아야 한다
            logger.exception("알림 감지 실패")
        await asyncio.sleep(settings.alert_scan_interval_seconds)


def start_alert_worker() -> asyncio.Task | None:
    if settings.data_mode != "db":
        return None
    return asyncio.create_task(run_alert_worker())