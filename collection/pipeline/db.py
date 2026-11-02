
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    DateTime,
    JSON,
    Text,
    UniqueConstraint,
    ForeignKey,
)
from sqlalchemy.orm import declarative_base, sessionmaker


# ============================================================
# 테스트 전용 SQLite 설정
# 실제 AWS RDS PostgreSQL과 완전히 분리
# ============================================================

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
TEST_DB_PATH = PIPELINE_ROOT / "icn_test.sqlite3"

TEST_DATABASE_URL = (
    f"sqlite:///{TEST_DB_PATH.as_posix()}"
)

Base = declarative_base()


# ============================================================
# API 수집 실행 기록
# ============================================================

class CollectionRun(Base):
    __tablename__ = "api_collection_runs"

    id = Column(Integer, primary_key=True)
    api_id = Column(String(50), nullable=False, index=True)
    started_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )
    finished_at = Column(DateTime(timezone=True))
    success = Column(Integer, nullable=False, default=0)
    record_count = Column(Integer, default=0)
    error_message = Column(Text)


# ============================================================
# API 원본 응답 저장
# ============================================================

class RawResponse(Base):
    __tablename__ = "api_raw_responses"

    id = Column(Integer, primary_key=True)

    run_id = Column(
        Integer,
        ForeignKey("api_collection_runs.id"),
    )

    api_id = Column(
        String(50),
        nullable=False,
        index=True,
    )

    collected_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    http_status = Column(Integer)
    content_type = Column(String(100))
    raw_body = Column(Text, nullable=False)


# ============================================================
# 보안검색 혼잡도 테스트
# ============================================================

class CongestionSnapshot(Base):
    __tablename__ = "congestion_snapshots_test"

    id = Column(Integer, primary_key=True)

    terminal_code = Column(
        String(2),
        nullable=False,
    )

    hall_id = Column(
        String(30),
        nullable=False,
    )

    measured_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    waiting_count = Column(
        Integer,
        nullable=False,
    )

    data_origin = Column(
        String(20),
        nullable=False,
        default="api",
    )

    source_api = Column(
        String(50),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "terminal_code",
            "hall_id",
            "measured_at",
            "data_origin",
            name="uq_congestion_test",
        ),
    )


# ============================================================
# 항공편 테스트
# ============================================================

class FlightRecord(Base):
    __tablename__ = "flight_operations_test"

    id = Column(Integer, primary_key=True)

    flight_no = Column(
        String(30),
        nullable=False,
    )

    service_date = Column(
        String(10),
        nullable=False,
    )

    direction = Column(
        String(15),
        nullable=False,
    )

    status = Column(String(100))
    gate = Column(String(50))
    scheduled_at = Column(String(70))
    estimated_at = Column(String(70))

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "flight_no",
            "service_date",
            "direction",
            name="uq_flight_test",
        ),
    )


# ============================================================
# 항공편 변경 이력 테스트
# ============================================================

class FlightChange(Base):
    __tablename__ = "flight_operation_history_test"

    id = Column(Integer, primary_key=True)

    flight_no = Column(
        String(30),
        nullable=False,
    )

    service_date = Column(
        String(10),
        nullable=False,
    )

    direction = Column(
        String(15),
        nullable=False,
    )

    changed_at = Column(
        DateTime(timezone=True),
        nullable=False,
    )

    before_values = Column(JSON)
    after_values = Column(JSON)


# ============================================================
# 테스트 전용 DB 엔진
# ============================================================

engine = create_engine(
    TEST_DATABASE_URL,
    pool_pre_ping=True,
)

Session = sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


def init_db():
    """
    테스트용 SQLite 테이블만 생성한다.
    실제 AWS RDS에는 영향을 주지 않는다.
    """
    Base.metadata.create_all(engine)


def utcnow():
    return datetime.now(timezone.utc)
