
"""시간 범위 기반 인천공항 출발 항공편 수집기.

현재 시각 기준 3시간 전부터 1시간 후까지 조회한다.
요청 예산 초과 시 수집한 페이지를 부분 저장하고 경고를 남긴다.
DB 저장은 수행하지 않는다.
"""

import argparse
import copy
import json
import math
import os

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .batch_preview import OUTPUT_DIR, normalize_one, response_rows
from .collector import fetch
from .sources import load_sources


KST = ZoneInfo("Asia/Seoul")


def make_window(now, before_minutes, after_minutes):
    """조회 범위를 당일 00:00~23:59 안에서 계산한다."""

    day_start = now.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    day_end = now.replace(
        hour=23,
        minute=59,
        second=0,
        microsecond=0,
    )

    start = max(
        now - timedelta(minutes=before_minutes),
        day_start,
    )

    end = min(
        now + timedelta(minutes=after_minutes),
        day_end,
    )

    if end < start:
        raise ValueError("Invalid flight search window")

    return (
        now.date().isoformat(),
        start.strftime("%H%M"),
        end.strftime("%H%M"),
    )


def atomic_json(path, data):
    """완성된 JSON 결과만 기존 파일에 반영한다."""

    tmp = path.with_suffix(path.suffix + ".tmp")

    tmp.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    os.replace(tmp, path)


def atomic_jsonl(path, records):
    """JSONL을 임시 파일에 기록한 후 교체한다."""

    tmp = path.with_suffix(path.suffix + ".tmp")

    with tmp.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(
                json.dumps(
                    record,
                    ensure_ascii=False,
                ) + "\n"
            )

    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(
        description="Time-windowed departure flight collector"
    )

    parser.add_argument(
        "--max-requests",
        type=int,
        default=3,
    )

    parser.add_argument(
        "--before-minutes",
        type=int,
        default=180,
    )

    parser.add_argument(
        "--after-minutes",
        type=int,
        default=60,
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_DIR,
    )

    args = parser.parse_args()

    if (
        args.max_requests < 1
        or args.before_minutes < 0
        or args.after_minutes < 0
    ):
        parser.error(
            "Request count must be positive "
            "and window lengths non-negative"
        )

    now = datetime.now(KST)

    date, start, end = make_window(
        now,
        args.before_minutes,
        args.after_minutes,
    )

    source = copy.deepcopy(
        load_sources()["flights"]
    )

    source["params"].update({
        "searchFrom": start,
        "searchTo": end,
        "searchdtCode": "S",
        "numOfRows": 100,
    })

    per_page = int(
        source["params"].get("numOfRows", 100)
    )

    if per_page < 1:
        raise ValueError("Invalid page size")

    rows = []
    expected_total = None
    expected_pages = None

    for page in range(1, args.max_requests + 1):
        source["params"]["pageNo"] = page

        body, status, _ = fetch(
            source,
            mode="live",
            date_value=date,
        )

        if status != 200:
            raise RuntimeError(
                f"flights: HTTP {status}"
            )

        page_rows, total = response_rows(
            body,
            "flights",
        )

        if expected_total is None:
            expected_total = total

            expected_pages = max(
                1,
                math.ceil(total / per_page),
            )

            if expected_pages > args.max_requests:
                print(
                    "WARNING: FLIGHT_PARTIAL "
                    f"pages_required={expected_pages} "
                    f"page_budget={args.max_requests} "
                    f"total={expected_total}",
                    flush=True,
                )

        elif total != expected_total:
            print(
                "WARNING: FLIGHT_TOTAL_CHANGED "
                f"initial={expected_total} "
                f"current={total}",
                flush=True,
            )

        if expected_total > 0 and not page_rows:
            raise RuntimeError(
                "FLIGHT_EMPTY_PAGE: pagination incomplete"
            )

        rows.extend(page_rows)

        print(
            f"flights: {page}/{expected_pages} pages, "
            f"{len(rows)} rows",
            flush=True,
        )

        if page >= expected_pages:
            break

    if not rows:
        raise RuntimeError(
            "FLIGHT_NO_ROWS: nothing to save"
        )

    partial = len(rows) != expected_total

    if partial:
        print(
            "WARNING: FLIGHT_PARTIAL "
            f"collected={len(rows)} "
            f"total={expected_total} "
            f"missing={max(0, expected_total - len(rows))}",
            flush=True,
        )

    args.output.mkdir(
        parents=True,
        exist_ok=True,
    )

    atomic_json(
        args.output / "flights_raw.json",
        rows,
    )

    atomic_jsonl(
        args.output / "flights_preview.jsonl",
        [
            normalize_one("flights", item)
            for item in rows
        ],
    )

    atomic_json(
        args.output / "summary.json",
        [{
            "source": "flights",
            "rows": len(rows),
            "totalCount": expected_total,
            "pages": min(
                expected_pages,
                args.max_requests,
            ),
            "total_pages": expected_pages,
            "partial": partial,
            "window_date": date,
            "searchFrom": start,
            "searchTo": end,
        }],
    )

    print(
        "DONE: flights "
        f"requests={min(expected_pages, args.max_requests)} "
        f"rows={len(rows)} "
        f"partial={partial} "
        f"window={date} {start}-{end}",
        flush=True,
    )


if __name__ == "__main__":
    main()
