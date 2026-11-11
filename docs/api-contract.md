# API 계약 (ICN My Station)

이 문서가 프론트-백엔드 응답 형식의 기준이다. 필드는 추가만 하고, 변경·삭제는 팀 공유 후 진행한다.

## 공통 규칙
- 기본 경로: /api/v1
- JSON 필드명: camelCase
- 시간: ISO 8601, KST(+09:00). 예: 2026-11-05T14:30:00+09:00
- 에러 응답: {"detail": "메시지"}
- 404는 편명 단건 조회(GET /api/v1/flights/{flightNo})와 편명 상세(GET /api/v1/flights/{flightNo}/detail)에서 없는 편명일 때만 내려간다. 목록·요약·알림 조회에서 없는 편명을 flightNo로 보내면 404 없이 200으로 응답하며, 내 항공편 강조(isMyFlight)와 내 항공편 알림(isMine)만 적용되지 않는다.
- 상태값은 코드로 내려가며, 화면 문구와 색은 프론트에서 정한다.
- "null" 열이 Y인 필드는 값이 없을 때 null로 내려간다.
- 터미널 구분: 운항 현황·편의시설·알림(혼잡·항공편)은 터미널별, 운항 통계·날씨는 인천공항 공통, 탑승동은 T1. terminal을 지정하면 터미널을 모르는 데이터는 제외하고, 터미널을 특정할 수 없는 공통 알림(terminal null)은 남긴다.

## 엔드포인트

| 위젯 | 메서드 | 경로 | 파라미터 |
|---|---|---|---|
| 메인 요약 | GET | /api/v1/dashboard/summary | flightNo (선택), terminal=T1\|T2 (선택, 없으면 공항 전체) |
| 운항 현황 | GET | /api/v1/flights | type=DEPARTURE\|ARRIVAL, flightNo (선택), terminal=T1\|T2 (선택, 없으면 공항 전체) |
| 편명 단건 조회 | GET | /api/v1/flights/{flightNo} | 경로의 flightNo. 없는 편명이면 404 |
| 편명 상세 | GET | /api/v1/flights/{flightNo}/detail | 경로의 flightNo. 응답은 FlightDetail. 없는 편명이면 404 |
| 출국장 혼잡도 | GET | /api/v1/congestion | terminal=T1\|T2 |
| 시간대별 혼잡도 | GET | /api/v1/congestion/hourly | terminal=T1\|T2. 응답은 terminal, date, hours[hour, today, yesterday, level]. 측정이 없는 시간은 null |
| 운항 통계 | GET | /api/v1/stats/flights | direction=DEPARTURE\|ARRIVAL |
| 스마트 알림 | GET | /api/v1/alerts | flightNo (선택), terminal=T1\|T2 (선택, 없으면 공항 전체) |
| 날씨·운항 여건 | GET | /api/v1/weather | - |
| METAR 이력 | GET | /api/v1/weather/history | hours=1~48 (선택, 기본 24). 응답은 WeatherHistoryPoint[] |
| 편의시설 | GET | /api/v1/facilities | terminal=T1\|T2 (선택, 없으면 공항 전체) |
| 실시간 | WebSocket | /ws/live | - |

## 메인 요약 (DashboardSummary)

| 필드 | 타입 | null | 설명 |
|---|---|---|---|
| generatedAt | 시각 | N | 갱신 시각 |
| myFlightNo | 문자 | Y | 검색한 편명, 미선택이면 null |
| flights.departures | Flight[] | N | 출발편 최대 6건 |
| flights.arrivals | Flight[] | N | 도착편 최대 6건 |
| congestion.T1 | Congestion | N | T1 혼잡도 |
| congestion.T2 | Congestion | N | T2 혼잡도 |
| stats.departure | FlightStats | N | 출발 통계 |
| stats.arrival | FlightStats | N | 도착 통계 |
| alerts | Alert[] | N | 스마트 알림 |
| weather | Weather | N | 날씨·운항 여건 |
| facilities | Facility[] | N | 편의시설 |

## 편명 상세 (FlightDetail)

| 필드 | 타입 | null | 설명 |
|---|---|---|---|
| generatedAt | 시각 | N | 갱신 시각 |
| flight | Flight | N | 해당 편 |
| congestion | Congestion | N | 해당 편 터미널의 혼잡도 |
| alerts | Alert[] | N | 해당 편과 터미널 기준 스마트 알림 |
| weather | Weather | N | 날씨·운항 여건 |
| facilities | Facility[] | N | 해당 편 터미널의 편의시설. 운영 중 우선 최대 20건 |

