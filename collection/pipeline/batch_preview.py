
"""7개 API 전체 수집 및 DB 저장 전 정규화 미리보기.

실제 AWS RDS에는 데이터를 저장하지 않는다.
실행 예:
uv run python -m api_pipeline.pipeline.batch_preview --sources congestion_t1
"""

import argparse
import copy
import json
import math
import re
import time

from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .collector import fetch
from .sources import load_sources


KST = ZoneInfo("Asia/Seoul")

OUTPUT_DIR = (
    Path(__file__).resolve().parents[1]
    / "normalized_output"
)

PAGED_SOURCES = {"flights", "facilities"}


# ============================================================
# 공통 데이터 변환
# ============================================================

def number(value):
    if value is None or str(value).strip() in ("", "-", "None"):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def integer(value):
    n = number(value)

    if n is not None and n.is_integer():
        return int(n)

    return None


def when(value, tz=KST):
    if value is None or str(value).strip() == "":
        return None

    raw = str(value).strip()

    try:
        if raw.isdigit() and len(raw) in (12, 14):
            fmt = (
                "%Y%m%d%H%M"
                if len(raw) == 12
                else "%Y%m%d%H%M%S"
            )
            dt = datetime.strptime(raw, fmt)
        else:
            dt = datetime.fromisoformat(
                raw.replace("Z", "+00:00")
            )

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tz)

        return dt.astimezone(timezone.utc).isoformat()

    except ValueError:
        return None


# ============================================================
# API 응답에서 실제 데이터 추출
# ============================================================

def response_rows(body, source_id):
    doc = json.loads(body)

    # METAR는 별도 JSON + IWXXM XML 구조
    if source_id == "metar":
        return [doc], 1

    if not isinstance(doc, dict):
        raise ValueError(
            f"{source_id}: JSON 응답 객체가 아닙니다."
        )

    response = doc.get("response")

    if not isinstance(response, dict):
        raise ValueError(
            f"{source_id}: response 필드 누락"
        )

    header = response.get("header") or {}

    if not isinstance(header, dict):
        raise ValueError("잘못된 API header")

    code = header.get("resultCode")

    if code is not None and str(code).strip() not in (
        "00", "0"
    ):
        raise ValueError(
            f"{source_id}: API 오류 코드 {code}"
        )

    body_obj = response.get("body") or {}

    if not isinstance(body_obj, dict):
        raise ValueError("잘못된 API body")

    items = body_obj.get("items", [])

    if isinstance(items, dict):
        items = items.get("item", items)

    if items is None:
        items = []

    if isinstance(items, dict):
        items = [items]

    if not isinstance(items, list):
        raise ValueError(
            f"{source_id}: items 배열 형식 오류"
        )

    flattened = []

    for item in items:
        if isinstance(item, dict) and "item" in item:
            inner = item["item"]

            flattened.extend(
                inner if isinstance(inner, list)
                else [inner]
            )
        else:
            flattened.append(item)

    total = integer(body_obj.get("totalCount"))

    return (
        flattened,
        len(flattened) if total is None else total
    )


# ============================================================
# 7개 API 정규화 미리보기
# ============================================================

def normalize_one(source_id, item):

    if not isinstance(item, dict):
        return {
            "source": source_id,
            "raw": item,
        }

    # 원본 데이터를 보존하여 매핑 손실 방지
    row = {
        "source": source_id,
        "raw": item,
    }

    # --------------------------------------------------------
    # 1~2. T1 / T2 보안검색 혼잡도
    # --------------------------------------------------------

    if source_id in (
        "congestion_t1",
        "congestion_t2",
    ):
        waiting = integer(item.get("waitLength"))

        if waiting is not None and waiting < 0:
            raise ValueError("대기인원이 음수입니다.")

        wait_raw = item.get("waitTime")

        row.update(
            terminal_code=(
                "T1"
                if source_id == "congestion_t1"
                else "T2"
            ),
            hall_id=item.get("gateId"),
            source_terminal_id=item.get("terminalId"),
            measured_at_utc=when(
                item.get("occurtime")
            ),
            waiting_passenger_count=waiting,
            waiting_minutes=(
                None
                if str(wait_raw).strip() == "60+"
                else number(wait_raw)
            ),
            waiting_minutes_over_60=(
                str(wait_raw).strip() == "60+"
            ),
            operating_time_raw=item.get(
                "operatingTime"
            ),
        )

    # --------------------------------------------------------
    # 3. 항공편 운항 정보
    # --------------------------------------------------------

    elif source_id == "flights":

        terminal = item.get("terminalId")

        row.update(
            source_flight_id=item.get("fid"),
            flight_number=item.get("flightId"),
            master_flight_number=item.get(
                "masterFlightId"
            ),
            codeshare_raw=item.get("codeshare"),
            terminal_raw=terminal,
            terminal_code={
                "P01": "T1",
                "P02": "CONCOURSE_T1",
                "P03": "T2",
            }.get(terminal),
            scheduled_at_utc=when(
                item.get("scheduleDatetime")
            ),
            estimated_at_utc=when(
                item.get("estimatedDatetime")
            ),
            status_raw=item.get("remark"),
            gate=item.get("gateNumber"),
            check_in_counter=item.get("chkinRange"),
            airport_code=item.get("airportCode"),
        )

    # --------------------------------------------------------
    # 4. 공항 편의시설
    # --------------------------------------------------------

    elif source_id == "facilities":

        row.update(
            facility_name=item.get("entrpskoreannm"),
            service_description=item.get(
                "trtmntprdlstkoreannm"
            ),
            location_description=item.get(
                "lckoreannm"
            ),
            arrival_departure_area=item.get(
                "arrordep"
            ),
            opening_hours_note=item.get(
                "servicetime"
            ),
            phone_number=item.get("tel"),
            terminal_code=None,
        )

    # --------------------------------------------------------
    # 5. 이륙 기상 예보
    # --------------------------------------------------------

    elif source_id == "takeoff_forecast":

        wind_kt = number(item.get("ws"))
        pressure = number(item.get("qnh"))

        row.update(
            airport_icao=item.get("icaoCode"),
            valid_at_utc=when(
                item.get("tmFc"),
                timezone.utc,
            ),
            issued_at_utc=None,
            wind_direction_degrees=number(
                item.get("wd")
            ),
            wind_speed_mps=(
                round(wind_kt * 0.514444, 3)
                if wind_kt is not None
                else None
            ),
            temperature_c=number(
                item.get("ta")
            ),
            pressure_hpa=(
                round(
                    pressure / 100 * 33.8638866667,
                    3,
                )
                if pressure is not None
                else None
            ),
        )

    # --------------------------------------------------------
    # 6. 시간대별 여객 예고
    # --------------------------------------------------------

    elif source_id == "passenger_forecast":

        row.update(
            target_date_raw=item.get("adate"),
            time_slot=item.get("atime"),
        )

        for field, val in item.items():

            if re.fullmatch(
                r"t[12]dg\d+",
                field,
                re.IGNORECASE,
            ):
                row[field.lower()] = integer(val)

    # --------------------------------------------------------
    # 7. METAR 공항 기상
    # --------------------------------------------------------

    elif source_id == "metar":

        msg = item.get("metarMsg")

        if isinstance(msg, dict):
            msg = (
                msg.get("metarMsg")
                or msg.get("message")
            )

        row.update(
            airport_icao="RKSI",
            metar_xml=msg,
            metar_parsed=False,
        )

    return row


