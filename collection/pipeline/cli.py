
import argparse
import json

from datetime import date, timedelta

from sqlalchemy import select, func

from .settings import env
from .db import (
    init_db,
    Session,
    CollectionRun,
    RawResponse,
    CongestionSnapshot,
    FlightRecord,
)
from .sources import load_sources
from .storage import collect_one


def main():
    parser = argparse.ArgumentParser(
        description="ICN Airport API Collection CLI"
    )

    parser.add_argument(
        "command",
        choices=[
            "list",
            "init-db",
            "test",
            "test-all",
            "backfill-flights",
            "run",
            "status",
        ],
    )

    parser.add_argument(
        "--source",
        help="API ID",
    )

    parser.add_argument(
        "--date",
        help="YYYY-MM-DD",
    )

    parser.add_argument(
        "--mode",
        choices=["mock", "live"],
        default=None,
    )

    parser.add_argument(
        "--confirm-live-schedule",
        action="store_true",
    )

    args = parser.parse_args()

    sources = load_sources()
    mode = args.mode or env("RUN_MODE", "mock")

    # ========================================================
    # API 목록 조회
    # ========================================================

    if args.command == "list":
        for source in sources.values():
            print(
                source["id"],
                source["kind"],
                "enabled=" + str(source["enabled"]),
                "every="
                + str(source["interval_minutes"])
                + "m",
            )
        return

    # ========================================================
    # 테스트 전용 SQLite 초기화
    # ========================================================

    init_db()

    if args.command == "init-db":
        print("TEST SQLITE DATABASE INITIALIZED")
        print("AWS RDS DATABASE WAS NOT MODIFIED")
        return

    # ========================================================
    # 단일 API 테스트 / 전체 API 테스트
    # ========================================================

    if args.command in ("test", "test-all"):

        if (
            args.command == "test"
            and args.source not in sources
        ):
            parser.error(
                "--source 에 올바른 API ID를 입력하세요."
            )

        if args.command == "test":
            selected = [sources[args.source]]
        else:
            selected = list(sources.values())

        for source in selected:
            result = collect_one(
                source,
                mode,
                args.date,
            )

            print(
                json.dumps(
                    result,
                    ensure_ascii=False,
                )
            )

        return

    # ========================================================
    # 항공편 과거 데이터 수집
    # ========================================================

    if args.command == "backfill-flights":

        if mode != "live":
            print(
                "WARNING: MOCK MODE - "
                "실제 과거 항공편 데이터는 조회하지 않습니다."
            )

        source = sources["flights"]

        start_date = (
            date.fromisoformat(args.date)
            if args.date
            else date.today()
        )

        for i in range(3, -1, -1):
            target_date = (
                start_date - timedelta(days=i)
            ).isoformat()

            result = collect_one(
                source,
                mode,
                target_date,
            )

            print(
                json.dumps(
                    result,
                    ensure_ascii=False,
                )
            )

        return

    # ========================================================
    # 테스트 DB 저장 상태 조회
    # ========================================================

    if args.command == "status":

        with Session() as db:

            models = [
                CollectionRun,
                RawResponse,
                CongestionSnapshot,
                FlightRecord,
            ]

            for model in models:
                count = db.scalar(
                    select(func.count()).select_from(model)
                )

                print(
                    model.__tablename__,
                    count,
                )

            for source_id in sources:

                row = db.execute(
                    select(CollectionRun)
                    .where(
                        CollectionRun.api_id == source_id
                    )
                    .order_by(
                        CollectionRun.id.desc()
                    )
                    .limit(1)
                ).scalar_one_or_none()

                latest = (
                    (
                        row.finished_at,
                        row.success,
                        row.error_message,
                    )
                    if row
                    else "none"
                )

                print(
                    source_id,
                    "latest:",
                    latest,
                )

        return

    # ========================================================
    # 반복 수집 스케줄
    # ========================================================

    if args.command == "run":

        if (
            mode == "live"
            and not args.confirm_live_schedule
        ):
            parser.error(
                "실제 자동수집은 "
                "--confirm-live-schedule 지정이 필요합니다."
            )

        from apscheduler.schedulers.blocking import (
            BlockingScheduler,
        )
        from zoneinfo import ZoneInfo

        scheduler = BlockingScheduler(
            timezone=ZoneInfo("Asia/Seoul")
        )

        enabled_sources = [
            source
            for source in sources.values()
            if (
                (mode == "mock" or source.get("enabled"))
                and source["interval_minutes"] > 0
            )
        ]

        for source in enabled_sources:

            scheduler.add_job(
                collect_one,
                "interval",
                minutes=source["interval_minutes"],
                args=[source, mode],
                id=source["id"],
                max_instances=1,
                coalesce=True,
                misfire_grace_time=45,
            )

        print(
            "SCHEDULER STARTED",
            "MODE:",
            mode,
            "SOURCES:",
            [s["id"] for s in enabled_sources],
            flush=True,
        )

        for source in enabled_sources:
            print(
                collect_one(source, mode),
                flush=True,
            )

        scheduler.start()


if __name__ == "__main__":
    main()
