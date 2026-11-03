from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    ws_push_interval_seconds: float = 5.0

    # 데이터 출처. mock: 가짜 데이터, db: 공유 RDS 조회. 기본값은 mock이다.
    data_mode: Literal["mock", "db"] = "mock"
    # db 모드에서 시연용(demo) 데이터를 조회에 포함할지. 평소에는 api·yolo만 쓴다.
    include_demo: bool = False

    # 스마트 알림 감지 주기(초). db 모드에서만 돈다.
    alert_scan_interval_seconds: float = 60.0
    # 감지한 알림을 공유 DB(smart_alerts)에 실제로 쓸지. 기본값은 False(감지만 하고 쓰지 않음).
    # DB 담당과 docs/db-write-contract.md를 확인한 뒤에만 True로 바꾼다.
    alert_write_enabled: bool = False

    # DB 접속 정보는 .env에서 읽는다 (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSLMODE)
    db_host: str | None = None
    db_port: int = 5432
    db_name: str | None = None
    db_user: str | None = None
    db_password: SecretStr | None = None
    db_sslmode: str = "require"

    def db_connect_kwargs(self) -> dict[str, str | int]:
        """psycopg.connect()에 넘길 인자. 필수 값이 없으면 값 없이 키 이름만 알려준다."""
        required = {
            "DB_HOST": self.db_host,
            "DB_NAME": self.db_name,
            "DB_USER": self.db_user,
            "DB_PASSWORD": self.db_password,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f".env에 값이 없습니다: {', '.join(missing)}")
        return {
            "host": self.db_host,
            "port": self.db_port,
            "dbname": self.db_name,
            "user": self.db_user,
            "password": self.db_password.get_secret_value(),
            "sslmode": self.db_sslmode,
        }

    def data_sources(self) -> list[str]:
        """조회에 포함할 데이터 출처(source 컬럼 값)."""
        sources = ["api", "yolo"]
        if self.include_demo:
            sources.append("demo")
        return sources


settings = Settings()