# ============================================================
# 전체 페이지 수집
# ============================================================

def collect_all(
    source,
    day,
    max_requests,
    request_counter,
    delay,
):
    source_id = source["id"]

    page = 1
    expected_pages = None
    total = None
    rows = []

    while (
        expected_pages is None
        or page <= expected_pages
    ):

        if request_counter[0] >= max_requests:
            raise RuntimeError(
                f"API 호출 제한 {max_requests}회 도달"
            )

        target = copy.deepcopy(source)
        target.setdefault("params", {})["pageNo"] = page

        response, status, _ = fetch(
            target,
            mode="live",
            date_value=day,
        )

        request_counter[0] += 1

        page_rows, page_total = response_rows(
            response,
            source_id,
        )

        if total is None:
            total = page_total

            per_page = int(
                target["params"].get(
                    "numOfRows", 100
                )
            )

            expected_pages = (
                max(
                    1,
                    math.ceil(total / per_page),
                )
                if source_id in PAGED_SOURCES
                else 1
            )

        if status != 200:
            raise RuntimeError(
                f"{source_id}: HTTP {status}"
            )

        if total > 0 and not page_rows:
            raise RuntimeError(
                f"{source_id}: 데이터 누락 "
                f"(totalCount={total})"
            )

        rows.extend(page_rows)

        print(
            f"{source_id}: "
            f"{page}/{expected_pages} 페이지, "
            f"현재 {len(rows)}건",
            flush=True,
        )

        page += 1

        if page <= expected_pages:
            time.sleep(max(delay, 0.0))

    if (
        source_id in PAGED_SOURCES
        and len(rows) != total
    ):
        raise RuntimeError(
            f"{source_id}: "
            f"전체 수집 불완전 "
            f"{len(rows)}/{total}"
        )

    return rows, total, expected_pages


# ============================================================
# 메인 실행
# ============================================================

def main():

    sources = load_sources()

    parser = argparse.ArgumentParser(
        description="ICN 7 API 통합 수집 미리보기"
    )

    parser.add_argument(
        "--sources",
        nargs="+",
        default=["congestion_t1"],
        choices=list(sources),
    )

    parser.add_argument(
        "--date",
        default=datetime.now(KST).date().isoformat(),
    )

    parser.add_argument(
        "--max-requests",
        type=int,
        default=30,
    )

    parser.add_argument(
        "--delay",
        type=float,
        default=0.35,
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_DIR,
    )

    args = parser.parse_args()

    if args.max_requests < 1:
        parser.error(
            "--max-requests must be positive"
        )

    args.output.mkdir(
        parents=True,
        exist_ok=True,
    )

    request_counter = [0]
    summary = []

    for source_id in args.sources:

        rows, total, pages = collect_all(
            sources[source_id],
            args.date,
            args.max_requests,
            request_counter,
            args.delay,
        )

        previews = [
            normalize_one(source_id, item)
            for item in rows
        ]

        # 원본 보관
        raw_path = (
            args.output / f"{source_id}_raw.json"
        )

        raw_path.write_text(
            json.dumps(
                rows,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        # 정규화 미리보기 보관
        preview_path = (
            args.output / f"{source_id}_preview.jsonl"
        )

        with preview_path.open(
            "w",
            encoding="utf-8",
        ) as f:

            for item in previews:
                f.write(
                    json.dumps(
                        item,
                        ensure_ascii=False,
                    ) + "\n"
                )

        summary.append({
            "source": source_id,
            "rows": len(rows),
            "totalCount": total,
            "pages": pages,
        })

    summary_path = args.output / "summary.json"

    summary_path.write_text(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        "DONE:",
        "requests=",
        request_counter[0],
        "output=",
        args.output,
    )


if __name__ == "__main__":
    main()
