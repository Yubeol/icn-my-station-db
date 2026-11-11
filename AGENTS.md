# ICN My Station — 팀 공통 규칙

인천공항 맞춤형 실시간 정보 대시보드. 4인 팀 프로젝트이며, 사용하는 AI 도구와 상관없이 이 문서의 규칙을 따른다.

## 폴더와 담당
- frontend/   : 대시보드 화면 (곽규민). 단, 최종 발표 화면과 YOLO 화면(CCTV 뷰어·박스 오버레이·긴급 모달·구역 인원 표시)은 류민규가 수정한다
- backend/    : FastAPI REST API, 실시간 푸시 (류민규)
- database/   : ERD, SQL 스키마, 마이그레이션 (박수암)
- collection/ : 공공 API 수집·전처리 (박수암)
- docs/       : 팀 공통 문서. api-contract.md가 프론트-백엔드 계약의 기준
- mobile/android-camera/ : 안드로이드 카메라 송출 앱 (박수암)
- workers/yolo/ : Windows YOLO 워커 — 추론·ByteTrack·인원 계산·제스처 판정 (박수암)
- tools/yolo/ : 대체 카메라 송출 스크립트, 테스트용 가짜 카메라·워커 (류민규)
- YOLO 데이터셋·라벨링·학습·모델 평가 (곽규민, 폴더 없음: 학습은 Colab에서 하고 데이터·가중치는 커밋하지 않는다)

자기 담당 폴더 밖의 파일은 수정하지 않는다. 필요하면 담당자에게 요청한다.

## API 계약
- 프론트와 백엔드 사이의 모든 응답 형식은 docs/api-contract.md를 따른다.
- 필드명은 백엔드가 정하고, 프론트는 docs/openapi.json으로 타입을 생성해 사용한다.
- 필드는 추가만 한다. 이름 변경·삭제·타입 변경은 팀에 먼저 공유한 뒤 진행한다.
- JSON 필드명은 camelCase.
- 시간은 ISO 8601, 한국 시간(+09:00). 예: 2026-11-05T14:30:00+09:00
- 상태값은 코드(예: BOARDING, HIGH)로 주고, 한글 문구와 색은 프론트가 정한다.
- 모든 REST 경로는 /api/v1 아래에 둔다.
- YOLO DEMO 계약은 docs/yolo-demo-contract.md. 필드명은 백엔드가 정하고 추가만 한다는 규칙을 똑같이 적용한다.

## 데이터 저장 기준
- 외부 공공 API는 collection/ 파이프라인만 호출한다. 백엔드와 프론트는 외부 API를 직접 호출하지 않는다.
- 시간은 KST로 저장한다 (원본이 UTC면 변환).
- 단위: 풍속 m/s, 기압 hPa, 기온 °C, 시정 km.
- 출국장은 terminal(T1/T2) + hall_id로 구분한다. T1은 1~6, T2는 1~2이며 범위를 코드에 고정하지 않는다.
- 데이터 출처는 source 컬럼에 api / yolo / demo로 구분한다. demo 데이터는 실제 데이터와 섞지 않는다.
- YOLO DEMO 결과(인원·제스처 이벤트)는 smart_alerts가 아니라 demo_yolo_counts, demo_yolo_events에 저장한다.
- 항공편 구분 키는 편명이 아니라 운항 API의 편명 UNIQ 코드를 쓴다. 편수 집계는 코드쉐어를 제외하고 마스터 편만 센다.
- 운항 상태 매핑(원본 상태 → 표준 코드)과 지연 기준(15분)은 백엔드가 관리한다.

## 비밀정보
- API 키, DB 비밀번호, 토큰은 절대 커밋하지 않는다. .env 파일에 두고 코드에서는 환경변수로 읽는다.
- .gitignore가 *password*, *secret*, *api_key* 같은 이름을 무시하므로 코드 파일 이름에 이 단어를 쓰지 않는다.

## 작업 방식
- main에서 feature/<내용> 브랜치를 만들어 작업하고 Pull Request로 합친다.
- 커밋 전 git status와 git diff로 의도한 파일만 들어갔는지 확인한다.

## YOLO DEMO 범위
- 1차(11/12 시연): person, head, help_gesture. knife·gun·fire·smoke는 이후 확장.
