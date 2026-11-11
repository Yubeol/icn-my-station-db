# YOLO DEMO 계약 (v0.2, 2026-11-11)

실제 공항 CCTV가 아닌 DEMO 카메라용 계약이다. 필드는 추가만 하고 기존 필드의 이름·의미는 바꾸지 않는다.

## 0. 구성

```
휴대폰 앱 ──/ws/yolo/camera──▶ EC2 백엔드 ──/ws/yolo/view──▶ 대시보드(브라우저)
                                  ▲   │
                    /ws/yolo/worker │   └──/ws/live──▶ 대시보드(구역 인원·긴급 알림)
                                  ▼
                           YOLO 워커(학교 PC GPU)
```

- 백엔드는 프레임을 중계하고 결과를 처리한다. 추론은 하지 않는다.
- 1차 범위: person, head, help_gesture

## 1. 공통 규칙

### 1.1 식별자
- cameraId: 문자열. 1차 카메라 = `cam-t1-hall3` (T1 3번 출국장)
- frameId: 카메라가 매기는 정수. 연결마다 1부터 1씩 증가 (uint32)
- 시간: JSON 안의 시각은 ISO 8601 + 오프셋 (예: `2026-11-12T14:03:05.120+09:00`), 바이너리 헤더의 capturedAt은 epoch 밀리초

### 1.2 바이너리 프레임 형식 (camera → 백엔드, 백엔드 → worker, 백엔드 → view 공통)

| 위치 | 크기 | 내용 |
| --- | --- | --- |
| 0 | 4바이트 | 헤더 길이 N (uint32, big-endian) |
| 4 | N바이트 | 헤더 JSON (UTF-8) |
| 4+N | 나머지 | JPEG 바이트 |

헤더 JSON:
```json
{"cameraId": "cam-t1-hall3", "frameId": 1523, "capturedAt": 1762923785120, "width": 640, "height": 360}
```

