# API별 수집 작업 운영

현재 파일은 작업 정의이며 Jenkins에 Job을 생성했다는 뜻이 아닙니다.
기존 `icn-dashboard-ci`와 에이전트 `icn-ci`를 그대로 사용합니다.
수집기 본체는 `collection.pipeline.jobs`이며 이 디렉터리는 실행과 로그 보호만 담당합니다.

## 사전 준비

1. 이 변경이 검증되어 main에 병합된 후 작업을 생성합니다. 파이프라인은 실행 시 main을 체크아웃합니다.
2. Jenkins 관리 → Credentials → 적절한 저장소 → Add Credentials에서 **Secret file**을 선택합니다.
3. ID를 `icn-collection-env`로 지정하고 아래 필드가 들어 있는 실제 환경 파일을 등록합니다. 파일이나 값은 Git에 올리지 않습니다.

필수 필드: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
선택 필드: `DB_PORT`(5432), `DB_SSLMODE`(require).
공공데이터 수집: `PUBLIC_DATA_KEY`. METAR 수집: `KMA_API_KEY`.
Jenkins 에이전트에서 RDS로 접속할 수 있어야 합니다. RDS 보안 그룹의 DB 포트는 해당 EC2 보안 그룹을 소스로 허용합니다.

## Job 생성

New Item → 아래 이름 → Pipeline → Pipeline script from SCM → Git.
Repository URL: `https://github.com/donacana/icn-my-station-db.git`
Branch: `*/main`. Script Path는 표의 경로를 사용합니다.
수집 Job에서 Poll SCM, GitHub hook trigger를 선택하지 않습니다.
처음에는 Build periodically도 선택하지 않습니다.

| Job | Script Path | sources | 승인 후 후보 스케줄(KST) |
|---|---|---|---|
| icn-collection-congestion | infra/jenkins/collection/Jenkinsfile.congestion | congestion_t1 congestion_t2 | `*/3 * * * *` |
| icn-collection-flights | infra/jenkins/collection/Jenkinsfile.flights | flights | `*/15 * * * *` |
| icn-collection-passengers | infra/jenkins/collection/Jenkinsfile.passengers | passenger_forecast | `0 6,12,18 * * *` |
| icn-collection-takeoff | infra/jenkins/collection/Jenkinsfile.takeoff | takeoff_forecast | `0 * * * *` |
| icn-collection-facilities | infra/jenkins/collection/Jenkinsfile.facilities | facilities | `0 4 * * *` |
| icn-collection-metar | infra/jenkins/collection/Jenkinsfile.metar | metar | 미확정, 활성화 금지 |

Cron 입력 첫 줄에는 반드시 `TZ=Asia/Seoul`을 둡니다. 환경변수 TZ만으로 Jenkins 스케줄 시간대가 변경되지는 않습니다.
3분은 매시 00,03,…,57분, 15분은 00,15,30,45분입니다. 실행 대기/장시간 실행 시 실제 시작은 지연될 수 있습니다.
`disableConcurrentBuilds()`로 동일 Job이 동시에 실행되지 않습니다. 기존 에이전트 executor가 1이면 Job 사이에도 대기합니다.
15분 timeout에는 설치/수집/승인 대기가 포함됩니다.

## 수동 검증

첫 실행으로 파라미터를 등록한 후 Build with Parameters를 사용합니다.
`APPLY=false`, `ROW_LIMIT=10`, `MAX_REQUESTS=35`로 시작합니다.
dry-run도 실제 API 호출, 로컬 파일 생성, RDS 읽기를 수행합니다.
`ROW_LIMIT`는 DB 입력 행만 제한합니다. API 호출량은 별도 `MAX_REQUESTS`로 제한됩니다.
로그의 PHASE 및 RESULT를 확인합니다. COLLECT 실패와 POSTGRESQL 실패를 구분하며 원문 예외는 키/SQL 데이터 유출을 막기 위해 표시하지 않습니다.

쓰기 테스트 전 DB 소유자에게 정확한 호스트/DB명, sources, 입력 행 수, API 요청 상한을 제시하고 승인을 받습니다.
승인된 실행만 `APPLY=true`, `TARGET_CONFIRMATION=호스트/DB명`으로 시작하고 Jenkins의 승인 버튼을 사용합니다.
성공 후 기존 `api_collection_runs`의 실행 ID/건수와 대상 테이블을 비교합니다.
기존 수집기의 실패 트랜잭션은 이력 insert도 롤백할 수 있으므로 DB 이력 부재를 성공으로 해석하면 안 됩니다. 실패 증거는 Jenkins 빌드 결과에 남습니다.

## 자동 실행 전 남은 조건

수동 쓰기는 실행별 승인을 요구합니다. TimerTrigger로 실행되는 정기 작업은 별도 운영 정책을 검사합니다.
실제 적재 검증 및 반복 운영 승인 후 `operating-policy.example.json`을 참고해 정책 파일을 Jenkins Secret file ID `icn-collection-policy`에 등록합니다. 실제 파일은 Git에 올리지 않습니다.
target은 정확한 `DB_HOST/DB_NAME`, port/user도 접속 대상과 일치해야 합니다. jobs 키는 폴더 경로를 포함하는 Jenkins JOB_NAME입니다.
각 Job에 sources, max_requests, enabled=true, validated=true, approval_reference(반복 운영 승인 기록), quota_reference(확인된 계정 할당량 기록)를 지정합니다. METAR는 cadence_reference도 필수입니다.
정기 실행은 정책에 승인된 요청 상한을 사용하고 시험용 ROW_LIMIT 없이 전체 결과를 처리합니다. 정책이 없거나 불일치하면 API 호출 전에 실패합니다.
정책 등록만으로 cron이 켜지지는 않습니다. 승인된 Job에만 위 표의 Build periodically 설정을 저장하고 다음 실행의 TimerTrigger 원인, KST 시작 시각, RESULT와 RDS 기록을 확인합니다.
공공데이터 포털 계정별 할당량 및 페이지 수를 확인하여 혼잡도(하루 480회 Job 실행), 항공편(96회)의 총 요청량을 산정합니다.
METAR 제공 주기는 API 문서와 실제 응답 시각으로 확인합니다. 저장소 config의 interval_minutes는 공급자 보증값이 아닙니다.
이 조건을 충족하기 전에는 스케줄을 비활성 상태로 유지합니다.
