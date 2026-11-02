
"""인천공항 METAR(IWXXM XML) 정규화 모듈.

현재 수집된 metar_raw.json을 읽어 METAR 관측값을 변환한다.
API를 재호출하거나 AWS RDS에 데이터를 쓰지 않는다.

실행:
uv run python -m api_pipeline.pipeline.metar_parser
"""

import json
import xml.etree.ElementTree as ET

from datetime import datetime, timezone
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]

INPUT_FILE = (
    BASE_DIR / "normalized_output" / "metar_raw.json"
)

OUTPUT_FILE = (
    BASE_DIR / "normalized_final" / "metar.jsonl"
)


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def find_element(root, name):
    for element in root.iter():
        if local_name(element.tag) == name:
            return element
    return None


def get_measure(root, name):
    element = find_element(root, name)

    if element is None:
        return None, None

    raw = (element.text or "").strip()
    if not raw:
        return None, element.attrib.get("uom")

    try:
        return float(raw), element.attrib.get("uom")
    except ValueError:
        return None, element.attrib.get("uom")


def get_time(root, name):
    parent = find_element(root, name)

    if parent is None:
        return None

    element = find_element(parent, "timePosition")

    if element is None or not element.text:
        return None

    value = element.text.strip()

    try:
        dt = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        return dt.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def to_mps(value, unit):
    if value is None:
        return None

    unit = (unit or "").strip()

    if unit in ("[kn_i]", "kt", "KT"):
        return round(value * 0.514444, 3)

    if unit in ("m/s", "m.s-1"):
        return round(value, 3)

    if unit in ("km/h", "km.h-1"):
        return round(value / 3.6, 3)

    return None


def to_hpa(value, unit):
    if value is None:
        return None

    if unit == "hPa":
        return round(value, 3)

    if unit == "Pa":
        return round(value / 100, 3)

    return None


def to_km(value, unit):
    if value is None:
        return None

    if unit in ("m", "metre"):
        return round(value / 1000, 3)

    if unit == "km":
        return round(value, 3)

    return None


def extract_metar_items(data):
    """실제 API 응답과 기존 수집 미리보기 구조 지원."""

    if isinstance(data, list):
        result = []

        for item in data:
            result.extend(extract_metar_items(item))

        return result

    if not isinstance(data, dict):
        return []

    # 실제 기상청 JSON 응답
    response = data.get("response")
    if isinstance(response, dict):
        body = response.get("body") or {}
        items = body.get("items") or {}

        if isinstance(items, dict):
            return extract_metar_items(
                items.get("item", [])
            )

        return extract_metar_items(items)

    # XML을 포함하는 단일 항목
    if isinstance(data.get("metarMsg"), str):
        return [data]

    # 수집 미리보기에서 감싼 구조
    if "raw" in data:
        return extract_metar_items(data["raw"])

    return []


def parse_metar(item):
    xml_text = item.get("metarMsg")

    if not isinstance(xml_text, str) or not xml_text.strip():
        raise ValueError("METAR XML이 없습니다.")

    root = ET.fromstring(xml_text)

    observed_at = get_time(
        root, "observationTime"
    )

    issued_at = get_time(
        root, "issueTime"
    )

    temperature, _ = get_measure(
        root, "airTemperature"
    )

    pressure, pressure_unit = get_measure(
        root, "qnh"
    )

    wind_direction, _ = get_measure(
        root, "meanWindDirection"
    )

    wind_speed, wind_unit = get_measure(
        root, "meanWindSpeed"
    )

    wind_gust, gust_unit = get_measure(
        root, "windGustSpeed"
    )

    visibility, visibility_unit = get_measure(
        root, "prevailingVisibility"
    )

    phenomena = []

    for element in root.iter():
        if local_name(element.tag) == "presentWeather":
            value = (
                element.attrib.get("code")
                or element.attrib.get(
                    "{http://www.w3.org/1999/xlink}href"
                )
                or (element.text or "").strip()
            )
            if value:
                phenomena.append(value)

    if observed_at is None:
        raise ValueError(
            "METAR 관측 시각을 추출하지 못했습니다."
        )

    return {
        "source": "metar",
        "airport_icao": "RKSI",
        "observed_at_utc": observed_at,
        "issued_at_utc": issued_at,
        "wind_direction_degrees": wind_direction,
        "wind_speed_mps": to_mps(
            wind_speed, wind_unit
        ),
        "wind_gust_mps": to_mps(
            wind_gust, gust_unit
        ),
        "temperature_c": temperature,
        "pressure_hpa": to_hpa(
            pressure, pressure_unit
        ),
        "visibility_km": to_km(
            visibility, visibility_unit
        ),
        "weather_phenomena": (
            ", ".join(phenomena)
            if phenomena else None
        ),
        "metar_parsed": True,
    }


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(INPUT_FILE)

    data = json.loads(
        INPUT_FILE.read_text(encoding="utf-8")
    )

    items = extract_metar_items(data)

    if not items:
        raise ValueError(
            "METAR 항목을 찾지 못했습니다."
        )

    normalized = [
        parse_metar(item) for item in items
    ]

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with OUTPUT_FILE.open(
        "w", encoding="utf-8"
    ) as f:
        for row in normalized:
            f.write(
                json.dumps(
                    row, ensure_ascii=False
                ) + "\n"
            )

    print("METAR PARSING SUCCESS")
    print("RAW RECORDS:", len(items))
    print("NORMALIZED RECORDS:", len(normalized))
    print("OUTPUT:", OUTPUT_FILE)

    for row in normalized:
        print(
            json.dumps(
                row,
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
