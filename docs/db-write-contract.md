# DB 쓰기 계약 (백엔드 → smart_alerts)

백엔드가 공유 DB에 쓰는 형식의 기준 문서다. DB 담당(박수암)과 합의한 내용이며, 바꿀 때는 먼저 공유한다.
백엔드가 쓰는 테이블은 smart_alerts 하나뿐이고, 다른 테이블은 읽기만 한다.

## 쓰기 방식
- INSERT만 한다. UPDATE, DELETE는 하지 않는다.
- 같은 이벤트가 다시 감지되면 넣지 않는다: `INSERT ... ON CONFLICT (dedupe_key, source) DO NOTHING`
- 같은 대상이라도 새로운 변경이 생기면 dedupe_key가 달라져 별도 알림으로 들어간다.
- 테스트는 로컬 DB에서만 하고, 공유 DB에 테스트 데이터를 넣지 않는다.
- 감지에 쓰는 데이터가 15분보다 오래됐으면 알림을 만들지 않는다(과거 데이터로 '지금' 알림을 만들지 않기 위해)
## 저장하는 알림 종류 (3가지)

| alert_type | 내용 | 연결 컬럼 |
|---|---|---|
| congestion | 출국장 혼잡 진입, 30분 전 대비 급증 | zone_id (출국장 단위 = 게이트 구역의 parent_zone_id) |
| delay | 항공편 지연, 결항 | flight_uid |
| gate_change | 항공편 게이트 변경 | flight_uid |

탑승 시작, 기상 알림은 저장하지 않는다. API 응답을 만들 때만 계산한다.

## 공통 컬럼

| 컬럼 | 값 |
|---|---|
| source | 원본 데이터의 source 그대로. 항공편 알림은 해당 flight_operations 행의 source와 같아야 한다(외래키). 혼잡 알림은 판단에 쓴 스냅샷의 source(yolo가 섞이면 yolo) |
| alert_type | congestion / delay / gate_change |
| severity | info / important / critical |
| title, message | 화면에 보일 한글 문구 |
| created_at | 기본값(now) |
| zone_id | congestion만. 나머지는 NULL |
| flight_uid | delay, gate_change만. 나머지는 NULL |
| unit | congestion: 명, delay: 분(결항은 NULL), gate_change: NULL |

previous_value, current_value 안의 시각은 ISO 8601, +09:00 형식이다.

## 알림별 형식

### congestion
| 경우 | severity | previous_value | current_value | dedupe_key |
|---|---|---|---|---|
| 혼잡 진입 (LOW/MID → HIGH) | important | `{"waiting_count": 250, "level": "MID", "measured_at": "..."}` | `{"waiting_count": 520, "level": "HIGH", "measured_at": "..."}` | `congestion:{zone_id}:enter:{30분 단위 시각}` |
| 급증 (30분 전 대비) | important | 30분 전 값, 형식 동일 | 현재 값, 형식 동일 | `congestion:{zone_id}:surge:{30분 단위 시각}` |

- 30분 단위 시각: 측정 시각을 30분 단위로 내림한 값. 예: 2026-11-02T18:30
- 급증 기준은 백엔드 rules.py에서 관리한다(예: 30% 이상이면서 100명 이상 증가).

### delay
| 경우 | severity | previous_value | current_value | dedupe_key |
|---|---|---|---|---|
| 지연 (15분 이상) | 60분 미만 important, 60분 이상 critical | `{"delay_minutes": 0, "estimated_at": null}` (직전 상태) | `{"delay_minutes": 25, "estimated_at": "...", "source_status": "지연"}` | `delay:{flight_uid}:{지연 분을 15분 단위로 내림}` |
| 결항 | critical | `{"source_status": "탑승준비"}` | `{"source_status": "결항"}` | `delay:{flight_uid}:cancelled` |

지연이 25분에서 40분으로 늘면 dedupe_key가 delay:{uid}:15에서 delay:{uid}:30으로 바뀌어 새 알림이 생긴다.

### gate_change
| severity | previous_value | current_value | dedupe_key |
|---|---|---|---|
| important | `{"gate": "12"}` | `{"gate": "23"}` | `gate_change:{flight_uid}:{이전 게이트}->{새 게이트}` |

게이트가 처음 배정되는 경우(NULL → 값)는 변경으로 보지 않는다.

## API 응답과의 관계
API 응답은 docs/api-contract.md의 Alert 형식을 따른다. 변환은 백엔드가 한다.
- alert_type → type: congestion → CONGESTION, delay → DELAY, gate_change → GATE_CHANGE
- severity → severity: info → INFO, important → WARN, critical → CRITICAL
- isImportant: severity가 important 또는 critical이면 true