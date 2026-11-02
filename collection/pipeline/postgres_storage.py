
"""ICN My Station - PostgreSQL 적재 및 데이터 품질 검사.

실행:
python -m collection.pipeline.postgres_storage --source facilities
python -m collection.pipeline.postgres_storage --source facilities --limit 2
python -m collection.pipeline.postgres_storage --source facilities --apply

--limit 생략: 전체 데이터
--apply 생략: DRY RUN (DB 쓰기 없음)
"""

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import MetaData, Table, create_engine, insert
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .facility_key import facility_key_from_row
from .settings import database_url


KST = ZoneInfo("Asia/Seoul")
COLLECTION_DIR = Path(__file__).resolve().parents[1]

INPUT_DIR = COLLECTION_DIR / "normalized_final"
REPORT_DIR = COLLECTION_DIR / "validation_output"

SOURCES = {
    "congestion_t1": "congestion_snapshots",
    "congestion_t2": "congestion_snapshots",
    "passenger_forecast": "passenger_forecasts",
    "flights": "flight_operations",
    "metar": "weather_observations",
    "takeoff_forecast": "takeoff_weather_forecasts",
    "facilities": "airport_facilities",
}

CONFLICT_KEYS = {
    "congestion_snapshots": (
        "zone_id", "measured_at", "source",
    ),
    "passenger_forecasts": (
        "target_date", "time_slot",
        "zone_id", "flow_type", "source",
    ),
    "flight_operations": (
        "source_api_identifier", "source_flight_id", "source",
    ),
    "weather_observations": (
        "airport_icao", "observed_at", "source",
    ),
    "takeoff_weather_forecasts": (
        "airport_icao", "forecast_type",
        "issued_at", "valid_at", "source",
    ),
    "airport_facilities": (
        "source_facility_key",
    ),
}

# 시설의 고유 키는 시설명·위치·출입국 구분으로 생성.
# 아래 필드는 같은 시설에서도 정보가 달라질 수 있다.
FACILITY_ATTRIBUTES = (
    "opening_hours_note",
    "phone_number",
    "products_description",
)


def current_time():
    return datetime.now(KST)


def parse_time(value):
    if value is None or str(value).strip() == "":
        return None

    dt = datetime.fromisoformat(
        str(value).replace("Z", "+00:00")
    )

    if dt.tzinfo is None:
        raise ValueError(
            f"시간대가 없는 시각: {value}"
        )

    return dt.astimezone(KST)


def required(value, field):
    if value is None or value == "":
        raise ValueError(
            f"필수 값 누락: {field}"
        )
    return value


def clean(value):
    if value is None:
        return None

    value = str(value).strip()
    return value if value else None


def read_rows(source, limit=None):
    path = INPUT_DIR / f"{source}.jsonl"

    if not path.is_file():
        raise FileNotFoundError(
            f"입력 파일이 없습니다: {path}"
        )

    records = []

    with path.open("r", encoding="utf-8-sig") as file:
        for line_number, line in enumerate(file, 1):
            if not line.strip():
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{path.name}:{line_number}: "
                    f"JSON 오류: {exc}"
                ) from exc

            if not isinstance(data, dict):
                raise ValueError(
                    f"{path.name}:{line_number}: "
                    "JSON 객체가 아닙니다."
                )

            records.append({
                "line_number": line_number,
                "data": data,
            })

            if limit is not None and len(records) >= limit:
                break

    if not records:
        raise ValueError(
            f"입력 데이터가 없습니다: {path}"
        )

    return records


def write_report(filename, records):
    """검증 보고서를 덮어쓴다. 원본은 건드리지 않는다."""
    REPORT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    path = REPORT_DIR / filename
    temp_path = path.with_suffix(".jsonl.tmp")

    with temp_path.open("w", encoding="utf-8") as file:
        for item in records:
            file.write(
                json.dumps(item, ensure_ascii=False) + "\n"
            )

    temp_path.replace(path)
    return path


def facility_group_summary(items):
    """식별 키가 같은 시설들의 상세 정보를 수집한다."""
    return [
        {
            "line_number": item["line_number"],
            "facility_name": item["data"].get("facility_name"),
            "terminal_code": item["data"].get("terminal_code"),
            "location_description": item["data"].get(
                "location_description"
            ),
            "arrival_departure_area": item["data"].get(
                "arrival_departure_area"
            ),
            "opening_hours_note": item["data"].get(
                "opening_hours_note"
            ),
            "phone_number": item["data"].get(
                "phone_number"
            ),
            "products_description": item["data"].get(
                "products_description"
            ),
            "raw": item["data"].get("raw"),
        }
        for item in items
    ]


