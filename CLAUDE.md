@AGENTS.md

# Claude 작업 지침 (류민규, 백엔드 담당)

- 나는 백엔드 담당이다. 기본 작업 범위는 backend/와 docs/api-contract.md, docs/db-write-contract.md, docs/openapi.json이다.
- frontend/, database/, collection/은 읽기만 한다. 수정이 필요해 보이면 수정하지 말고 무엇이 필요한지 알려준다.
- docs/api-contract.md, docs/db-write-contract.md의 기존 내용을 바꾸거나 지워야 하면 바로 수정하지 말고 먼저 이유와 영향을 설명한다. 둘 다 팀과 합의한 계약이다.
- 개발 환경은 Windows + PyCharm + uv, Python 3.12.
- 답변과 커밋 메시지는 한국어로 쓴다.
- 작업이 끝나면 바뀐 파일과 확인 방법을 짧게 정리한다.
- 현재 브랜치에서만 작업한다. 브랜치를 새로 만들거나 바꿔야 하면 먼저 묻는다.
- push는 내가 요청할 때만 한다.

## DB 사용 규칙
- 공유 RDS에 마스터 계정으로 접속하므로 DB가 쓰기를 막아주지 않는다. 그러므로 아래 규칙을 반드시 지킨다.
- 백엔드가 쓰는 테이블은 smart_alerts 하나뿐이다. 다른 테이블에는 INSERT, UPDATE, DELETE, TRUNCATE, DROP, ALTER, CREATE를 실행하지 않는다.
- smart_alerts 쓰기는 docs/db-write-contract.md의 형식을 따르고, INSERT ... ON CONFLICT (dedupe_key, source) DO NOTHING만 사용한다. UPDATE, DELETE는 하지 않는다.
- smart_alerts 쓰기는 백엔드 코드 안에서만 하고, 확인용으로 직접 쓰기 쿼리를 실행하지 않는다.
- DB 확인은 SELECT만 사용하고, 큰 테이블은 LIMIT을 붙인다.
- 테스트는 실제 DB가 아니라 mock 데이터나 로컬 테스트 DB로 한다. 공유 DB에 테스트 데이터를 넣지 않는다.
- .env 값(특히 비밀번호)은 출력하거나 커밋하거나 다른 파일에 복사하지 않는다.