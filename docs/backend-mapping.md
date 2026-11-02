# 백엔드 매핑 (API 계약 ↔ DB)

`docs/api-contract.md`의 필드가 어느 테이블·컬럼에서 오는지, 어떤 변환이 필요한지 정리한다.

## 근거
- 스키마: `origin/feature/db-api-schema-update`(PR #3)의 `database/schema.sql`. 실제 RDS의 `information_schema.columns`와 대조해 모든 테이블의 컬럼 수가 일치함을 확인했다.
- 적재 동작: `collection/pipeline/postgres_storage.py`의 `map_row`·`get_zones`·`terminal_name`, `normalize_all.py`.
- 실제 값: 공유 RDS에 읽기 전용 SELECT로 확인했다 (확인 시점의 데이터는 2026-10-29 수집분).
- 시간 컬럼은 모두 `timestamptz`이다. 응답에 내릴 때 KST(+09:00)로 변환한다.
- 모든 조회는 `source = 'api'`만 읽는다. demo·yolo와 섞지 않는다.

## 확정한 결정
| 항목 | 결정 |
|---|---|
| 탑승동(CONCOURSE) | 계약의 terminal에서 **T1으로 변환**한다. 탑승동 승객은 T1에서 체크인·출국심사를 받기 때문. |
| 코드쉐어 제외 집계 | `is_codeshare IS NOT TRUE` |
| 활주로 방향 | `backend/app/core/rules.py` 상수로 둔다 |
| 날씨 `condition` | 일기현상이 있으면 RAIN / SNOW / FOG, 없으면 **임시로 CLEAR**. 구름량 컬럼이 생기면 CLOUDY를 구분한다 (아래 메모) |
| 혼잡도 구역 묶음 | `hall_number` 기준으로 게이트 구역을 묶고 대기 인원을 합산한다 |
| 혼잡도 `changeRate` | 전일 대비가 아니라 **30분 전(±5분) 측정값 대비**. `docs/api-contract.md`의 Hall.changeRate 설명을 수정했다 |

## 1. 수집기가 각 테이블에 넣는 값

| 테이블 | 넣는 컬럼 | 넣지 않는 컬럼(항상 NULL/기본값) |
|---|---|---|
| `flight_operations` | `source_flight_id`(API `fid`), `flight_number`, `airline_name`, `flow_type`(**항상 `departure`**), `arrival_airport_code`, `arrival_airport_name`, `scheduled_at`, `estimated_at`, `terminal_id`, `source_terminal_code`, `gate`, `check_in_counter`, `source_status`(API `remark` 원문), `is_codeshare`, `codeshare_type`, `master_flight_number` | `status`는 **항상 `unknown`**, `airline_code`, `departure_airport_*`, `arrival_city_name`, `departure_city_name`, `actual_at`, `status_basis`, `master_source_flight_id`, `source_updated_at` |
| `congestion_snapshots` | `zone_id`, `measured_at`(분 단위 절삭), `source_measured_at`, `waiting_passenger_count`, `wait_time_raw`, `operating_time` | `estimation_basis`(yolo 전용) |
| `weather_observations` | `airport_icao`(RKSI 고정), `observed_at`, `wind_direction_degrees`, `wind_speed_mps`, `wind_gust_mps`, `temperature_c`, `pressure_hpa`, `visibility_km`, `weather_phenomena` | 구름·운량 컬럼은 스키마에 없음 |
| `takeoff_weather_forecasts` | `forecast_type='takeoff'`, `issued_at`(항상 NULL), `valid_at`, `wind_direction_degrees`, `wind_speed_mps`, `temperature_c`, `pressure_hpa` | 시정 없음 |
| `airport_facilities` | `facility_name`, `terminal_id`, `location_description`, `opening_hours_note`, `products_description`, `arrival_departure_area`, `phone_number`, `source_facility_key` | `facility_type`, `floor_label`, `zone_id` (전부 NULL 확인), `facility_opening_hours` 테이블 |
| `airport_zones`, `terminals` | 수집기는 쓰지 않고 조회만 한다 | - |

### 수집 코드에서 확인된 변환
- `terminal_name()`: `P01→T1`, `P03→T2`, `P02→CONCOURSE`. 계약에는 T1/T2만 쓰므로 백엔드가 CONCOURSE를 T1으로 바꾼다.
- `get_zones()`: `(terminal_code, upper(zone_code 또는 gate_id), zone_type)` → `zone_id`. 혼잡도는 API `gateId`를 `zone_type='departure_gate'` 구역에 붙인다.
- 풍속 kt→m/s, 기압 inHg/100→hPa, 시정 m→km는 수집기가 변환해서 저장한다. 백엔드는 다시 변환하지 않는다.
- `is_codeshare`: `Slave→true`, `Master→false`, 그 외 → `NULL`.

## 2. 실제 RDS 값 확인 결과

### terminals (3행)
| terminal_id | terminal_code | terminal_name | source_terminal_code |
|---|---|---|---|
| 1 | T1 | 제1여객터미널 | P01 |
| 2 | T2 | 제2여객터미널 | P03 |
| 3 | CONCOURSE | 탑승동 | P02 |

### airport_zones (42행)
| 터미널 | zone_type | 개수 | 내용 |
|---|---|---|---|
| T1 | departure_hall | 6 | `hall_id`=`DG1`~`DG6`, `hall_number` 1~6, `zone_name`="T1 출국장 N" |
| T2 | departure_hall | 2 | `hall_id`=`DG1`, `DG2`, `hall_number` 1~2 |
| T1 | departure_gate | 12 | `gate_id`=`DG{n}_E`/`DG{n}_W`, hall마다 2개. `hall_number`와 `parent_zone_id`(해당 hall의 zone_id)가 채워져 있음 |
| T2 | departure_gate | 8 | `gate_id`=`DG{n}_A`~`_D`, hall마다 4개. 같은 방식 |
| T1 / T2 | passenger_forecast_zone | 10 / 4 | `T1DG6`, `T1EG4`, `T2EG1` 등. `hall_number`·`gate_id` 없음 |

- 혼잡도 스냅샷은 **게이트 구역(20개)에만** 붙어 있고 hall 구역에는 없다. 모든 게이트 구역이 `hall_number`를 가지고 있어, **`hall_number` 기준으로 묶는 규칙이 맞다.** `parent_zone_id`로 묶어도 같은 결과다.
- hall 수는 T1 6개, T2 2개로 계약과 같다. 코드에는 범위를 고정하지 않고 DB에서 읽은 `hall_number` 집합을 쓴다.
- 확인 시점에 hall 단위로 합산하려면 같은 hall의 게이트들이 같은 `measured_at`을 가진다. T1은 모두 18:48, T2는 모두 18:49였다.

### flight_operations (1,142행, 전부 `source='api'`, `flow_type='departure'`)
- 예정일이 전부 2026-10-29 하나다. 현재 날짜(조회 시점)와 맞지 않을 수 있으므로 "오늘" 기준 조회가 비어 보일 수 있다.
- 터미널: T1 251, T2 717, CONCOURSE 174.
- `gate`: 1,142건 전부 값이 있고 전부 숫자 문자열 (`^[0-9]+$`). 정수 변환 가능.
- `is_codeshare`/`codeshare_type`: `True/Slave` 614, `False/Master` 528. NULL은 없다. `IS NOT TRUE` 규칙을 쓰면 마스터 편 528건이 집계 대상이다.
- `arrival_airport_name`은 도시명이다 (예: `도쿄/하네다`, `도쿄/나리타`, `오사카/ 간사이`, `싱가포르`). 슬래시 뒤 공백이 일정하지 않다. `arrival_city_name`은 NULL.
- `source_status` 분포:

| source_status | 건수 | 표준 코드 |
|---|---|---|
| 출발 | 867 | DEPARTED |
| NULL | 158 | 시각 기준 판단 (아래) |
| 탑승마감 | 43 | BOARDING |
| 지연 | 36 | DELAYED |
| 탑승준비 | 21 | BOARDING_SOON |
| 탑승중 | 10 | BOARDING |
| 마감예정 | 7 | BOARDING |

  관측된 값에는 결항·회항이 없다. 값이 나타나면 `결항→CANCELLED`, `회항→DIVERTED`로 처리한다 (미관측, 추정 규칙).
- 지연 시간: `지연` 36건은 전부 `estimated_at > scheduled_at`(최대 320분). `출발` 중 565건도 예상 시각이 예정보다 늦고 최대 275분이다. `NULL` 158건 중 5건이 늦고 최대 15분이다.

### weather_observations / takeoff_weather_forecasts
- 관측 2행(RKSI, 2026-10-29 17:30, 18:30 KST), 예보 5행(17:00~21:00 KST).
- `weather_phenomena`: 값이 있는 행은 2건이고 둘 다 `http://codes.wmo.int/306/4678/-RA` (WMO 코드 URL, 강도 접두 `-`). 수집기는 현상이 여러 개면 ", "로 잇는다.

### airport_facilities (1,093행)
- `facility_type`, `floor_label`, `zone_id`: 전부 NULL. `location_description`, `facility_name`은 NULL이 없다.
- 터미널: T1 458, T2 472, CONCOURSE 79, NULL 84.
- `arrival_departure_area`: `D` 1,056건, `A` 37건.
- `opening_hours_note`: 전부 `HH:MM ~ HH:MM` 형식이고 NULL 105건. 분포 상위: `00:00 ~ 24:00` 283건, `00:00 ~ 00:00` 256건, `06:00 ~ 22:00` 231건. 종료가 시작보다 이른 야간 운영이 2건 있다 (`05:30 ~ 01:30`, `06:00 ~ 00:30`).
- `location_description`의 층 표기: `3층` 494, `1층` 144, `4층` 134, `지하 1층` 78, `2층` 52, `지하1층` 34, `지하2층` 4, `5층` 3, `지하3층` 1, 층 표기 없음 149.
- `products_description`: NULL 162건, 의미 없는 값(`.` 90건, `-` 30건)이 있다.

### 비어 있는 테이블
`flight_operation_history`, `flight_status_history`, `smart_alerts`, `daily_flight_summary`, `facility_opening_hours`는 모두 0건이다.

## 3. 계약 필드별 매핑

### Flight (`GET /flights`, `dashboard/summary`의 flights)
출처: `flight_operations` + `terminals`. 현재 출발편만 있다.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| flightNo | `flight_number` | 그대로. `isMyFlight`·단건 조회는 대소문자·공백을 정규화해서 비교. 행 식별은 `flight_uid`/`source_flight_id`를 쓴다 |
| airline | `airline_name` | 그대로 (`airline_code`는 NULL) |
| type | `flow_type` | `departure→DEPARTURE`, `arrival→ARRIVAL` |
| city | 출발편: `arrival_airport_name` | 값이 도시명이다. 계약 예시(`도쿄(나리타)`)에 맞추려면 `A/ B` → `A(B)`로 바꾸고 공백을 정리한다 |
| airportCode | 출발편: `arrival_airport_code` | 도착편이 생기면 `departure_airport_code` |
| scheduledAt | `scheduled_at` | KST 변환 |
| estimatedAt | `estimated_at` | `scheduled_at`과 같으면 null |
| terminal | `terminals.terminal_code` | T1/T2 그대로, **CONCOURSE는 T1** |
| gate | `gate`(text) | `int()` 변환. 현재 전부 숫자라 실패하지 않지만 실패하면 null |
| status | `source_status` → 표준 코드 | `status` 컬럼은 `unknown` 고정이라 쓰지 않는다. 아래 4절 매핑표 사용 |
| delayMinutes | `estimated_at - scheduled_at` | 분 단위 반올림. 15분 미만이면 0 |
| isMyFlight | 요청 `flightNo` | 백엔드 계산 |

### Congestion (`GET /congestion`)
출처: `congestion_snapshots` → `airport_zones`(departure_gate) → `terminals`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| terminal | `terminals.terminal_code` | T1/T2 |
| measuredAt | hall 합산에 쓴 스냅샷의 `measured_at` 중 최신 | KST |
| halls[].hallId | `airport_zones.hall_number` (게이트 구역의 값) | 숫자. 범위는 코드에 고정하지 않는다 |
| halls[].hallName | 생성 | `"{hallId}번 출국장"` |
| halls[].waitingCount | 게이트 구역별 `waiting_passenger_count` | 같은 `hall_number`의 게이트 구역별 최신 값을 합산 |
| halls[].level | 계산 | 임계값은 DB에 없다. 백엔드 상수로 정한다 (관측 범위: 게이트당 0~283명, 평균 96명) |
| halls[].changeRate | 같은 게이트 구역의 **30분 전(±5분)** 스냅샷 | 현재 hall 합계와 30분 전 hall 합계를 비교한 `(현재-과거)/과거*100`. 과거 값이 없거나 0이면 null |
| halls[].source | `source` | 그대로 (api) |

`changeRate` 주의: 혼잡도 스냅샷이 현재 몇 분 간격으로 쌓이는지 불규칙하다 (확인된 `measured_at`이 17:32, 17:33, 18:40, 18:48, 18:49뿐이고 구역당 2~3건). 연속 수집 전에는 30분 전 비교값이 없어 대부분 null이 된다. 과거 합계는 hall의 모든 게이트에 비교 행이 있을 때만 계산한다 (일부만 있으면 합계가 작아져 변화율이 부풀려진다).

### FlightStats (`GET /stats/flights`)
출처: `flight_operations` 직접 집계. `daily_flight_summary`는 비어 있다.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| date | `(scheduled_at AT TIME ZONE 'Asia/Seoul')::date` | 예정일 기준 KST 날짜 |
| direction | `flow_type` | 대문자 코드 |
| total | `is_codeshare IS NOT TRUE`인 편 수 | 마스터 편만 센다 |
| breakdown[].category | 계산 | NORMAL / DELAYED / CANCELLED / DIVERTED. 4절 규칙 |
| breakdown[].count, ratio | 계산 | `ratio = count/total*100` 소수 1자리 |
| breakdown[].changeRate | - | **null 고정** (이력 테이블 미작성) |
| hourly[].hour, count, delayedCount | `scheduled_at`의 KST 시각별 집계 | 0~23 모두 채운다. 없는 시간은 0 |

### Alert (`GET /alerts`)
출처: `smart_alerts` (백엔드만 쓰는 테이블, 현재 0건).

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| alertId | `alert_id`(bigint) | 문자열로 변환 |
| type | `alert_type`(text) | DELAY / GATE_CHANGE / CONGESTION / WEATHER / BOARDING 중 하나로 저장 |
| severity | `severity` | `info→INFO`, `important→WARN`, `critical→CRITICAL` |
| title, message | `title`, `message` | 그대로 |
| flightNo | `flight_uid` → `flight_operations.flight_number` | 공항 전체 알림이면 null |
| isMine | 계산 | 요청 `flightNo`와 알림의 편명이 같으면 true |
| isImportant | 계산 | `severity`가 WARN 이상이면 true |
| createdAt | `created_at` | KST |

알림 생성 규칙은 백엔드가 정한다. 중복 방지는 `UNIQUE (dedupe_key, source)`를 쓴다.

### Weather (`GET /weather`)
출처: `weather_observations`(최신 1행, `airport_icao='RKSI'`) + `takeoff_weather_forecasts`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| observedAt | `observed_at` | KST |
| condition | `weather_phenomena` | 값 끝의 코드(URL이면 마지막 경로 조각)에서 강도 접두(`+`, `-`)를 떼고 판단: `RA`·`DZ`·`SHRA`·`TSRA` 포함 → RAIN, `SN`·`SG`·`SHSN` 포함 → SNOW, `FG`·`BR` 포함 → FOG. 여러 개면 RAIN > SNOW > FOG 순. 일기현상이 없으면 **임시로 CLEAR** |
| temperature | `temperature_c` | 숫자 |
| windSpeed | `wind_speed_mps` | 숫자 |
| windDirection | `wind_direction_degrees` | 숫자 |
| visibility | `visibility_km` | 숫자 |
| pressure | `pressure_hpa` | 숫자 |
| crosswind.runway/direction/speed | 계산 | 활주로 방향은 `rules.py` 상수. `wind_direction_degrees`·`wind_speed_mps`로 `풍속*sin(풍향-활주로방위)` 계산 |
| operationScore.minutesAhead | 상수 | 60 |
| operationScore.score, level | 계산 | 풍속·시정 기반 자체 점수. 60분 후 풍속은 `takeoff_weather_forecasts`에서 `valid_at`이 가장 가까운 행을 쓴다. 예보에는 시정이 없다 |
| operationScore.basis | 계산에 쓴 행의 `observed_at`/`valid_at` | 데이터 부족 시 null |
| operationScore.message | 백엔드 | 점수 구간별 문구 |

**메모 (condition):** 구름량 컬럼이 없어 CLEAR와 CLOUDY를 구분할 수 없다. 지금의 CLEAR는 "일기현상 없음"의 임시값이다. 구름량 컬럼이 생기면 구름이 있을 때 CLOUDY를 내리도록 이 규칙을 바꾼다.

### Facility (`GET /facilities`)
출처: `airport_facilities` + `terminals`.

| 계약 필드 | 출처 | 변환 규칙 |
|---|---|---|
| facilityId | `facility_id`(bigint) | 문자열로 변환 |
| name | `facility_name` | 그대로 |
| category | `facility_type`은 전부 NULL | `facility_name`·`products_description` 키워드로 LOUNGE / FOOD_CAFE / PHARMACY / SHOPPING / ETC 분류 (예: `커피`·`음료`·`식사`·`뷔페` → FOOD_CAFE, `면세`·`화장품`·`가방`·`주류` → SHOPPING, 못 찾으면 ETC). 키워드는 구현 때 실제 문구로 확정 |
| items | `products_description` | 그대로. `.`, `-`, 빈 값은 null |
| terminal | `terminals.terminal_code` | T1/T2, **CONCOURSE는 T1**. NULL(84건)이면 `location_description`에서 `제1여객터미널`/`제2여객터미널`/`탑승동`을 찾고, 없으면 null |
| floor | `location_description` | 정규식으로 `지하 ?N층` → `BN`, `N층` → `NF`. 층 표기가 없으면 null (149건) |
| location | `location_description` | 그대로 (NULL 없음) |
| area | `arrival_departure_area` | `D→DEPARTURE`, `A→ARRIVAL`, 그 외 값은 DEPARTURE로 두지 말고 해당 시설을 제외 |
| openTime, closeTime, is24h | `opening_hours_note` | `HH:MM ~ HH:MM` 파싱. `00:00 ~ 24:00`은 is24h=true. `00:00 ~ 00:00`(256건)은 24시간 운영으로 보는 것이 맞는지 확인 필요 (아래 5절). NULL이면 모두 null, is24h=false |
| isOpen | 위 결과와 현재 KST 시각 | 종료가 시작보다 이르면 자정을 넘는 운영(`05:30 ~ 01:30`)으로 계산. 파싱 실패·NULL이면 null |
| tel | `phone_number` | 그대로 |

### DashboardSummary, WebSocket
- 위 응답들을 조합한 것이다. 별도 컬럼은 없다.
- `generatedAt`, `myFlightNo`는 백엔드가 만든다.
- 푸시의 `data`는 해당 REST 응답과 같은 모양이다.

## 4. 백엔드가 정하는 변환 규칙

### 운항 상태
- 표준 코드: SCHEDULED, BOARDING_SOON, BOARDING, DELAYED, CANCELLED, DEPARTED, ARRIVED, DIVERTED.
- 매핑표는 2절의 `source_status` 표를 쓴다. 매핑에 없는 값은 SCHEDULED로 두고 로그를 남긴다.
- `source_status`가 NULL(158건)이면 `estimated_at - scheduled_at >= 15분`일 때 DELAYED, 아니면 SCHEDULED.
- 지연 기준은 15분 (백엔드 상수).
- 도착편 상태 ARRIVED는 도착편이 수집되면 매핑표에 추가한다.

### 운항 통계 분류 (NORMAL / DELAYED / CANCELLED / DIVERTED)
- CANCELLED / DIVERTED는 매핑된 상태로 판단한다.
- DELAYED는 매핑 상태가 DELAYED이거나 지연이 15분 이상인 경우다. `출발`로 표기된 편 중 지연 출발이 565건이나 되므로, **상태 문구만 보면 지연이 크게 적게 잡힌다.** 이 규칙은 `daily_flight_summary` 주석("API 상태 우선, 상태가 없으면 15분 규칙")과 다르므로 팀 확인이 필요하다.
- 그 외는 NORMAL.

## 5. 남은 확인·결정 사항

1. `00:00 ~ 00:00`(256건)을 24시간 운영으로 볼지 (`00:00 ~ 24:00`과 같은 의미로 보인다). 시설 몇 곳의 위치·품목을 보고 확정한다.
2. 통계 DELAYED 분류에 지연 15분 규칙을 상태 문구보다 우선할지 (4절).
3. `탑승마감`을 BOARDING으로 둘지. 계약 코드에 "탑승 마감"이 없어 임시로 BOARDING으로 매핑했다.
4. 수집 데이터가 2026-10-29 하나뿐이다. 연속 수집이 시작되어야 `changeRate`와 "오늘" 기준 조회를 검증할 수 있다.
5. `city` 변환(`도쿄/나리타` → `도쿄(나리타)`)이 프론트 표시와 맞는지 프론트와 확인한다.

## 6. 지금 데이터로 못 채우는 필드

확인된 것:
| 필드 | 이유 | 응답 처리 |
|---|---|---|
| 도착편 전체 (`type=ARRIVAL`, `flights.arrivals`, `stats.arrival`) | 수집기가 `flow_type='departure'`만 적재 | 빈 배열 / 통계 total 0 |
| `breakdown[].changeRate` | 이력 테이블 미작성 | null |
| 상태 변경·게이트 변경 알림의 근거 이력 | `flight_operation_history`, `flight_status_history` 0건 | 백엔드가 이전 스냅샷을 직접 비교해 알림을 만들어야 함 |

DB 조회로 추가 확인된 것:
| 필드 | 이유 | 응답 처리 |
|---|---|---|
| `Flight.status` | `status` 컬럼이 `unknown` 고정 | `source_status` 매핑으로 대체 |
| `Flight.airline` (코드) | `airline_code` 미적재 | `airline_name`만 사용 |
| `Facility.category`, `floor` | `facility_type`, `floor_label` 전부 NULL | 백엔드가 문구에서 추출 |
| `Facility.openTime/closeTime/is24h/isOpen` | `facility_opening_hours` 0건 | `opening_hours_note` 파싱 |
| `Weather.condition`의 CLOUDY | 구름량 컬럼 없음 | 임시 CLEAR (3절 메모) |
| `crosswind.*` | 활주로 정보가 DB에 없음 | `rules.py` 상수로 계산 |
| 60분 후 시정 | 예보 테이블에 시정 컬럼 없음 | 풍속만 예보값을 쓰고 시정은 현재 관측값 사용 |
| `Hall.changeRate` | 스냅샷 간격이 불규칙하고 건수가 적음 | 비교값 없으면 null |
| `Hall.level` 임계값 | DB에 기준 없음 | 백엔드 상수 |
| 알림 (`GET /alerts`) | `smart_alerts` 0건 | 백엔드가 생성하기 전까지 빈 배열 |