def classify_facilities(records):
    """시설 키별로 병합하고 위험한 데이터는 격리한다."""
    groups = defaultdict(list)
    rejected = []
    conflicts = []
    duplicate_groups = 0
    extra_duplicates = 0

    for record in records:
        row = record["data"]
        key = facility_key_from_row(row)

        if not key:
            rejected.append({
                "line_number": record["line_number"],
                "reason": "MISSING_NAME_OR_LOCATION",
                "data": row,
            })
            continue

        groups[key].append(record)

    valid = []

    for key, items in groups.items():
        if len(items) == 1:
            valid.append(items[0])
            continue

        duplicate_groups += 1
        extra_duplicates += len(items) - 1

        # 같은 키인데 서로 다른 터미널이면
        # 다른 시설일 수 있으므로 전체 그룹을 격리한다.
        terminals = {
            clean(item["data"].get("terminal_code"))
            for item in items
            if clean(item["data"].get("terminal_code"))
        }

        if len(terminals) > 1:
            conflicts.append({
                "facility_key": key,
                "reason": "TERMINAL_CONFLICT",
                "resolution": "QUARANTINED",
                "records": facility_group_summary(items),
            })

            for item in items:
                rejected.append({
                    "line_number": item["line_number"],
                    "reason": "TERMINAL_CONFLICT",
                    "facility_key": key,
                    "data": item["data"],
                })
            continue

        # 같은 시설의 여러 응답 중 하나를 대표행으로 사용.
        # 원본 records에 영향을 주지 않도록 dict 복사.
        representative = dict(items[-1]["data"])

        # 터미널이 하나라도 확인됐으면 보존.
        if terminals:
            representative["terminal_code"] = next(
                iter(terminals)
            )

        conflicting_fields = {}

        for field in FACILITY_ATTRIBUTES:
            nonempty = {
                clean(item["data"].get(field))
                for item in items
                if clean(item["data"].get(field))
            }

            if len(nonempty) > 1:
                # 상충하는 정보는 임의 선택하지 않음.
                representative[field] = None
                conflicting_fields[field] = sorted(nonempty)
            elif nonempty:
                representative[field] = next(iter(nonempty))
            else:
                representative[field] = None

        # 서로 다른 원본이 같은 키로 묶였는지 기록.
        distinct_rows = {
            json.dumps(
                item["data"],
                ensure_ascii=False,
                sort_keys=True,
            )
            for item in items
        }

        if len(distinct_rows) > 1 or conflicting_fields:
            conflicts.append({
                "facility_key": key,
                "reason": "DUPLICATE_DATA_DIFFERENCE",
                "resolution": "MERGED",
                "conflicting_fields": conflicting_fields,
                "records": facility_group_summary(items),
            })

        # 병합된 행의 대표 원본 행 번호 유지.
        valid.append({
            "line_number": items[-1]["line_number"],
            "data": representative,
        })

    valid.sort(key=lambda x: x["line_number"])
    rejected.sort(key=lambda x: x["line_number"])

    rejected_path = write_report(
        "facilities_rejected.jsonl",
        rejected,
    )
    conflicts_path = write_report(
        "facilities_conflicts.jsonl",
        conflicts,
    )

    summary = {
        "input": len(records),
        "valid": len(valid),
        "rejected": len(rejected),
        "duplicate_groups": duplicate_groups,
        "extra_duplicate_rows": extra_duplicates,
        "conflict_reports": len(conflicts),
        "rejected_path": str(rejected_path),
        "conflicts_path": str(conflicts_path),
    }

    print("=== FACILITY VALIDATION ===")
    print("INPUT ROWS:", summary["input"])
    print("VALID UNIQUE ROWS:", summary["valid"])
    print("REJECTED ROWS:", summary["rejected"])
    print("DUPLICATE GROUPS:", summary["duplicate_groups"])
    print("EXTRA DUPLICATE ROWS:", summary["extra_duplicate_rows"])
    print("CONFLICT REPORTS:", summary["conflict_reports"])
    print("REJECTED FILE:", summary["rejected_path"])
    print("CONFLICT FILE:", summary["conflicts_path"])

    return valid, summary