## Flight (운항 현황 항목)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| flightNo | 문자 | N | KE703 | 편명 |
| airline | 문자 | N | 대한항공 | 항공사 |
| airlineCode | 문자 | Y | KE | IATA 항공사 코드. 로고 파일을 고르는 값이다. 수집값이 없으면 편명 앞 두 글자, 판별 불가면 null |
| type | 코드 | N | DEPARTURE | DEPARTURE / ARRIVAL |
| city | 문자 | N | 도쿄(나리타) | 출발편은 목적지, 도착편은 출발지 |
| airportCode | 문자 | N | NRT | 상대 공항 IATA 코드 |
| countryCode | 문자 | Y | JP | 상대 공항의 ISO 3166-1 국가 코드. 모르는 공항이면 null |
| scheduledAt | 시각 | N | | 예정 시각 |
| estimatedAt | 시각 | Y | | 변경 시각, 변경 없으면 null |
| terminal | 코드 | N | T1 | T1 / T2 |
| gate | 숫자 | Y | 248 | 미배정이면 null |
| status | 코드 | N | BOARDING | 운항 상태 코드 |
| delayMinutes | 숫자 | N | 25 | 지연 아니면 0 |
| isMyFlight | 불리언 | N | true | 요청한 flightNo와 일치하면 true |

## Congestion (출국장 혼잡도)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| terminal | 코드 | N | T1 | T1 / T2 |
| measuredAt | 시각 | N | | 기준 시각 |
| halls | Hall[] | N | | 출국장 목록 |

Hall

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| hallId | 숫자 | N | 2 | T1은 1~6, T2는 1~2 |
| hallName | 문자 | N | 2번 출국장 | 표시 이름 |
| waitingCount | 숫자 | N | 510 | 대기 인원(명) |
| level | 코드 | N | HIGH | LOW / MID / HIGH |
| changeRate | 숫자 | Y | 28.0 | 30분 전(±5분) 측정값 대비 %, 비교값 없으면 null |
| source | 코드 | N | api | api / yolo / demo |
| operationStatus | 코드 | Y | CHECK_REQUIRED | 최근 24시간 측정이 충분한데 합산 최대 인원이 매우 적으면 CHECK_REQUIRED(운영 확인 필요), 그 외 null. 미운영 확정이 아니다 |

## FlightStats (운항 통계)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| date | 문자 | N | 2026-11-05 | 기준 날짜(KST, 예정일 기준) |
| direction | 코드 | N | DEPARTURE | DEPARTURE / ARRIVAL |
| total | 숫자 | N | 482 | 전체 편수(마스터 편 기준) |
| breakdown | Breakdown[] | N | | 항목별 수치 |
| hourly | Hourly[] | N | | 시간대별 막대 |

Breakdown

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| category | 코드 | N | DELAYED | NORMAL / DELAYED / CANCELLED / DIVERTED |
| count | 숫자 | N | 72 | 편수 |
| ratio | 숫자 | N | 14.9 | 비율 % |
| changeRate | 숫자 | Y | 20.0 | 전일 같은 시각까지 대비 %. 이력 데이터가 쌓이기 전까지 null |

Hourly

| 필드 | 타입 | null | 설명 |
|---|---|---|---|
| hour | 숫자 | N | 0~23 |
| count | 숫자 | N | 해당 시간 운항 편수 |
| delayedCount | 숫자 | N | 해당 시간 지연 편수 |

## Alert (스마트 알림)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| alertId | 문자 | N | a1 | 알림 ID |
| type | 코드 | N | GATE_CHANGE | 알림 종류 코드 |
| severity | 코드 | N | CRITICAL | INFO / WARN / CRITICAL |
| title | 문자 | N | KE671 항공편 | 제목 |
| message | 문자 | N | 출발이 25분 지연되었습니다. | 내용 |
| flightNo | 문자 | Y | KE671 | 공항 전체 알림이면 null |
| isMine | 불리언 | N | true | 내 항공편 탭 표시 여부 |
| isImportant | 불리언 | N | true | 중요 알림 탭 표시 여부 |
| createdAt | 시각 | N | | 발생 시각 |
| terminal | 코드 | Y | T1 | 알림과 관련된 터미널(혼잡: 구역 기준, 항공편 알림: 항공편 기준). 특정할 수 없으면 null. WebSocket 알림도 이 값으로 프론트에서 거른다 |