- JPEG: 640×360, 품질 0.65 권장
- /ws/yolo/* 경로의 텍스트 프레임은 모두 JSON이며 `type` 필드를 가진다. (/ws/live는 기존 envelope를 따른다. 5장 참고)

### 1.3 인증
- camera, worker는 쿼리 파라미터 `token`으로 인증한다. 값은 백엔드 .env의 `YOLO_CAMERA_TOKEN`, `YOLO_WORKER_TOKEN`.
- view는 1차에서 토큰 없음 (DEMO 화면 전용).

### 1.4 종료 코드
| 코드 | 의미 |
| --- | --- |
| 4401 | 토큰 오류 |
| 4404 | 등록되지 않은 cameraId |
| 4409 | 같은 cameraId 카메라 또는 새 워커가 연결되어 기존 연결이 대체됨 |

## 2. /ws/yolo/camera (휴대폰 앱 → 백엔드)

`wss://<host>/ws/yolo/camera?cameraId=cam-t1-hall3&token=...` (HTTP 배포면 `ws://`)

1. 연결되면 백엔드가 보낸다:
   ```json
   {"type": "hello", "cameraId": "cam-t1-hall3", "maxFps": 10}
   ```
2. 앱은 1.2 형식의 바이너리 프레임을 최대 `maxFps`로 보낸다.
3. 같은 cameraId로 새 연결이 오면 기존 연결은 4409로 닫힌다.
4. 앱은 연결이 끊기면 1초 → 2초 → 4초(최대 4초) 간격으로 재연결한다.

## 3. /ws/yolo/worker (워커 ↔ 백엔드)

`wss://<host>/ws/yolo/worker?token=...`

1. 연결 직후 워커가 보낸다:
   ```json
   {"type": "hello", "workerId": "suam-school-pc", "modelVersion": "icn-v1-yolo26n", "classes": ["person", "head", "help_gesture"]}
   ```
2. 백엔드는 1.2 형식의 바이너리 프레임을 보낸다.
   - 한 번에 하나만 보낸다. 결과를 받거나 2초가 지나면 그때의 최신 프레임을 보낸다.
   - 보내는 빈도는 최대 초당 3장.
3. 워커는 프레임마다 결과를 하나 보낸다:
   ```json
   {
     "type": "result",
     "cameraId": "cam-t1-hall3",
     "frameId": 1523,
     "capturedAt": 1762923785120,
     "inferMs": 42.5,
     "personCount": 4,
     "detections": [
       {"cls": "head", "conf": 0.91, "box": [0.42, 0.18, 0.51, 0.33], "trackId": 7},
       {"cls": "person", "conf": 0.88, "box": [0.38, 0.15, 0.58, 0.97], "trackId": 7},
       {"cls": "help_gesture", "conf": 0.81, "box": [0.60, 0.40, 0.68, 0.55], "trackId": 7}
     ],
     "events": []
   }
   ```
   - box: `[x1, y1, x2, y2]`, 이미지 크기 대비 0~1 비율
   - trackId: ByteTrack ID. 같은 사람의 head·person·help_gesture는 같은 trackId를 쓴다. 없으면 null
   - personCount: 워커가 head·person 짝짓기 후 계산한 현재 인원
4. 제스처 판정 (워커 담당):
   - 같은 trackId에서 help_gesture가 1.5초 이상 유지되면 `events`에 넣는다.
   - 같은 trackId는 10초 동안 다시 넣지 않는다.
   ```json
   "events": [
     {"eventType": "HELP_GESTURE", "trackId": 7, "confidence": 0.83, "detectedAt": "2026-11-12T14:03:05.120+09:00"}
   ]
   ```
5. 프레임을 처리하지 못하면:
   ```json
   {"type": "error", "frameId": 1523, "code": "BAD_FRAME", "message": "decode failed"}
   ```
   code: `BAD_FRAME`, `MODEL_ERROR`
6. 활성 워커는 하나다. 새 워커가 연결되면 기존 워커는 4409로 닫히고 새 워커로 넘어간다.

## 4. /ws/yolo/view (백엔드 → 대시보드)

`wss://<host>/ws/yolo/view?cameraId=cam-t1-hall3`

1. 연결 직후와 상태가 바뀔 때:
   ```json
   {"type": "status", "cameraId": "cam-t1-hall3", "camera": "ONLINE", "worker": "ONLINE"}
   ```
   값: `ONLINE`, `OFFLINE`
2. 바이너리 프레임(1.2 형식)을 최대 10fps로 보낸다.
3. 결과가 오면:
   ```json
   {
     "type": "result",
     "cameraId": "cam-t1-hall3",
     "frameId": 1523,
     "personCount": 4,
     "crowdLevel": "LOW",
     "inferMs": 42.5,
     "detections": [ ... 3번과 동일 ... ]
   }
   ```
   - 프론트는 가장 최근 result의 박스를 다음 result가 올 때까지 유지해서 그린다.
   - 현재 표시 중인 프레임보다 frameId가 작은 result는 버린다.
4. 대시보드는 이 경로로 아무것도 보내지 않는다.

## 5. /ws/live 추가 메시지

기존 /ws/live envelope를 그대로 쓴다: `{"topic", "scope", "data", "sentAt"}` (backend/app/schemas.py LiveMessage)

| topic | scope | 보내는 때 | data |
| --- | --- | --- | --- |
| `yolo_camera` | 터미널(`T1`) | 접속 직후 스냅샷, 카메라·워커 연결 상태가 바뀔 때 즉시 | cameraId, zoneId, camera, worker |
| `yolo_count` | 터미널(`T1`) | 접속 직후 스냅샷(마지막 값), 카메라·워커가 연결된 동안 초당 1회 | cameraId, zoneId, personCount, crowdLevel, measuredAt |
| `yolo_alert` | null | 제스처 이벤트가 새로 저장될 때 즉시 | eventId, cameraId, zoneId, eventType, confidence, detectedAt, reviewStatus("PENDING") |
| `yolo_alert_reviewed` | null | 판정이 바뀔 때 즉시 | eventId, reviewStatus, reviewedAt |

- yolo_* 메시지는 기존 `ws_push_interval_seconds` 주기와 별도로 보낸다. 기존 8개 메시지의 주기와 순서는 바꾸지 않는다.
- 판정 대기 중인 알림은 스냅샷에 넣지 않는다. 프론트는 접속할 때 `GET /api/v1/yolo/events?reviewStatus=PENDING`으로 조회한다.
- camera, worker 값: `ONLINE`, `OFFLINE`

예시:
```json
{"topic": "yolo_count", "scope": "T1", "data": {"cameraId": "cam-t1-hall3", "zoneId": 0, "personCount": 4, "crowdLevel": "LOW", "measuredAt": "2026-11-12T14:03:05+09:00"}, "sentAt": "2026-11-12T14:03:05+09:00"}
{"topic": "yolo_alert", "scope": null, "data": {"eventId": 12, "cameraId": "cam-t1-hall3", "zoneId": 0, "eventType": "HELP_GESTURE", "confidence": 0.83, "detectedAt": "2026-11-12T14:03:05.120+09:00", "reviewStatus": "PENDING"}, "sentAt": "2026-11-12T14:03:05+09:00"}
```

## 6. REST API

### GET /api/v1/yolo/cameras
```json
[{"cameraId": "cam-t1-hall3", "zoneId": 0, "name": "T1 3번 출국장 DEMO", "isActive": true, "camera": "ONLINE", "worker": "ONLINE"}]
```

### GET /api/v1/yolo/events?cameraId=&reviewStatus=&limit=50
- 최신순. limit 최대 200

### PATCH /api/v1/yolo/events/{eventId}
요청:
```json
{"reviewStatus": "CONFIRMED"}
```
- reviewStatus: `CONFIRMED`, `FALSE_POSITIVE`
- PENDING인 이벤트만 바꿀 수 있다. 이미 판정된 이벤트는 409
- 성공하면 바뀐 이벤트를 반환하고 /ws/live로 `yolo_alert_reviewed`를 보낸다

## 7. 백엔드 상수

| 이름 | 값 | 비고 |
| --- | --- | --- |
| CROWD_LEVEL | LOW 0~5명, MID 6~10명, HIGH 11명 이상 | DEMO용 기준, 화면에 표시 |
| VIEW_MAX_FPS | 10 | |
| WORKER_MAX_FPS | 3 | |
| WORKER_TIMEOUT_SEC | 2 | |
| COUNT_BUCKET_SEC | 30 | |
| EVENT_DEDUPE_SEC | 10 | dedupe_key = `{cameraId}:{eventType}:{trackId}:{detectedAt를 10초로 내림}` |

## 8. DB (DDL은 database/, 작성 박수암)

### demo_yolo_cameras
| 컬럼 | 타입 | 비고 |
| --- | --- | --- |
| camera_id | VARCHAR(50) PK | |
| zone_id | airport_zones.zone_id와 같은 타입, FK | |
| name | VARCHAR(100) | |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

### demo_yolo_counts
| 컬럼 | 타입 | 비고 |
| --- | --- | --- |
| id | BIGSERIAL PK | |
| camera_id | VARCHAR(50) FK | |
| bucket_start | TIMESTAMPTZ | 30초 구간 시작 |
| person_avg | NUMERIC(5,2) | |
| person_max | INTEGER | |
| sample_count | INTEGER | 구간 안 결과 수 |
| crowd_level | VARCHAR(10) | LOW / MID / HIGH |
| model_version | VARCHAR(50) | |
| created_at | TIMESTAMPTZ DEFAULT now() | |
| | UNIQUE(camera_id, bucket_start) | |

### demo_yolo_events
| 컬럼 | 타입 | 비고 |
| --- | --- | --- |
| id | BIGSERIAL PK | eventId |
| camera_id | VARCHAR(50) FK | |
| event_type | VARCHAR(30) | CHECK IN ('HELP_GESTURE') |
| confidence | NUMERIC(4,3) | |
| detected_at | TIMESTAMPTZ | |
| model_version | VARCHAR(50) | |
| review_status | VARCHAR(20) DEFAULT 'PENDING' | CHECK IN ('PENDING','CONFIRMED','FALSE_POSITIVE') |
| reviewed_at | TIMESTAMPTZ NULL | |
| dedupe_key | VARCHAR(200) UNIQUE | |
| created_at | TIMESTAMPTZ DEFAULT now() | |

이미지, 박스 좌표, trackId는 저장하지 않는다.