def get_terminals(conn):
    result = conn.exec_driver_sql("""
        SELECT terminal_id, terminal_code, source_terminal_code
        FROM public.terminals
    """)

    lookup = {}

    for row in result.mappings():
        lookup[row["terminal_code"]] = row["terminal_id"]

        if row["source_terminal_code"]:
            lookup[row["source_terminal_code"]] = (
                row["terminal_id"]
            )

    return lookup


def get_zones(conn):
    """터미널과 구역 종류를 포함하여 조회한다."""
    result = conn.exec_driver_sql("""
        SELECT
            z.zone_id,
            z.zone_code,
            z.gate_id,
            z.zone_type,
            t.terminal_code
        FROM public.airport_zones z
        JOIN public.terminals t
          ON z.terminal_id = t.terminal_id
    """)

    zones = {}

    for row in result.mappings():
        terminal = row["terminal_code"]
        zone_type = row["zone_type"]

        for code in (row["zone_code"], row["gate_id"]):
            if not code:
                continue

            key = (
                terminal,
                str(code).strip().upper(),
                zone_type,
            )

            old = zones.get(key)

            if old is not None and old != row["zone_id"]:
                raise ValueError(
                    f"DB 구역 중복 매핑: {key}"
                )

            zones[key] = row["zone_id"]

    return zones


def terminal_name(row):
    source_code = row.get("source_terminal_id")

    mapping = {
        "P01": "T1",
        "P03": "T2",
        "P02": "CONCOURSE",
        "CONCOURSE_T1": "CONCOURSE",
    }

    if source_code in mapping:
        return mapping[source_code]

    code = row.get("terminal_code")
    return mapping.get(code, code)


def zone_id_for(row, zones, code, zone_type):
    terminal = terminal_name(row)

    if not terminal:
        raise ValueError("터미널 정보가 없습니다.")

    if not code:
        raise ValueError("구역 코드가 없습니다.")

    key = (
        terminal,
        str(code).strip().upper(),
        zone_type,
    )

    zone_id = zones.get(key)

    if zone_id is None:
        raise ValueError(
            f"구역 매핑 없음: {key}"
        )

    return zone_id


