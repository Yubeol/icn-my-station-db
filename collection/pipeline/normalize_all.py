
"""인천공항 7개 API 통합 정규화.

기존 *_raw.json 파일을 읽어 정규화 결과를 생성한다.
API 재호출 및 PostgreSQL INSERT는 수행하지 않는다.

실행:
uv run python -m api_pipeline.pipeline.normalize_all
"""

import argparse
import json
import re
import xml.etree.ElementTree as ET

from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")
UTC = timezone.utc

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = BASE_DIR / "normalized_output"

SOURCES = [
    "congestion_t1",
    "congestion_t2",
    "passenger_forecast",
    "flights",
    "metar",
    "takeoff_forecast",
    "facilities",
]


# ============================================================
# 공통 변환 함수
# ============================================================

def clean(value):
    if value is None:
        return None

    value = str(value).strip()
    return value if value else None


def number(value):
    value = clean(value)

    if value is None or value == "-":
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def integer(value):
    value = number(value)

    if value is None:
        return None

    return int(value) if value.is_integer() else None


def timestamp(value, source_tz=KST):
    value = clean(value)

    if value is None:
        return None

    try:
        if re.fullmatch(r"\d{12}", value):
            dt = datetime.strptime(value, "%Y%m%d%H%M")
        elif re.fullmatch(r"\d{14}", value):
            dt = datetime.strptime(value, "%Y%m%d%H%M%S")
        else:
            dt = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            )

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=source_tz)

        return dt.astimezone(UTC).isoformat()

    except ValueError:
        return None


def convert_wind(value, unit="kt"):
    speed = number(value)

    if speed is None:
        return None

    factors = {
        "kt": 0.514444,
        "[kn_i]": 0.514444,
        "m/s": 1.0,
        "km/h": 1 / 3.6,
    }

    factor = factors.get(unit)

    if factor is None:
        return None

    return round(speed * factor, 3)


def convert_pressure(value, unit="hPa"):
    pressure = number(value)

    if pressure is None:
        return None

    if unit in ("hPa", "Pa/100"):
        return round(pressure, 3)

    if unit == "hundredth_inHg":
        return round(
            pressure / 100 * 33.8638866667, 3
        )

    if unit == "Pa":
        return round(pressure / 100, 3)

    return None


# ============================================================
# 1~2. T1 / T2 혼잡도
# ============================================================

def normalize_congestion(item, source):
    wait_raw = clean(item.get("waitTime"))
    over_60 = wait_raw == "60+"

    return [{
        "source": source,
        "terminal_code": (
            "T1" if source == "congestion_t1" else "T2"
        ),
        "source_terminal_id": clean(
            item.get("terminalId")
        ),
        "hall_id": clean(item.get("gateId")),
        "measured_at_utc": timestamp(
            item.get("occurtime")
        ),
        "waiting_passenger_count": integer(
            item.get("waitLength")
        ),
        "waiting_minutes": (
            None if over_60 else number(wait_raw)
        ),
        "waiting_minutes_over_60": over_60,
        "waiting_minutes_raw": wait_raw,
        "operating_time_raw": clean(
            item.get("operatingTime")
        ),
        "raw": item,
    }]


# ============================================================
# 3. 여객 예고
# ============================================================

def normalize_passengers(item):
    day = clean(item.get("adate"))
    slot = clean(item.get("atime"))

    # 전체 합계 행은 구역 데이터로 저장하지 않음
    if slot is None or not re.fullmatch(
        r"\d{2}_\d{2}", slot
    ):
        return []

    if day is None or not re.fullmatch(r"\d{8}", day):
        return []

    result = []

    # t1eg1, t1dg3, t2eg2 등
    pattern = re.compile(
        r"^t([12])([ed])g(\d+)$",
        re.IGNORECASE,
    )

    for key, value in item.items():
        match = pattern.fullmatch(key)

        if not match:
            continue

        terminal_no, flow, group = match.groups()
        count = integer(value)

        if count is None:
            continue

        result.append({
            "source": "passenger_forecast",
            "target_date": (
                f"{day[:4]}-{day[4:6]}-{day[6:8]}"
            ),
            "time_slot": slot,
            "terminal_code": f"T{terminal_no}",
            "flow_type": (
                "arrival" if flow.lower() == "e"
                else "departure"
            ),
            "zone_code": (
                f"T{terminal_no}"
                f"{flow.upper()}G{group}"
            ),
            "source_field": key,
            "expected_passenger_count": count,
        })

    return result


