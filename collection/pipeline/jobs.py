
"""ICN My Station - 7개 API 통합 실행기.

단계:
1. 공공 API 수집
2. 정규화
3. METAR 파싱
4. 정규화 결과 검증
5. PostgreSQL DRY RUN
6. --apply 지정 시 PostgreSQL UPSERT

사용법:
python -m collection.pipeline.jobs
python -m collection.pipeline.jobs --sources congestion_t1
python -m collection.pipeline.jobs --apply

기본 실행은 AWS RDS를 변경하지 않는다.
단, 실제 공공 API 호출과 로컬 JSON 파일 생성은 수행한다.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
COLLECTION_DIR = ROOT / "collection"

ALL_SOURCES = [
    "congestion_t1",
    "congestion_t2",
    "passenger_forecast",
    "flights",
    "metar",
    "takeoff_forecast",
    "facilities",
]


def run_module(module, *arguments):
    command = [
        sys.executable,
        "-m",
        f"collection.pipeline.{module}",
        *map(str, arguments),
    ]

    print(
        "\nRUN:",
        " ".join(command),
        flush=True,
    )

    subprocess.run(
        command,
        check=True,
        cwd=ROOT,
    )


def validate_output(sources):
    output_dir = COLLECTION_DIR / "normalized_final"
    summary = []

    for source in sources:
        path = output_dir / f"{source}.jsonl"

        if not path.is_file():
            raise FileNotFoundError(
                f"정규화 파일 없음: {path}"
            )

        count = 0

        with path.open(
            "r", encoding="utf-8-sig"
        ) as file:
            for line_number, line in enumerate(file, 1):
                if not line.strip():
                    continue

                try:
                    row = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"{path.name}:{line_number}: "
                        "JSON 파싱 오류"
                    ) from exc

                if not isinstance(row, dict):
                    raise ValueError(
                        f"{path.name}:{line_number}: "
                        "JSON 객체 아님"
                    )

                if source == "metar":
                    if (
                        row.get("metar_parsed") is not True
                        or not row.get("observed_at_utc")
                    ):
                        raise ValueError(
                            "METAR 파싱 결과가 유효하지 않습니다."
                        )

                count += 1

        if count == 0:
            raise ValueError(
                f"정규화 결과 0건: {source}"
            )

        print(f"[VALID] {source}: {count}건")

        summary.append({
            "source": source,
            "normalized_rows": count,
        })

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="ICN 7 API collection pipeline"
    )

    parser.add_argument(
        "--sources",
        nargs="+",
        choices=ALL_SOURCES,
        default=ALL_SOURCES,
    )

    parser.add_argument(
        "--max-requests",
        type=int,
        default=35,
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="DB 적재 시 API별 최대 건수",
    )

    parser.add_argument(
        "--apply",
        action="store_true",
        help="AWS RDS에 실제 UPSERT",
    )

    args = parser.parse_args()

    if args.max_requests < 1:
        parser.error(
            "--max-requests는 1 이상이어야 합니다."
        )

    if args.limit is not None and args.limit < 1:
        parser.error(
            "--limit은 1 이상이어야 합니다."
        )

    sources = list(dict.fromkeys(args.sources))

    print("\n=== 1. COLLECT ===")

    run_module(
        "batch_preview",
        "--sources",
        *sources,
        "--max-requests",
        args.max_requests,
    )

    print("\n=== 2. NORMALIZE ===")

    run_module(
        "normalize_all",
        "--sources",
        *sources,
    )

    if "metar" in sources:
        print("\n=== 3. METAR PARSING ===")

        run_module(
            "metar_parser"
        )

    print("\n=== 4. VALIDATE JSONL ===")

    summary = validate_output(sources)

    print("\n=== 5. POSTGRESQL ===")

    for source in sources:
        command_args = [
            "--source", source,
        ]

        if args.limit is not None:
            command_args += [
                "--limit", str(args.limit)
            ]

        if args.apply:
            command_args.append("--apply")

        run_module(
            "postgres_storage",
            *command_args,
        )

    print("\n=== FINAL SUMMARY ===")
    print(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        )
    )

    if args.apply:
        print("\nPIPELINE SUCCESS - AWS RDS UPDATED")
    else:
        print("\nPIPELINE SUCCESS - AWS RDS NOT MODIFIED")


if __name__ == "__main__":
    main()