def map_row(source, row, terminals, zones, now):
    """정규화 JSONL을 실제 DB 컬럼으로 변환한다."""

    if source in ("congestion_t1", "congestion_t2"):
        measured = required(
            parse_time(row.get("measured_at_utc")),
            "measured_at_utc",
        )

        return {
            "source": "api",
            "zone_id": zone_id_for(
                row, zones,
                row.get("hall_id"),
                "departure_gate",
            ),
            "measured_at": measured.replace(
                second=0, microsecond=0
            ),
            "source_measured_at": measured,
            "waiting_passenger_count": required(
                row.get("waiting_passenger_count"),
                "waiting_passenger_count",
            ),
            "wait_time_raw": row.get("waiting_minutes_raw"),
            "operating_time": row.get("operating_time_raw"),
            "collected_at": now,
        }

    if source == "passenger_forecast":
        flow = required(row.get("flow_type"), "flow_type")

        if flow not in ("arrival", "departure"):
            raise ValueError(
                f"잘못된 출입국 방향: {flow}"
            )

        code = required(
            row.get("zone_code"), "zone_code"
        )

        code = str(code).strip().upper()

        if "SUM" in code:
            raise ValueError(
                f"합계 필드는 저장할 수 없습니다: {code}"
            )

        if code.startswith(("T1EG", "T2EG")) and flow != "arrival":
            raise ValueError(
                f"EG 방향 불일치: {code}/{flow}"
            )

        if code.startswith(("T1DG", "T2DG")) and flow != "departure":
            raise ValueError(
                f"DG 방향 불일치: {code}/{flow}"
            )

        return {
            "source": "api",
            "target_date": required(
                row.get("target_date"), "target_date"
            ),
            "time_slot": required(
                row.get("time_slot"), "time_slot"
            ),
            "zone_id": zone_id_for(
                row, zones, code, "passenger_forecast_zone"
            ),
            "flow_type": flow,
            "expected_passenger_count": required(
                row.get("expected_passenger_count"),
                "expected_passenger_count",
            ),
            "collected_at": now,
        }

    if source == "flights":
        terminal = terminal_name(row)

        return {
            "source": "api",
            "source_api_identifier": "flights",
            "source_flight_id": required(
                row.get("source_flight_id"),
                "source_flight_id",
            ),
            "flight_number": required(
                row.get("flight_number"),
                "flight_number",
            ),
            "airline_name": row.get("airline_name"),
            "flow_type": "departure",
            "arrival_airport_code": row.get("airport_code"),
            "arrival_airport_name": row.get("airport_name"),
            "scheduled_at": parse_time(
                row.get("scheduled_at_utc")
            ),
            "estimated_at": parse_time(
                row.get("estimated_at_utc")
            ),
            "terminal_id": terminals.get(terminal),
            "source_terminal_code": row.get(
                "source_terminal_id"
            ),
            "gate": row.get("gate"),
            "check_in_counter": row.get("check_in_counter"),
            "status": "unknown",
            "source_status": row.get("source_status"),
            "is_codeshare": row.get("is_codeshare"),
            "codeshare_type": row.get("codeshare_type"),
            "master_flight_number": row.get(
                "master_flight_number"
            ),
            "last_collected_at": now,
        }

    if source == "metar":
        if row.get("metar_parsed") is not True:
            raise ValueError(
                "METAR XML 정규화가 완료되지 않았습니다."
            )

        return {
            "source": "api",
            "airport_icao": required(
                row.get("airport_icao"), "airport_icao"
            ),
            "observed_at": required(
                parse_time(row.get("observed_at_utc")),
                "observed_at",
            ),
            "wind_direction_degrees": row.get(
                "wind_direction_degrees"
            ),
            "wind_speed_mps": row.get("wind_speed_mps"),
            "wind_gust_mps": row.get("wind_gust_mps"),
            "temperature_c": row.get("temperature_c"),
            "pressure_hpa": row.get("pressure_hpa"),
            "visibility_km": row.get("visibility_km"),
            "weather_phenomena": row.get(
                "weather_phenomena"
            ),
            "collected_at": now,
        }

    if source == "takeoff_forecast":
        return {
            "source": "api",
            "airport_icao": required(
                row.get("airport_icao"), "airport_icao"
            ),
            "forecast_type": "takeoff",
            "issued_at": parse_time(
                row.get("issued_at_utc")
            ),
            "valid_at": required(
                parse_time(row.get("valid_at_utc")),
                "valid_at",
            ),
            "wind_direction_degrees": row.get(
                "wind_direction_degrees"
            ),
            "wind_speed_mps": row.get("wind_speed_mps"),
            "temperature_c": row.get("temperature_c"),
            "pressure_hpa": row.get("pressure_hpa"),
            "collected_at": now,
        }

    if source == "facilities":
        key = facility_key_from_row(row)

        if not key:
            raise ValueError(
                "시설 식별 키 생성 실패"
            )

        terminal = terminal_name(row)

        return {
            "facility_name": required(
                row.get("facility_name"), "facility_name"
            ),
            "terminal_id": terminals.get(terminal),
            "location_description": row.get(
                "location_description"
            ),
            "opening_hours_note": row.get(
                "opening_hours_note"
            ),
            "products_description": row.get(
                "products_description"
            ),
            "arrival_departure_area": row.get(
                "arrival_departure_area"
            ),
            "phone_number": row.get("phone_number"),
            "source_api_identifier": "facilities",
            "source_facility_key": key,
        }

    raise ValueError(
        f"지원하지 않는 API: {source}"
    )


def conflict_identity(table_name, values):
    """행 중복 제거용 키. NULL 발행시각도 구분."""
    if (
        table_name == "takeoff_weather_forecasts"
        and values["issued_at"] is None
    ):
        keys = (
            "airport_icao", "forecast_type",
            "valid_at", "source",
        )
        return ("null-issued",) + tuple(
            values[k] for k in keys
        )

    keys = CONFLICT_KEYS[table_name]
    return tuple(values[k] for k in keys)


