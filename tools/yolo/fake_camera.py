"""테스트용 가짜 카메라. 웹캠 또는 이미지 파일을 읽어 /ws/yolo/camera로 보낸다. (앱 대체 송출용으로도 쓴다)

설치(backend와 별도): pip install -r tools/yolo/requirements.txt

예)
    python tools/yolo/fake_camera.py --url ws://localhost:8000 --camera-id 1 --source 0 --fps 5
    python tools/yolo/fake_camera.py --url wss://example.com --source sample.jpg --token ...
    python tools/yolo/fake_camera.py --list-cameras     # 열리는 웹캠 번호 확인(0~5)

토큰은 --token 또는 환경변수 YOLO_CAMERA_TOKEN으로 준다. 토큰과 프레임은 출력하지 않는다.
프레임은 메모리에서 바로 보내고 디스크·로그에 남기지 않는다.
"""

import argparse
import asyncio
import json
import os
import struct
import sys
import time
from urllib.parse import urlencode

MAX_RECONNECT_DELAY = 4.0
NO_RETRY_CODES = {4401, 4404}  # 토큰 오류, 등록되지 않은 cameraId는 다시 시도해도 같다


def build_frame(
    camera_id: int, frame_id: int, captured_ms: int, width: int, height: int, jpeg: bytes
) -> bytes:
    """계약 1.2 바이너리 프레임: 4바이트 헤더 길이(big-endian) + 헤더 JSON + JPEG."""
    header = json.dumps(
        {
            "cameraId": camera_id,
            "frameId": frame_id,
            "capturedAt": captured_ms,
            "width": width,
            "height": height,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return struct.pack(">I", len(header)) + header + jpeg


def camera_url(base: str, camera_id: int, token: str) -> str:
    query = urlencode({"cameraId": camera_id, "token": token})
    return f"{base.rstrip('/')}/ws/yolo/camera?{query}"


MAX_CAMERA_INDEX = 5  # --list-cameras가 확인하는 번호: 0~5


def open_webcam(index: int):
    """웹캠을 연다. Windows에서는 DirectShow(CAP_DSHOW)로 먼저 열고, 안 열리면 기본 방식으로 다시 시도한다.

    (VideoCapture, 사용한 방식 이름)을 돌려준다. 어느 쪽으로도 안 열리면 (None, None).
    """
    import cv2  # tools/yolo/requirements.txt에만 있는 의존성

    attempts = []
    if sys.platform == "win32":
        attempts.append(("DSHOW", lambda: cv2.VideoCapture(index, cv2.CAP_DSHOW)))
    attempts.append(("기본", lambda: cv2.VideoCapture(index)))
    for name, make in attempts:
        capture = make()
        if capture.isOpened():
            return capture, name
        capture.release()
    return None, None


def list_cameras(out=print) -> list[int]:
    """0~5번 웹캠을 열어 보고 열리는 번호를 출력한다. 열린 번호 목록을 돌려준다."""
    import cv2

    try:  # 열리지 않는 번호마다 OpenCV가 경고를 쏟아내므로 조용히 만든다(없으면 그대로 둔다)
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
    except AttributeError:
        pass
    found = []
    for index in range(MAX_CAMERA_INDEX + 1):
        capture, method = open_webcam(index)
        if capture is None:
            out(f"{index}번: 열리지 않음")
            continue
        width = int(capture.get(3))  # cv2.CAP_PROP_FRAME_WIDTH
        height = int(capture.get(4))  # cv2.CAP_PROP_FRAME_HEIGHT
        capture.release()
        found.append(index)
        out(f"{index}번: 열림 ({method}, {width}x{height})")
    if found:
        out(f"사용할 수 있는 번호: {', '.join(map(str, found))}  →  --source {found[0]}")
    else:
        out("열리는 웹캠이 없습니다. 다른 프로그램이 카메라를 쓰고 있지 않은지 확인하세요.")
    return found


class FrameSource:
    """웹캠(숫자) 또는 이미지 파일에서 JPEG 한 장씩 만든다."""

    def __init__(self, source: str, width: int, height: int, quality: int):
        import cv2  # tools/yolo/requirements.txt에만 있는 의존성

        self.cv2 = cv2
        self.width, self.height, self.quality = width, height, quality
        self.capture = None
        self.image = None
        if source.isdigit():
            self.capture, method = open_webcam(int(source))
            if self.capture is None:
                raise SystemExit(
                    f"웹캠 {source}번을 열 수 없습니다. --list-cameras로 열리는 번호를 확인하세요."
                )
            print(f"웹캠 {source}번 열림 ({method})")
        else:
            self.image = cv2.imread(source)
            if self.image is None:
                raise SystemExit(f"이미지를 읽을 수 없습니다: {source}")

    def next_jpeg(self) -> bytes | None:
        cv2 = self.cv2
        if self.capture is not None:
            ok, image = self.capture.read()
            if not ok:
                return None
        else:
            image = self.image
        image = cv2.resize(image, (self.width, self.height))
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
        return encoded.tobytes() if ok else None

    def close(self) -> None:
        if self.capture is not None:
            self.capture.release()


async def stream(ws, args, source: FrameSource) -> None:
    hello = json.loads(await ws.recv())
    fps = min(args.fps, float(hello.get("maxFps", args.fps)))
    print(f"연결됨: cameraId={hello.get('cameraId')} 송출 {fps:g}fps")
    frame_id = 0  # 연결마다 1부터 1씩 증가
    interval = 1.0 / fps
    next_at = time.monotonic()
    while True:
        jpeg = await asyncio.to_thread(source.next_jpeg)
        if jpeg is not None:
            frame_id += 1
            captured = int(time.time() * 1000)
            await ws.send(
                build_frame(args.camera_id, frame_id, captured, args.width, args.height, jpeg)
            )
        next_at += interval
        await asyncio.sleep(max(0.0, next_at - time.monotonic()))


async def run(args) -> None:
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed

    token = args.token or os.environ.get("YOLO_CAMERA_TOKEN", "")
    source = FrameSource(args.source, args.width, args.height, args.quality)
    url = camera_url(args.url, args.camera_id, token)
    delay = 1.0
    try:
        while True:
            try:
                async with connect(url, max_size=None) as ws:
                    delay = 1.0
                    await stream(ws, args, source)
            except ConnectionClosed as closed:
                code = closed.rcvd.code if closed.rcvd else None
                print(f"연결이 닫혔습니다 (code={code})")
                if code in NO_RETRY_CODES:
                    return
            except OSError as error:
                print(f"연결 실패: {error}")
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT_DELAY)
    finally:
        source.close()


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="가짜 카메라: 웹캠/이미지를 /ws/yolo/camera로 송출")
    p.add_argument("--url", default="ws://localhost:8000", help="서버 주소 (ws:// 또는 wss://)")
    p.add_argument("--camera-id", type=int, default=1, help="demo_yolo_cameras.camera_id (정수)")
    p.add_argument("--token", default=None, help="기본값: 환경변수 YOLO_CAMERA_TOKEN")
    p.add_argument("--fps", type=float, default=5.0, help="송출 fps (서버 maxFps를 넘지 않음)")
    p.add_argument("--source", default="0", help="웹캠 번호(0, 1, ...) 또는 이미지 파일 경로")
    p.add_argument(
        "--list-cameras",
        action="store_true",
        help="웹캠 0~5번을 열어 보고 열리는 번호를 출력한 뒤 종료",
    )
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=360)
    p.add_argument("--quality", type=int, default=65, help="JPEG 품질 1~100 (계약 권장 0.65)")
    return p.parse_args(argv)


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.list_cameras:
        list_cameras()
        sys.exit(0)
    try:
        asyncio.run(run(arguments))
    except KeyboardInterrupt:
        pass
