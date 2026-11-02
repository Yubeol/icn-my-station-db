
"""공항 편의시설 중복 식별 키 생성."""

import hashlib
import json
import re
import unicodedata


def normalize_text(value):
    if value is None:
        return ""

    text = unicodedata.normalize(
        "NFC",
        str(value),
    )

    text = re.sub(r"\s+", " ", text)

    return text.strip()


def make_facility_key(
    facility_name,
    location_description,
    arrival_departure_area,
):
    """시설명 + 위치 + 출발/도착 구분으로 식별."""

    name = normalize_text(facility_name)
    location = normalize_text(location_description)

    area = normalize_text(
        arrival_departure_area
    ).upper()

    # 필수 식별 정보가 없으면 임의의 키를 생성하지 않음
    if not name or not location:
        return None

    payload = {
        "facility_name": name,
        "location_description": location,
        "arrival_departure_area": area,
    }

    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )

    return hashlib.sha256(
        canonical.encode("utf-8")
    ).hexdigest()


def facility_key_from_row(row):
    return make_facility_key(
        row.get("facility_name"),
        row.get("location_description"),
        row.get("arrival_departure_area"),
    )


if __name__ == "__main__":
    sample = {
        "facility_name": "화장실",
        "location_description": (
            "탑승동 3층 동편 107번 탑승구 부근"
        ),
        "arrival_departure_area": "D",
    }

    print(facility_key_from_row(sample))
