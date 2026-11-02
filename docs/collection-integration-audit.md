# 수집 자동화 통합 점검

기준 main: c502fea (PR #6 병합). 원본 작업 폴더는 feature/db-api-schema-update에서 보존하고, 별도 worktree의 feature/collection-automation에서 작업한다.

## PR 확인 결과

| PR | 상태 | 후속 작업 |
|---|---|---|
| #6 API 수집 | main 병합 완료 | 중복 병합하지 않음 |
| #1 Jenkins | Draft, 충돌 없음, 승인 리뷰 없음 | 검증 후 기존 PR 활용 |
| #2 백엔드 | Open, 충돌 없음, 승인 리뷰 없음 | 담당자 완료/승인 확인 전 병합 보류 |
| #3 DB 및 React | Open, 충돌 있음, 승인 리뷰 없음 | schema.sql 양쪽 변경 비교 및 검증 필요 |

## 실행기 확인

저장소 루트에서 `python -m collection.pipeline.jobs --sources SOURCE` 실행. 지원 소스: congestion_t1, congestion_t2, flights, passenger_forecast, takeoff_forecast, facilities, metar.

기본 실행도 실제 외부 API를 호출한다. --apply가 없으면 PostgreSQL에서 매핑 데이터를 읽어 검증하고, --apply가 있으면 소스별 트랜잭션으로 UPSERT한다. --limit은 DB 입력 행 제한이며 API 호출 수 제한이 아니다. --max-requests는 별도 요청 수 제한이다.

환경변수: PUBLIC_DATA_KEY, KMA_API_KEY, DATABASE_URL 또는 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_SSLMODE. DB 설정 누락 시 SQLite 기본값으로 내려가므로 운영 실행 전 PostgreSQL 설정을 명시적으로 검증해야 한다.

## 자동화에서 보완할 사항

- 기존 jobs.py 단계 이름을 활용해 API 수집/정규화/DB 검증/적재 실패를 구분한다.
- API 예외에는 요청 URL과 키가 포함될 수 있으므로 콘솔에 원본 traceback을 그대로 출력하지 않는다.
- api_collection_runs는 적재와 같은 트랜잭션에서 생성된다. 실패하면 이력도 rollback되므로 실패 기록은 Jenkins 실행 결과로 보완한다. DB 스키마는 변경하지 않는다.
- dry-run도 RDS 연결이 필요하다. 접근 가능 여부와 대상 DB 확인은 아직 미완료다.
- 3분·15분 수집은 실제 API 승인된 호출량 확인 전 비활성화한다. METAR의 설정상 30분은 제공자의 갱신 주기 검증 증거가 아니다.
- 실제 적재는 대상 DB와 소스·최대 행 수를 명시하여 사용자 승인 후 수행한다.

## 아직 완료되지 않은 항목

통합 충돌 해결, 실제 Jenkins 접속, RDS dry-run 및 승인된 적재, 스케줄 활성화 검증은 후속 작업이다. 이 문서는 구축 완료 보고서가 아니다.

## 2026-11-02 로컬 검증

- 여섯 수집 Pipeline, 실행 wrapper, Job 설정 README, 읽기 전용 verify.sql 작성.
- Python 3.12에서 wrapper 테스트 5개 통과. 라이브 API/RDS 실행 증거는 아님.
- 기존 collection/tests는 3개 통과, test_duplicate_is_not_saved_twice 실패. mock 수집이 ok=false를 반환하므로 담당자 테스트 fixture/설정 확인 필요. 테스트를 삭제하거나 성공으로 바꾸지 않음.
- localhost:8080/login 연결 실패. 실제 Jenkins Job 생성/실행은 확인되지 않음.
- 시설 수집기는 source_facility_key UNIQUE를 요구하지만 main bootstrap에는 해당 컬럼이 없고, DB PR의 bootstrap에도 해당 UNIQUE가 없음. RDS의 실제 인덱스를 verify.sql로 확인하기 전 시설 쓰기를 시작하면 안 됨. 스키마 자동 수정은 하지 않음.
- main의 takeoff issued_at NOT NULL과 DB PR의 NULL 허용/부분 UNIQUE 차이가 있음. 수집기의 NULL issued_at 경로와 함께 검증해야 함.
- 현재 쓰기는 실행별 승인 방식. 무인 운영 정책 및 전체 행 처리 설정이 아직 필요하며 cron은 비활성 상태.
