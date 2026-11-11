"""테스트용 가짜 워커. /ws/yolo/worker에 붙어 프레임을 받으면 가짜 result를 돌려준다. 추론은 하지 않는다.

설치(backend와 별도): pip install -r tools/yolo/requirements.txt

예)
    python tools/yolo/fake_worker.py --url ws://localhost:8000
    python tools/yolo/fake_worker.py --url ws://localhost:8000 --gesture --gesture-interval 20
    python tools/yolo/fake_worker.py --url ws://localhost:8000 --gesture --event-type FINGER_GUN

--gesture를 주면 일정 간격으로 result의 events에 제스처 이벤트를 넣는다.
종류는 --event-type으로 고른다: HELP_GESTURE(기본, 박스 cls help_gesture), FINGER_GUN(박스 cls finger_gun).
토큰은 --token 또는 환경변수 YOLO_WORKER_TOKEN으로 준다. 토큰과 프레임은 출력하지 않는다.
받은 프레임은 헤더만 읽고 버린다. 디스크·로그에 남기지 않는다.
"""

import argparse
import asyncio
import json
import os
import random
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

KST = timezone(timedelta(hours=9))
MAX_RECONNECT_DELAY = 4.0
NO_RETRY_CODES = {4401}
# 이벤트 종류 → 같은 제스처를 나타내는 박스 클래스 (계약 v0.4)
GESTURE_CLASSES = {"HELP_GESTURE": "help_gesture", "FINGER_GUN": "finger_gun"}
MAX_PERSON_COUNT = 14  # 0~14명 (LOW·MID·HIGH가 모두 나오도록)


def parse_header(frame: bytes) -> dict | None:
    """프레임 앞의 헤더 JSON만 읽는다. JPEG은 열지 않는다."""
    if len(frame) < 5:
        return None
    (size,) = struct.unpack(">I", frame[:4])
    if size == 0 or 4 + size > len(frame):
        return None
    try:
        header = json.loads(frame[4 : 4 + size].decode("utf-8"))
    except ValueError:
        return None
    return header if isinstance(header, dict) else None


def _box(rng: random.Random) -> list[float]:
    x1, y1 = rng.uniform(0.05, 0.6), rng.uniform(0.05, 0.5)
    w, h = rng.uniform(0.1, 0.3), rng.uniform(0.2, 0.45)
    return [round(x1, 3), round(y1, 3), round(min(x1 + w, 1.0), 3), round(min(y1 + h, 1.0), 3)]


def make_result(
    header: dict,
    rng: random.Random,
    gesture: bool = False,
    now: datetime | None = None,
    event_type: str = "HELP_GESTURE",
) -> dict:
    """프레임 헤더에 대한 가짜 result (계약 3장). 박스 1~2개, personCount는 랜덤.

    gesture면 제스처 박스와 event_type 이벤트를 하나 더 넣는다. 박스 cls는 이벤트 종류와 맞춘다.
    """
    now = now or datetime.now(KST)
    detections = []
    for track_id in range(1, rng.randint(1, 2) + 1):
        cls = rng.choice(["person", "head"])
        detections.append(
            {
                "cls": cls,
                "conf": round(rng.uniform(0.6, 0.97), 2),
                "box": _box(rng),
                "trackId": track_id,
            }
        )
    events = []
    if gesture:
        track_id = detections[0]["trackId"]
        confidence = round(rng.uniform(0.7, 0.95), 2)
        detections.append(
            {
                "cls": GESTURE_CLASSES[event_type],
                "conf": confidence,
                "box": _box(rng),
                "trackId": track_id,
            }
        )
        events.append(
            {
                "eventType": event_type,
                "trackId": track_id,
                "confidence": confidence,
                "detectedAt": now.isoformat(timespec="milliseconds"),
            }
        )
    return {
        "type": "result",
        "cameraId": header["cameraId"],
        "frameId": header["frameId"],
        "capturedAt": header.get("capturedAt"),
        "inferMs": round(rng.uniform(20, 60), 1),
        "personCount": rng.randint(0, MAX_PERSON_COUNT),
        "detections": detections,
        "events": events,
    }


def worker_url(base: str, token: str) -> str:
    return f"{base.rstrip('/')}/ws/yolo/worker?{urlencode({'token': token})}"


async def serve(ws, args, rng: random.Random) -> None:
    await ws.send(
        json.dumps(
            {
                "type": "hello",
                "workerId": args.worker_id,
                "modelVersion": args.model_version,
                "classes": ["person", "finger_gun"]
                if args.event_type == "FINGER_GUN"
                else ["person", "head", "help_gesture"],
            }
        )
    )
    print("연결됨: 프레임을 기다립니다")
    last_gesture = time.monotonic()
    async for message in ws:
        if not isinstance(message, bytes):
            continue
        header = parse_header(message)
        if header is None:
            await ws.send(
                json.dumps(
                    {"type": "error", "frameId": 0, "code": "BAD_FRAME", "message": "header"}
                )
            )
            continue
        due = args.gesture and time.monotonic() - last_gesture >= args.gesture_interval
        if due:
            last_gesture = time.monotonic()
        if args.delay_ms:
            await asyncio.sleep(args.delay_ms / 1000)
        await ws.send(json.dumps(make_result(header, rng, gesture=due, event_type=args.event_type)))


async def run(args) -> None:
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed

    token = args.token or os.environ.get("YOLO_WORKER_TOKEN", "")
    url = worker_url(args.url, token)
    rng = random.Random(args.seed)
    delay = 1.0
    while True:
        try:
            async with connect(url, max_size=None) as ws:
                delay = 1.0
                await serve(ws, args, rng)
        except ConnectionClosed as closed:
            code = closed.rcvd.code if closed.rcvd else None
            print(f"연결이 닫혔습니다 (code={code})")
            if code in NO_RETRY_CODES:
                return
        except OSError as error:
            print(f"연결 실패: {error}")
        await asyncio.sleep(delay)
        delay = min(delay * 2, MAX_RECONNECT_DELAY)


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="가짜 워커: 프레임마다 가짜 result를 돌려준다")
    p.add_argument("--url", default="ws://localhost:8000", help="서버 주소 (ws:// 또는 wss://)")
    p.add_argument("--token", default=None, help="기본값: 환경변수 YOLO_WORKER_TOKEN")
    p.add_argument("--gesture", action="store_true", help="일정 간격으로 제스처 이벤트를 넣는다")
    p.add_argument(
        "--event-type",
        choices=sorted(GESTURE_CLASSES),
        default="HELP_GESTURE",
        help="--gesture로 넣는 이벤트 종류. FINGER_GUN이면 박스 cls도 finger_gun (기본 HELP_GESTURE)",
    )
    p.add_argument("--gesture-interval", type=float, default=15.0, help="제스처 이벤트 간격(초)")
    p.add_argument("--delay-ms", type=int, default=0, help="추론 시간 흉내(밀리초)")
    p.add_argument("--worker-id", default="fake-worker")
    p.add_argument("--model-version", default="fake-v0")
    p.add_argument("--seed", type=int, default=None)
    return p.parse_args(argv)


if __name__ == "__main__":
    try:
        asyncio.run(run(parse_args()))
    except KeyboardInterrupt:
        pass
