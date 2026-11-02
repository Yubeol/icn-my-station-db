import os

# 테스트는 항상 mock 데이터로 돈다. .env에 DATA_MODE=db가 있어도 공유 DB에 접속하지 않게 앱 import 전에 고정한다.
os.environ["DATA_MODE"] = "mock"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)