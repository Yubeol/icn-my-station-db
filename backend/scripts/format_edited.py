"""Claude Code 훅용. 방금 수정한 backend의 Python 파일 하나만 포맷하고 린트를 고친다.

표준 입력으로 받은 훅 JSON의 tool_input.file_path를 쓴다. backend 밖의 파일이나
Python이 아닌 파일은 건드리지 않는다. 포맷 실패가 작업을 멈추지 않도록 항상 0으로 끝낸다.
"""

import json
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def target_path() -> Path | None:
    try:
        payload = json.load(sys.stdin)
        raw = payload["tool_input"]["file_path"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = Path(payload.get("cwd") or ".") / path
    path = path.resolve()
    if path.suffix != ".py" or not path.is_relative_to(BACKEND_DIR) or not path.is_file():
        return None
    return path


def main() -> int:
    path = target_path()
    if path is None:
        return 0
    for command in (["ruff", "format", str(path)], ["ruff", "check", "--fix", str(path)]):
        subprocess.run(command, cwd=BACKEND_DIR, check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
