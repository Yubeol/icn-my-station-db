"""라우터와 공용 서비스가 mock/db 구현을 직접 import하지 않는지 검사한다.

테스트는 mock 모드로만 돌기 때문에, 라우터가 mock을 직접 부르면 DB 모드가 고장 나도 다른 테스트로는 잡히지 않는다.
그래서 코드 파일 내용을 읽어 import 경로를 직접 확인한다.
"""

from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# mock/·db/ 구현을 직접 import해도 되는 곳은 services 바로 아래 입구 파일뿐이다.
FACADES = {"flights.py", "congestion.py", "stats.py", "weather.py", "facilities.py", "alerts.py"}
# db 모드 전용 작업이라 db 구현을 직접 쓰는 파일
DB_ONLY = {"alert_worker.py"}

CHECK_FILES = [
    *sorted((APP_DIR / "routers").glob("*.py")),
    *sorted(p for p in (APP_DIR / "services").glob("*.py") if p.name not in FACADES | DB_ONLY),
    APP_DIR / "main.py",
    APP_DIR / "ws.py",
]


@pytest.mark.parametrize("path", CHECK_FILES, ids=lambda p: str(p.relative_to(APP_DIR)))
def test_no_direct_mock_or_db_import(path: Path):
    source = path.read_text(encoding="utf-8")
    for forbidden in ("app.services.mock", "app.services.db"):
        assert forbidden not in source, (
            f"{path.name}가 {forbidden}를 직접 import합니다. app.services 입구 파일을 쓰세요."
        )


@pytest.mark.parametrize("name", sorted(FACADES))
def test_facades_switch_on_data_mode(name: str):
    source = (APP_DIR / "services" / name).read_text(encoding="utf-8")
    assert "settings.data_mode" in source
    assert "app.services.db." in source and "app.services.mock." in source