def prepare_rows(conn, source, records):
    terminals = get_terminals(conn)
    zones = get_zones(conn)
    now = current_time()

    unique = {}
    table_name = SOURCES[source]

    for record in records:
        row = record["data"]
        number = record["line_number"]

        try:
            values = map_row(
                source, row, terminals, zones, now
            )
        except (ValueError, TypeError, KeyError) as exc:
            raise ValueError(
                f"{source}.jsonl {number}번째 행: {exc}"
            ) from exc

        identity = conflict_identity(table_name, values)

        if identity in unique and source == "facilities":
            raise ValueError(
                "시설 중복 병합이 완료되지 않았습니다: "
                f"{number}번째 행"
            )

        unique[identity] = values

    return list(unique.values())


def build_upsert(table, values):
    stmt = pg_insert(table).values(**values)
    keys = CONFLICT_KEYS[table.name]

    if (
        table.name == "takeoff_weather_forecasts"
        and values["issued_at"] is None
    ):
        keys = (
            "airport_icao", "forecast_type",
            "valid_at", "source",
        )
        where = table.c.issued_at.is_(None)
    else:
        where = None

    excluded = stmt.excluded

    updates = {
        key: getattr(excluded, key)
        for key in values
        if key not in keys and key != "source"
    }

    return stmt.on_conflict_do_update(
        index_elements=list(keys),
        index_where=where,
        set_=updates,
    )


def validate(engine, source, records):
    """실제 SQL INSERT 없이 매핑과 데이터를 검증한다."""
    with engine.connect() as conn:
        prepared = prepare_rows(
            conn, source, records
        )

    print("DRY RUN SUCCESS")
    print("API:", source)
    print("TABLE:", SOURCES[source])
    print("INPUT ROWS:", len(records))
    print("UNIQUE ROWS:", len(prepared))
    print("AWS RDS DATA NOT MODIFIED")

    return prepared


def apply_rows(engine, source, records):
    """API별 단일 트랜잭션으로 UPSERT한다."""
    with engine.begin() as conn:
        prepared = prepare_rows(
            conn, source, records
        )

        metadata = MetaData()

        run_table = Table(
            "api_collection_runs",
            metadata,
            autoload_with=conn,
            schema="public",
        )

        target = Table(
            SOURCES[source],
            metadata,
            autoload_with=conn,
            schema="public",
        )

        run_id = conn.execute(
            insert(run_table).values(
                source="api",
                api_identifier=source,
                started_at=current_time(),
                completed_at=None,
                succeeded=None,
                collected_count=0,
            ).returning(
                run_table.c.collection_run_id
            )
        ).scalar_one()

        for item in prepared:
            values = dict(item)

            if "collection_run_id" in target.c:
                values["collection_run_id"] = run_id

            conn.execute(
                build_upsert(target, values)
            )

        conn.execute(
            run_table.update()
            .where(
                run_table.c.collection_run_id == run_id
            )
            .values(
                completed_at=current_time(),
                succeeded=True,
                collected_count=len(prepared),
            )
        )

    print("APPLY SUCCESS")
    print("API:", source)
    print("UPSERT ROWS:", len(prepared))
    print("COLLECTION RUN ID:", run_id)

    return len(prepared)


def main():
    parser = argparse.ArgumentParser(
        description="ICN My Station PostgreSQL loader"
    )

    parser.add_argument(
        "--source",
        required=True,
        choices=list(SOURCES),
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="생략하면 전체 처리",
    )

    parser.add_argument(
        "--apply",
        action="store_true",
        help="실제 AWS RDS에 UPSERT",
    )

    args = parser.parse_args()

    if args.limit is not None and args.limit < 1:
        parser.error(
            "--limit은 1 이상이어야 합니다."
        )

    records = read_rows(
        args.source,
        args.limit,
    )

    if args.limit is None:
        print(
            f"전체 모드: {args.source}.jsonl "
            f"{len(records)}건"
        )

    if args.source == "facilities":
        records, summary = classify_facilities(
            records
        )

        if not records:
            raise ValueError(
                "저장할 수 있는 시설 데이터가 없습니다."
            )

    engine = create_engine(
        database_url(),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 10},
    )

    if engine.dialect.name != "postgresql":
        engine.dispose()
        raise RuntimeError(
            "PostgreSQL 연결이 필요합니다."
        )

    try:
        validate(
            engine,
            args.source,
            records,
        )

        if args.apply:
            apply_rows(
                engine,
                args.source,
                records,
            )
        else:
            print(
                "실제 저장하려면 --apply를 지정하세요."
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