# ============================================================
# 4. 항공편
# ============================================================

def normalize_flight(item):
    terminal = clean(item.get("terminalId"))
    codeshare = clean(item.get("codeshare"))

    return [{
        "source": "flights",
        "source_flight_id": clean(item.get("fid")),
        "flight_number": clean(item.get("flightId")),
        "airline_name": clean(item.get("airline")),
        "airport_name": clean(item.get("airport")),
        "airport_code": clean(item.get("airportCode")),
        "flow_type": "departure",
        "source_terminal_id": terminal,
        "terminal_code": {
            "P01": "T1",
            "P02": "CONCOURSE_T1",
            "P03": "T2",
        }.get(terminal),
        "scheduled_at_utc": timestamp(
            item.get("scheduleDatetime")
        ),
        "estimated_at_utc": timestamp(
            item.get("estimatedDatetime")
        ),
        "gate": clean(item.get("gateNumber")),
        "check_in_counter": clean(
            item.get("chkinRange")
        ),
        "source_status": clean(item.get("remark")),
        "codeshare_type": codeshare,
        "is_codeshare": (
            True if codeshare == "Slave"
            else False if codeshare == "Master"
            else None
        ),
        "master_flight_number": clean(
            item.get("masterFlightId")
        ),
        "passenger_or_cargo": clean(
            item.get("passengerOrCargo")
        ),
        "raw": item,
    }]


# ============================================================
# 5. METAR XML
# ============================================================

def xml_node(root, name):
    for node in root.iter():
        if node.tag.split("}")[-1] == name:
            return node

    return None


def xml_value(root, name):
    node = xml_node(root, name)

    if node is None:
        return None, None

    return clean(node.text), node.attrib.get("uom")


def normalize_metar(item):
    xml_text = item.get("metarMsg")

    if not isinstance(xml_text, str) or not xml_text.strip():
        return [{
            "source": "metar",
            "airport_icao": "RKSI",
            "metar_parsed": False,
            "parse_error": "METAR XML missing",
            "raw": item,
        }]

    try:
        root = ET.fromstring(xml_text)

        # issueTime과 observationTime을 구분
        observation = xml_node(root, "observationTime")
        time_value = None

        if observation is not None:
            time_value, _ = xml_value(
                observation, "timePosition"
            )

        temperature, _ = xml_value(
            root, "airTemperature"
        )
        pressure, pressure_unit = xml_value(
            root, "qnh"
        )

        direction, _ = xml_value(
            root, "meanWindDirection"
        )
        speed, speed_unit = xml_value(
            root, "meanWindSpeed"
        )
        gust, gust_unit = xml_value(
            root, "windGustSpeed"
        )

        visibility, visibility_unit = xml_value(
            root, "prevailingVisibility"
        )

        visibility_km = None

        if number(visibility) is not None:
            if visibility_unit in ("m", "metre"):
                visibility_km = round(
                    number(visibility) / 1000, 3
                )
            elif visibility_unit == "km":
                visibility_km = number(visibility)

        phenomena = []

        for node in root.iter():
            if node.tag.split("}")[-1] == "presentWeather":
                code = (
                    node.attrib.get("code")
                    or node.attrib.get(
                        "{http://www.w3.org/1999/xlink}href"
                    )
                    or clean(node.text)
                )

                if code:
                    phenomena.append(code)

        return [{
            "source": "metar",
            "airport_icao": "RKSI",
            "observed_at_utc": timestamp(
                time_value, UTC
            ),
            "wind_direction_degrees": number(
                direction
            ),
            "wind_speed_mps": convert_wind(
                speed, speed_unit or "kt"
            ),
            "wind_gust_mps": convert_wind(
                gust, gust_unit or "kt"
            ),
            "temperature_c": number(temperature),
            "pressure_hpa": convert_pressure(
                pressure, pressure_unit or "hPa"
            ),
            "visibility_km": visibility_km,
            "weather_phenomena": (
                ", ".join(phenomena)
                if phenomena else None
            ),
            "metar_parsed": True,
            "raw": item,
        }]

    except ET.ParseError as exc:
        return [{
            "source": "metar",
            "airport_icao": "RKSI",
            "metar_parsed": False,
            "parse_error": str(exc),
            "raw": item,
        }]