## Weather (날씨·운항 여건)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| observedAt | 시각 | N | | 관측 시각 |
| condition | 코드 | Y | CLEAR | CLEAR / CLOUDY / RAIN / SNOW / FOG |
| temperature | 숫자 | Y | 18 | 기온 °C |
| windSpeed | 숫자 | Y | 8 | 풍속 m/s |
| windGust | 숫자 | Y | 12 | 돌풍 m/s. METAR에 없으면 null |
| windDirection | 숫자 | Y | 320 | 풍향(도). 방위 글자·나침반은 프론트 변환 |
| visibility | 숫자 | Y | 10 | 시정 km |
| pressure | 숫자 | Y | 1016 | 기압 hPa |
| crosswind.runway | 문자 | Y | 15/33 | 활주로 번호 |
| crosswind.activeRunway | 문자 | Y | 33 | 바람을 마주 보는 쪽 활주로 끝(15 또는 33). 풍속 1 m/s 미만(무풍)이거나 풍향을 모르면 null |
| crosswind.direction | 숫자 | Y | 270 | 측풍 방향(도) |
| crosswind.speed | 숫자 | Y | 8 | 측풍 속도 m/s |
| operationScore.minutesAhead | 숫자 | N | 60 | 몇 분 후 기준 |
| operationScore.score | 숫자 | Y | 87 | 기상 운항 여건 점수 0~100, 데이터 부족 시 null |
| operationScore.level | 코드 | Y | HIGH | LOW / MID / HIGH |
| operationScore.delayRisk | 코드 | Y | LOW | 출발 지연 위험 LOW / MID / HIGH. level을 뒤집은 값(HIGH→LOW, LOW→HIGH), level이 null이면 null |
| operationScore.basis | 시각 | Y | | 계산에 쓴 입력값의 관측 시각 |
| operationScore.message | 문자 | N | 운항 여건 양호 | 화면 문구 |

운항 여건 점수는 실제 운항 확률이 아니라 풍속·시정 기반 자체 계산 점수다.

## WeatherHistoryPoint (METAR 이력)

시각 오름차순이다.

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| observedAt | 시각 | N | | 관측 시각 |
| temperature | 숫자 | Y | 18 | 기온 °C |
| windSpeed | 숫자 | Y | 8 | 풍속 m/s |
| condition | 코드 | Y | RAIN | CLEAR / CLOUDY / RAIN / SNOW / FOG |
| phenomenon | 문자 | Y | -RA | METAR 기상 현상 코드, 없으면 null |
| visibility | 숫자 | Y | 10 | 시정 km |
| pressure | 숫자 | Y | 1016 | 기압 hPa |

## Facility (편의시설)

| 필드 | 타입 | null | 예시 | 설명 |
|---|---|---|---|---|
| facilityId | 문자 | N | f1 | 시설 ID |
| name | 문자 | N | 와이파이도시락 | 매장명 |
| category | 코드 | N | SHOPPING | 편의시설 코드 |
| items | 문자 | Y | 포켓와이파이 | 취급품목 |
| terminal | 코드 | Y | T2 | 위치 문장에서 추출, 실패 시 null |
| floor | 문자 | Y | 1F | 위치 문장에서 추출, 실패 시 null |
| location | 문자 | N | 제2여객터미널 1층 일반지역 | 원본 위치 문장 |
| area | 코드 | N | DEPARTURE | DEPARTURE(출국장) / ARRIVAL(입국장) |
| openTime | 문자 | Y | 06:00 | 운영 시작 |
| closeTime | 문자 | Y | 22:00 | 운영 종료 |
| is24h | 불리언 | N | false | 24시간 운영 여부 |
| isOpen | 불리언 | Y | true | 현재 운영 여부, 시간 해석 실패 시 null |
| tel | 문자 | Y | 1566-9070 | 전화번호 |
| crowdEstimate | 문자 | Y | MID | 주변 혼잡 예상. 실제 측정값이 아니다. LOW / MID / HIGH. 추정 근거가 없거나 영업 종료면 null |
| crowdBasis | 문자 | Y | HALL | 추정 기준. HALL / TERMINAL / FLIGHTS. crowdEstimate가 null이면 null |

## WebSocket /ws/live 메시지

| 필드 | 타입 | 설명 |
|---|---|---|
| topic | 코드 | congestion / flights / stats / alerts / weather |
| scope | 문자 (null 가능) | flights·stats는 DEPARTURE / ARRIVAL, congestion은 T1 / T2, alerts·weather는 null |
| data | 객체 또는 배열 | 해당 API 응답과 같은 모양(객체 또는 배열) |
| sentAt | 시각 | 보낸 시각 |

congestion 메시지는 터미널별로, flights·stats 메시지는 방향별로 따로 오며 scope로 구분한다.

yolo_* topic은 docs/yolo-demo-contract.md 5장 참고

## 코드값

| 구분 | 코드 |
|---|---|
| 운항 상태 | SCHEDULED, BOARDING_SOON, BOARDING, DELAYED, CANCELLED, DEPARTED, ARRIVED, DIVERTED |
| 혼잡 단계 | LOW, MID, HIGH |
| 출국장 운영 확인 | CHECK_REQUIRED |
| 주변 혼잡 예상 기준 | HALL, TERMINAL, FLIGHTS |
| 알림 중요도 | INFO, WARN, CRITICAL |
| 알림 종류 | DELAY, GATE_CHANGE, CONGESTION, WEATHER, BOARDING |
| 날씨 | CLEAR, CLOUDY, RAIN, SNOW, FOG |
| 편의시설 | LOUNGE, FOOD_CAFE, PHARMACY, SHOPPING, ETC |
| 데이터 출처 | api, yolo, demo |

YOLO DEMO 계약은 docs/yolo-demo-contract.md 참고
