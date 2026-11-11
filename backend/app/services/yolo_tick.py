"""YOLO 허브 틱. 1초마다 인원(yolo_count)을 내보내고 끝난 30초 집계 구간을 저장한다.

DATA_MODE와 무관하게 돈다(mock 모드에서도 가짜 워커로 화면을 확인할 수 있어야 한다).
저장은 yolo_results가 yolo_store 입구로 하므로, db 모드의 쓰기 여부는 YOLO_WRITE_ENABLED가 정한다.
"""

import asyncio
import logging

from app.core.yolo_hub import hub
from app.services import live, yolo_results

logger = logging.getLogger(__name__)

TICK_SECONDS = 1.0


async def tick_once() -> None:
    # 카메라와 워커가 모두 연결된 동안의 마지막 인원을 초당 1회 내보낸다.
    for state in list(hub.cameras.values()):
        if not (state.online and hub.worker_online):
            continue
        message = live.yolo_count_message(state)
        if message is not None:
            hub.publish_live_message(message)
    await yolo_results.flush_due()  # 새 result가 없어도 끝난 구간은 닫는다


async def run_yolo_tick(interval: float = TICK_SECONDS) -> None:
    while True:
        try:
            await tick_once()
        except Exception:  # 틱이 실패해도 서버는 계속 돌아야 한다
            logger.exception("YOLO 틱 실패")
        await asyncio.sleep(interval)


def start_yolo_tick() -> asyncio.Task:
    return asyncio.create_task(run_yolo_tick())
