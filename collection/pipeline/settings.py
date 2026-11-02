
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.engine import URL

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(PROJECT_ROOT / ".env", override=False)
load_dotenv(PIPELINE_ROOT / ".env", override=False)


def env(name: str, default: str = "") -> str:
    if not name:
        return default
    return os.getenv(name, default)



def database_url():
    explicit_url = env("DATABASE_URL")
    if explicit_url:
        return explicit_url

    if env("DB_HOST"):
        return URL.create(
            drivername="postgresql+psycopg",
            username=env("DB_USER"),
            password=env("DB_PASSWORD"),
            host=env("DB_HOST"),
            port=int(env("DB_PORT", "5432")),
            database=env("DB_NAME"),
            query={
                "sslmode": env("DB_SSLMODE", "require")
            },
        )

    return "sqlite:///./icn_test.sqlite3"



def run_mode() -> str:
    return env("RUN_MODE", "mock")
