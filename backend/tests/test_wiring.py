"""라우터와 공용 서비스가 mock/db 구현을 직접 import하지 않는지 검사한다.

테스트는 mock 모드로만 돌기 때문에, 라우터가 mock을 직접 부르면 DB 모드가 고장 나도 다른 테스트로는 잡히지 않는다.
그래서 코드 파일 내용을 읽어 import 경로를 직접 확인한다.
"""

import os
import pkgutil
import subprocess
import sys
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# mock/·db/ 구현을 직접 import해도 되는 곳은 services 바로 아래 입구 파일뿐이다.
FACADES = {"flights.py", "congestion.py", "stats.py", "weather.py", "facilities.py", "alerts.py", "yolo_store.py"}
# db 모드 전용 작업이라 db 구현을 직접 쓰는 파일
DB_ONLY = {"alert_worker.py"}

CHECK_FILES = [
    *sorted((APP_DIR / "routers").glob("*.py")),
    *sorted(p for p in (APP_DIR / "services").glob("*.py") if p.name not in FACADES | DB_ONLY),
    APP_DIR / "main.py",
    APP_DIR / "ws.py",
    APP_DIR / "ws_yolo.py",
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


_IMPORT_CHECK = '''
import importlib, sys
sys.path.insert(0, sys.argv[1])
import app.core.db as db

def _no_connection(*args, **kwargs):
    raise AssertionError("모듈 import 중에 DB 연결을 열려고 했습니다")

db._open_pool = _no_connection
for name in sys.argv[2:]:
    importlib.import_module(name)
assert db._pool is None, "모듈 import 후 연결 풀이 열려 있습니다"
'''


def test_db_modules_import_without_connecting():
    """DB 구현 모듈과 알림 워커가 문법·import 오류 없이 불러와지고, import만으로는 DB에 접속하지 않는다.

    테스트는 mock 모드로 돌아 DB 구현 파일을 import하지 않으므로, DATA_MODE=db인 별도 프로세스에서 확인한다.
    프로세스 안에서 연결 풀 생성을 막아 두어, import 시점에 접속하면 실패한다.
    """
    db_dir = APP_DIR / "services" / "db"
    modules = [f"app.services.db.{m.name}" for m in pkgutil.iter_modules([str(db_dir)])]
    modules.append("app.services.alert_worker")
    assert len(modules) > 1  # db/ 아래 모듈을 하나도 못 찾으면 검사가 의미 없다

    result = subprocess.run(
        [sys.executable, "-I", "-c", _IMPORT_CHECK, str(APP_DIR.parent), *modules],
        cwd=APP_DIR.parent,
        env={**os.environ, "DATA_MODE": "db"},
        check=False,  # 반환 코드는 아래에서 직접 검사해 stderr를 보여준다
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    assert result.returncode == 0, result.stderr[-1500:]
