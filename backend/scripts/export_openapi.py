"""docs/openapi.json을 현재 앱 기준으로 다시 만든다. backend 폴더에서 실행한다."""

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.main import app

OUTPUT = BACKEND_DIR.parent / "docs" / "openapi.json"


def main() -> None:
    OUTPUT.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
