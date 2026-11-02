# 백엔드 매핑 (API 계약 ↔ DB)

`docs/api-contract.md`의 필드가 어느 테이블·컬럼에서 오는지, 어떤 변환이 필요한지 정리한다.

## 근거와 한계
- 스키마: `origin/feature/db-api-schema-update`(PR #3)의 `database/schema.sql`. 실제 RDS가 이 기준이라고 전달받았다. main의 `database/schema.sql`은 이보다 오래된 버전이라 컬럼이 일부 없다.
- 적재 동작: `collection/pipeline/postgres_storage.py`의 `map_row`·`get_zones`·`terminal_name`, `normalize_all.py`.
- **실제 RDS 값은 아직 확인하지 못했다.** 접속 타임아웃으로 SELECT를 실행하지 못했다. 값을 봐야 확정되는 항목은 **[DB 확인 필요]**로 표시한다.
- 시간 컬럼은 모두 `timestamptz`이다. 응답에 내릴 때 KST(+09:00)로 변환한다.
- 모든 조회는 `source = 'api'`만 읽는다. demo·yolo와 섞지 않는다.

## 1. 수집기가 각 테이블에 넣는 값

| 테이블 | 넣는 컬럼 | 넣지 않는 컬럼(항상 NULL/기본값) |
|---|---|---|
| `flight_operations` | `source_flight_id`(API `fid`), `flight_number`, `airline_name`, `flow_type`(**항상 `departure`**), `arrival_airport_code`, `arrival_airport_name`, `scheduled_at`, `estimated_at`, `terminal_id`, `source_terminal_code`, `gate`, `check_in_counter`, `source_status`(API `remark` 원문), `is_codeshare`, `codeshare_type`, `master_flight_number` | `status`는 **항상 `unknown`**, `airline_code`, `departure_airport_*`, `arrival_city_name`, `departure_city_name`, `actual_at`, `status_basis`, `master_source_flight_id`, `source_updated_at` |
| `congestion_snapshots` | `zone_id`, `measured_at`(분 단위 절삭), `source_measured_at`, `waiting_passenger_count`, `wait_time_raw`, `operating_time` | `estimation_basis`(yolo 전용) |
| `weather_observations` | `airport_icao`(RKSI 고정), `observed_at`, `wind_direction_degrees`, `wind_speed_mps`, `wind_gust_mps`, `temperature_c`, `pressure_hpa`, `visibility_km`, `weather_phenomena` | 구름·운량 컬럼은 스키마에 없음 |
| `takeoff_weather_forecasts` | `forecast_type='takeoff'`, `issued_at`(항상 NULL), `valid_at`, `wind_direction_degrees`, `wind_speed_mps`, `temperature_c`, `pressure_hpa` | 시정 없음 |
| `airport_facilities` | `facility_name`, `terminal_id`, `location_description`, `opening_hours_note`, `products_description`, `arrival_departure_area`, `phone_number`, `source_facility_key` | `facility_type`, `floor_label`, `zone_id`, `facility_opening_hours` 테이블 |
| `passenger_forecasts` | 여객 예고(`T1EG1` 같은 zone_code) | 계약에서 쓰지 않음 |
| `airport_zones`, `terminals` | **수집기가 쓰지 않는다.** 이미 들어 있다고 가정하고 조회만 한다. `terminals`는 schema.sql의 INSERT(T1/T2/CONCOURSE)가 출처 | - |

### 수집 코드에서 확인된 변환
- `terminal_name()`: `P01→T1`, `P03→T2`, `P02→CONCOURSE`, `CONCOURSE_T1→CONCOURSE`. DB의 `terminals.terminal_code`는 T1/T2/CONCOURSE 세 가지다. **계약의 terminal은 T1/T2뿐이라 CONCOURSE(탑승동) 편의 처리를 정해야 한다.**
- `get_zones()`: `(terminal_code, upper(zone_code 또는 gate_id), zone_type)` → `zone_id`로 인덱싱한다. 혼잡도는 API `gateId`를 **`zone_type='departure_gate'`** 구역의 `zone_code` 또는 `gate_id`와 맞춰서 `zone_id`를 얻는다. 즉 혼잡도 행은 출국장(hall)이 아니라 **게이트 단위 구역**에 붙는다.
- 스키마상 `hall_id`/`hall_number`는 `zone_type='departure_hall'` 구역에, `gate_id`는 원본 gateId(예: `DG3_E`, `DG3_W`)에 쓰이고 `parent_zone_id`로 hall과 연결될 수 있다. 계약의 Hall은 출국장 단위이므로 **게이트 구역을 hall로 묶는 규칙이 필요하다.**
- 풍속 kt→m/s, 기압 inHg/100→hPa, 시정 m→km는 수집기가 변환해서 저장한다. 백엔드는 다시 변환하지 않는다.
- `is_codeshare`: `Slave→true`, `Master→false`, 그 외(빈 값) → `NULL`.

## 2. 계약 필드별 매핑

### Flight (`GET /flights`, `dashboard/summary`의 flights)
출처: `flight_operations` + `terminals`. 현재 출발편(`flow_type='departure'`)만 있다.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| flightNo | `flight_number` | 그대로. 단건 조회·`isMyFlight` 비교는 대소문자·공백 정규화 후 비교. 행 식별은 편명이 아니라 `flight_uid`/`source_flight_id`를 쓴다 |
| airline | `airline_name` | 그대로. 비어 있으면 `airline_code`가 없으므로 대체값 없음 |
| type | `flow_type` | `departure→DEPARTURE`, `arrival→ARRIVAL` |
| city | 출발편: `arrival_airport_name` | **[DB 확인 필요]** API `airport` 값이 "도쿄/나리타" 같은 도시명인지 공항명인지. `arrival_city_name`은 항상 NULL |
| airportCode | 출발편: `arrival_airport_code` | 도착편이 생기면 `departure_airport_code` |
| scheduledAt | `scheduled_at` | KST 변환. NULL이면 목록에서 제외하거나 정렬 뒤로 보낸다 (계약은 N) |
| estimatedAt | `estimated_at` | `scheduled_at`과 같으면 null |
| terminal | `terminals.terminal_code` (`terminal_id` JOIN) | T1/T2 그대로. **CONCOURSE는 정책 결정 필요**(T1로 합산할지) |
| gate | `gate`(text) | 숫자로 변환, 실패·NULL이면 null. **[DB 확인 필요]** 게이트 값이 숫자만 있는지, "A12" 같은 형식이 있는지 |
| status | `source_status`(원문) → 표준 코드 | `status` 컬럼은 항상 `unknown`이라 **쓰지 않는다.** 백엔드가 `source_status`를 매핑한다 (아래 3절) |
| delayMinutes | `estimated_at - scheduled_at` | 분 단위 반올림, 음수·15분 미만이면 0. 15분 기준은 백엔드 규칙 |
| isMyFlight | 요청 `flightNo` | 백엔드 계산 |

### Congestion (`GET /congestion`)
출처: `congestion_snapshots` → `airport_zones` → `terminals`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| terminal | `terminals.terminal_code` | T1/T2 |
| measuredAt | `MAX(measured_at)` (터미널 내) | KST |
| halls[].hallId | `airport_zones.hall_number` 또는 `hall_id` | 숫자. 범위는 코드에 고정하지 않는다. **[DB 확인 필요]** hall_number와 gate_id 구성(게이트 구역이 hall 몇 번에 속하는지, `parent_zone_id` 사용 여부) |
| halls[].hallName | 생성 | `"{hallId}번 출국장"`. `zone_name`은 원문이라 hall 이름으로 쓸 수 있는지 **[DB 확인 필요]** |
| halls[].waitingCount | `waiting_passenger_count` | 한 hall에 게이트 구역이 여러 개면 합산. 구역별 최신 `measured_at` 행만 쓴다 |
| halls[].level | 계산 | `waitingCount`를 LOW/MID/HIGH로 구분하는 임계값은 DB에 없다. 백엔드 상수로 정한다 (팀 합의 필요) |
| halls[].changeRate | 같은 구역의 전일 같은 시각 ±5분 `congestion_snapshots` | `(현재-전일)/전일*100`. 비교 행이 없거나 0이면 null. 전일 데이터가 쌓여 있어야 한다 |
| halls[].source | `source` | 그대로 (api) |

### FlightStats (`GET /stats/flights`)
출처: `flight_operations` 직접 집계. `daily_flight_summary`는 수집기가 채우지 않는다.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| date | `scheduled_at AT TIME ZONE 'Asia/Seoul'` | 예정일 기준 KST 날짜 |
| direction | `flow_type` | 대문자 코드 |
| total | 마스터 편 수 | 코드쉐어 제외. `is_codeshare IS NOT TRUE`로 센다. Slave만 제외하고 **NULL(빈 값)은 마스터로 본다.** **[DB 확인 필요]** 일반 편의 `is_codeshare`가 false인지 NULL인지 |
| breakdown[].category | 계산 | NORMAL / DELAYED / CANCELLED / DIVERTED. `source_status` 매핑 결과와 지연 15분 기준으로 분류 |
| breakdown[].count, ratio | 계산 | `ratio = count/total*100` 소수 1자리 |
| breakdown[].changeRate | - | **null 고정** (이력 테이블 미작성) |
| hourly[].hour, count, delayedCount | `scheduled_at`의 KST 시각별 집계 | 0~23 모두 채운다. 없는 시간은 0 |

### Alert (`GET /alerts`)
출처: `smart_alerts` (백엔드만 쓰는 테이블).

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| alertId | `alert_id`(bigint) | 문자열로 변환 |
| type | `alert_type`(text) | 대문자로 맞추고 DELAY / GATE_CHANGE / CONGESTION / WEATHER / BOARDING 중 하나로 저장 |
| severity | `severity` | `info→INFO`, `important→WARN`, `critical→CRITICAL` |
| title, message | `title`, `message` | 그대로 |
| flightNo | `flight_uid` → `flight_operations.flight_number` | 공항 전체 알림이면 null |
| isMine | 계산 | 요청 `flightNo`와 알림의 편명이 같으면 true |
| isImportant | 계산 | `severity`가 WARN 이상이면 true (규칙은 팀과 확인) |
| createdAt | `created_at` | KST |

알림 생성 규칙(어떤 변화가 알림이 되는지)은 백엔드가 정한다. `dedupe_key`는 `(종류, 대상, 변화 내용)`으로 만든다. 중복 방지에 `UNIQUE (dedupe_key, source)`를 쓴다.

### Weather (`GET /weather`)
출처: `weather_observations`(최신 1행, `airport_icao='RKSI'`) + `takeoff_weather_forecasts`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| observedAt | `observed_at` | KST |
| condition | `weather_phenomena`, `visibility_km` | **[DB 확인 필요]** `weather_phenomena`는 METAR `presentWeather` 코드를 ", "로 이은 문자열(NULL 가능). RA/DZ→RAIN, SN→SNOW, FG/BR→FOG 등으로 매핑. 구름량 컬럼이 없어 **CLEAR/CLOUDY는 구분 불가**. 현상이 없으면 null 또는 CLEAR로 할지 결정 필요 |
| temperature | `temperature_c` | 숫자 |
| windSpeed | `wind_speed_mps` | 숫자 |
| windDirection | `wind_direction_degrees` | 숫자 |
| visibility | `visibility_km` | 숫자 |
| pressure | `pressure_hpa` | 숫자 |
| crosswind.runway/direction/speed | 계산 | 활주로 방향은 DB에 없다. 백엔드 상수로 두고 `wind_direction_degrees`·`wind_speed_mps`로 `풍속*sin(풍향-활주로방위)` 계산 |
| operationScore.minutesAhead | 상수 | 60 |
| operationScore.score, level | 계산 | 풍속·시정 기반 자체 점수. 60분 후 값은 `takeoff_weather_forecasts`의 `valid_at`이 가장 가까운 행의 `wind_speed_mps`를 쓴다. 예보에는 시정이 없다 |
| operationScore.basis | 계산에 쓴 행의 `observed_at`/`valid_at` | 데이터 부족 시 null |
| operationScore.message | 백엔드 | 점수 구간별 문구 |

### Facility (`GET /facilities`)
출처: `airport_facilities` + `terminals`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| facilityId | `facility_id`(bigint) | 문자열로 변환 |
| name | `facility_name` | 그대로 |
| category | `facility_type`는 항상 NULL | `products_description`·`facility_name` 키워드로 LOUNGE / FOOD_CAFE / PHARMACY / SHOPPING / ETC 분류. 규칙은 **[DB 확인 필요]** (취급품목 실제 문구를 보고 확정) |
| items | `products_description` | 그대로 |
| terminal | `terminals.terminal_code` | T1/T2. CONCOURSE·NULL이면 `location_description`에서 추출, 실패 시 null |
| floor | `floor_label`은 항상 NULL | `location_description`에서 `\d+층`, `B\d` 등을 `1F`/`B1`로 추출, 실패 시 null |
| location | `location_description` | 그대로. 계약상 N이므로 NULL이면 빈 문자열이 아니라 해당 시설 제외를 검토 |
| area | `arrival_departure_area` | **[DB 확인 필요]** 값 종류. 수집기는 원문을 보존한다. `출국장→DEPARTURE`, `입국장→ARRIVAL` 같은 매핑을 값 확인 후 확정 |
| openTime, closeTime, is24h | `opening_hours_note` | **[DB 확인 필요]** 형식. 문자열 파싱이 필요하다 (`24시간`, `06:00~22:00`, 요일별 표기 등). `facility_opening_hours`는 비어 있다 |
| isOpen | 위 파싱 결과와 현재 KST 시각 | 파싱 실패 시 null |
| tel | `phone_number` | 그대로 |

### DashboardSummary, WebSocket
- 위 응답들을 조합한 것이다. 별도 컬럼은 없다.
- `generatedAt`, `myFlightNo`는 백엔드가 만든다.
- 푸시의 `data`는 해당 REST 응답과 같은 모양이다.

## 3. 백엔드가 정해야 하는 변환표

### 운항 상태 (`source_status` → 표준 코드)
`source_status`는 API `remark` 원문이다. `status` 컬럼은 `unknown` 고정이라 사용하지 않는다.

| 항목 | 내용 |
|---|---|
| 원문 값 종류 | **[DB 확인 필요]** `SELECT source_status, count(*) ... GROUP BY 1` |
| 표준 코드 | SCHEDULED, BOARDING_SOON, BOARDING, DELAYED, CANCELLED, DEPARTED, ARRIVED, DIVERTED |
| 원문이 NULL | 시각 기준으로 판단: `estimated_at - scheduled_at >= 15분`이면 DELAYED, 아니면 SCHEDULED |
| 원문이 매핑표에 없음 | 임의로 추측하지 않고 SCHEDULED로 두되 로그를 남긴다 |
| 지연 기준 | 15분 (백엔드 상수) |

### 터미널
- `terminals.terminal_code`: T1, T2, CONCOURSE. 계약은 T1/T2. CONCOURSE(P02, 탑승동) 편은 T1 소속으로 합칠지 별도 제외할지 팀 확인이 필요하다.

## 4. 지금 데이터로 못 채우는 필드

확인된 것:
| 필드 | 이유 | 응답 처리 |
|---|---|---|
| 도착편 전체 (`type=ARRIVAL`, `flights.arrivals`, `stats.arrival`) | 수집기가 `flow_type='departure'`만 적재 | 빈 배열 / 통계 total 0 |
| `breakdown[].changeRate` | 이력 테이블 미작성 | null |
| 상태 변경·게이트 변경 알림의 근거 이력 | `flight_operation_history`, `flight_status_history` 미작성 | 백엔드가 이전 스냅샷을 직접 비교해 알림을 만들어야 함 |

코드와 스키마로 추가 확인된 것:
| 필드 | 이유 | 응답 처리 |
|---|---|---|
| `Flight.status` | `status` 컬럼은 항상 `unknown` | `source_status` 매핑으로 대체 |
| `Flight.airline` (일부) | `airline_code` 미적재, 이름만 있음 | `airline_name` 사용 |
| `Facility.category`, `floor` | `facility_type`, `floor_label` 미적재 | 백엔드가 문구에서 추출 |
| `Facility.openTime/closeTime/is24h/isOpen` | `facility_opening_hours` 미적재, `opening_hours_note`만 있음 | 문자열 파싱, 실패 시 null |
| `Weather.condition`의 CLEAR/CLOUDY | 구름량 컬럼 없음 | null 또는 정책 결정 |
| `crosswind.*` | 활주로 정보가 DB에 없음 | 백엔드 상수로 계산 |
| 60분 후 시정 | 예보 테이블에 시정 컬럼 없음 | 풍속만으로 점수 계산하거나 현재 시정 사용 |
| `Hall.changeRate` | 전일 데이터가 쌓이기 전에는 비교값 없음 | null |
| `Hall.level` 임계값 | DB에 기준 없음 | 백엔드 상수 |

## 5. DB 확인 필요 목록 (접속되면 SELECT로 확인)

1. `flight_operations.source_status` 값 종류와 개수
2. `flight_operations.gate` 값 형식 (숫자만인지)
3. `flight_operations.is_codeshare`, `codeshare_type` 값 분포 (일반 편이 false인지 NULL인지)
4. `flight_operations.arrival_airport_name` 형식 (도시명인지)
5. `airport_zones`: `zone_type` 종류, `hall_number`, `hall_id`, `gate_id`, `parent_zone_id` 구성 / T1 1~6, T2 1~2가 맞는지
6. `terminals` 전체 3행
7. `weather_observations.weather_phenomena` 값 종류
8. `airport_facilities.arrival_departure_area` 값 종류, `opening_hours_note` 형식 샘플
9. `airport_facilities.products_description` 문구 (category 분류 규칙용)
10. 실제 RDS 컬럼이 PR #3 `schema.sql`과 일치하는지 (`information_schema.columns`)