# ============================================================
# 6. 이륙 기상 예보
# ============================================================

def normalize_takeoff(item):
    return [{
        "source": "takeoff_forecast",
        "airport_icao": (
            clean(item.get("icaoCode")) or "RKSI"
        ),
        "valid_at_utc": timestamp(
            item.get("tmFc"), UTC
        ),
        # API 원본에서 별도 발행 시각이 확인되지 않음
        "issued_at_utc": None,
        "wind_direction_degrees": number(
            item.get("wd")
        ),
        "wind_speed_mps": convert_wind(
            item.get("ws"), "kt"
        ),
        "temperature_c": number(
            item.get("ta")
        ),
        "pressure_hpa": convert_pressure(
            item.get("qnh"),
            "hundredth_inHg",
        ),
        "raw": item,
    }]


# ============================================================
# 7. 편의시설
# ============================================================

def classify_terminal(location):
    location = clean(location)

    if location is None:
        return None

    if "탑승동" in location:
        return "CONCOURSE_T1"

    if (
        "제1여객터미널" in location
        or "제 1여객터미널" in location
        or "제1터미널" in location
    ):
        return "T1"

    if (
        "제2여객터미널" in location
        or "제 2여객터미널" in location
        or "제2터미널" in location
    ):
        return "T2"

    return None


def normalize_facility(item):
    location = clean(item.get("lckoreannm"))

    return [{
        "source": "facilities",
        "facility_name": clean(
            item.get("entrpskoreannm")
        ),
        "products_description": clean(
            item.get("trtmntprdlstkoreannm")
        ),
        "location_description": location,
        "terminal_code": classify_terminal(location),
        "arrival_departure_area": clean(
            item.get("arrordep")
        ),
        "opening_hours_note": clean(
            item.get("servicetime")
        ),
        "phone_number": clean(item.get("tel")),
        # 원본 중복 행은 임의로 제거하지 않음
        "raw": item,
    }]


# ============================================================
# 전체 데이터 변환
# ============================================================

NORMALIZERS = {
    "congestion_t1": normalize_congestion,
    "congestion_t2": normalize_congestion,
    "passenger_forecast": normalize_passengers,
    "flights": normalize_flight,
    "metar": normalize_metar,
    "takeoff_forecast": normalize_takeoff,
    "facilities": normalize_facility,
}


def main():
    parser = argparse.ArgumentParser(
        description="ICN 7 API offline normalizer"
    )

    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=BASE_DIR / "normalized_final",
    )

    parser.add_argument(
        "--sources",
        nargs="+",
        choices=SOURCES,
        default=SOURCES,
    )

    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    summary = []

    for source in args.sources:
        input_path = args.input / f"{source}_raw.json"

        if not input_path.exists():
            raise FileNotFoundError(
                f"원본 파일이 없습니다: {input_path}"
            )

        with input_path.open(encoding="utf-8") as f:
            raw_rows = json.load(f)

        if not isinstance(raw_rows, list):
            raise ValueError(
                f"{source}: 원본은 JSON 배열이어야 합니다."
            )

        normalized = []
        normalizer = NORMALIZERS[source]

        for item in raw_rows:
            if source in ("congestion_t1", "congestion_t2"):
                rows = normalizer(item, source)
            else:
                rows = normalizer(item)

            normalized.extend(rows)

        output_path = (
            args.output / f"{source}.jsonl"
        )

        with output_path.open(
            "w", encoding="utf-8"
        ) as f:
            for row in normalized:
                f.write(
                    json.dumps(
                        row, ensure_ascii=False
                    ) + "\n"
                )

        summary.append({
            "source": source,
            "raw_rows": len(raw_rows),
            "normalized_rows": len(normalized),
            "output": output_path.name,
        })

        print(
            f"[OK] {source}: "
            f"{len(raw_rows)} -> "
            f"{len(normalized)} rows"
        )

    summary_path = args.output / "summary.json"

    summary_path.write_text(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("NORMALIZATION COMPLETE")
    print("OUTPUT:", args.output)


if __name__ == "__main__":
    main()
