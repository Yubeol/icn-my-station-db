# ICN My Station | 프론트엔드 협업 가이드

인천공항 운항 정보 대시보드의 **프론트엔드(React + Vite + TypeScript)** 작업 안내입니다. 이 폴더는 기존 `icn-my-station-db` 저장소의 ``이며 별도 프로젝트가 아닙니다.

> **현재 단계:** 대시보드 화면 배치 및 상세 페이지 담당 영역만 준비된 상태입니다. 빈 박스는 개발 예정 영역이며, 실제 통계·지도·날씨·알림 데이터나 API 연결이 구현되었다는 뜻이 아닙니다.

## 1. 프로젝트 폴더

```text
icn-my-station-db/
├── backend/                     # FastAPI 서버
├── collection/                  # 데이터 수집
├── database/                    # DB 관련 코드
├── docs/
│   ├── api-contract.md          # 프론트·백엔드 API 계약
│   └── openapi.json
└── frontend/
    ├── README.md                # 이 문서
    ├── public/
    └── src/
        ├── api/
        │   ├── client.ts        # 기존 API 요청 함수: 무단 변경 금지
        │   └── types.ts         # 기존 API 응답 타입: 계약 후 변경
        ├── components/
        │   ├── dashboard/
        │   │   └── MainDashboard.tsx  # 메인 영역 조립
        │   └── layout/               # 헤더 및 공통 박스
        ├── pages/                    # 담당자별 상세 페이지
        ├── App.tsx                   # 상단 메뉴·화면 전환
        ├── App.css                   # 공통 레이아웃
        ├── index.css                 # 기존 전역 스타일
        └── main.tsx                  # 앱 진입점
```

## 2. 실행 방법

프로젝트 루트에서:

```bash
cd frontend
npm install
npm run dev
```

기본 개발 서버 주소는 `http://localhost:5173`입니다. 프론트 화면의 빈 박스 확인에는 백엔드 실행이 필요하지 않습니다. 실제 API 연동 기능 테스트는 백엔드 실행과 환경 변수 설정이 따로 필요합니다. 환경 변수 이름과 값은 저장소의 기존 설정을 확인하세요.

## 3. 담당 영역 및 파일 소유 규칙

| 개발 영역 | 주 담당 파일 | 구현 범위 |
|---|---|---|
| 공통 UI / 통합 | `src/App.tsx`, `src/App.css`, `src/components/layout/` | 메뉴, 공통 스타일, 화면 크기별 배치, 페이지 연결 |
| 메인 대시보드 | `src/components/dashboard/MainDashboard.tsx` | 메인 요약 영역 조립, T1/T2 선택 처리 |
| 운행현황 | `src/pages/FlightsPage.tsx` | 항공편 현황 상세 화면 |
| 운항통계 | `src/pages/StatisticsPage.tsx` | 운항 통계 상세 화면 |
| 날씨·운항 확률 | `src/pages/WeatherPage.tsx` | 날씨 및 운항 여건 상세 화면 |
| 출국장 혼잡도 | `src/pages/CongestionPage.tsx` | 혼잡도 상세 화면 |
| 편의시설 | `src/pages/FacilitiesPage.tsx` | 편의시설 상세 화면 |
| 스마트 알림 | `src/pages/AlertsPage.tsx` | 스마트 알림 상세 화면 |
| API / 백엔드 연동 | 기존 `src/api/client.ts`, `src/api/types.ts` 및 `../docs/api-contract.md` | API 응답 계약 확인 후 연결 |

**담당자 이름과 세부 분담은 팀에서 정한 뒤 표에 추가하세요.** 페이지 담당자는 우선 본인의 `pages/` 파일과 해당 페이지 전용 컴포넌트·스타일만 수정합니다. `App.tsx`, `App.css`, `components/layout/`, `api/`는 담당자와 사전 조율 후 수정합니다.

### 메인 화면에 요약 기능 붙이기

각 상세 페이지 담당자는 자신의 화면만 구현하고 끝내지 말고, 메인에 표시할 **요약 컴포넌트**도 별도 파일로 작성해 통합 담당자에게 전달합니다. 예시:

```text
src/components/summary/
├── FlightsSummary.tsx
├── StatisticsSummary.tsx
├── WeatherSummary.tsx
├── CongestionSummary.tsx
├── FacilitiesSummary.tsx
└── AlertsSummary.tsx
```

위 파일은 **작업 시 사용할 권장 파일명**으로, 현재 존재하는 파일이 아닙니다. `MainDashboard.tsx`의 빈 박스는 통합 담당자가 요약 컴포넌트로 교체합니다. 같은 파일을 여러 명이 동시에 수정하지 않도록 합니다.

### 페이지와 메인의 책임 구분

- **메인:** 운행현황, 운항통계, 출국장 혼잡도, 날씨·운항 확률, 스마트 알림 3건, 가장 여유로운 편의시설 3곳의 요약 영역
- **상세 페이지:** 각 기능별 필터, 시각화, 추가 정보, 상세 조회 등
- **공통:** 메뉴, 레이아웃, 화면 이동, 터미널 선택 정보의 전달 방식

현재는 각 영역의 제목만 표시하며 가짜 데이터나 그래프 형태를 강제로 만들지 않습니다.

## 4. Git 브랜치와 Pull Request(PR) 규칙

> 아래 `develop`은 **예시 대상 브랜치**입니다. 실제 저장소의 기본 브랜치가 `main`이거나 별도 통합 브랜치라면 팀에서 정한 이름으로 바꾸세요.

1. `main`/`develop`에 직접 푸시하지 않고, 기능별 브랜치에서 작업합니다.
2. 브랜치 이름은 `feature/기능명` 형태를 권장합니다. 예: `feature/flights-page`, `feature/congestion-page`, `feature/weather-page`.
3. 작업 전 `git status`로 변경 파일을 확인합니다. 이미 수정 중인 파일이 있다면 함부로 브랜치를 바꾸거나 덮어쓰지 않습니다.
4. 자신의 코드만 커밋하고 원격 브랜치로 푸시한 뒤 PR을 생성합니다.
5. PR에는 **작업 내용 / 수정 파일 / 테스트 결과 / 남은 작업**을 적습니다.
6. 최소 한 명이 검토한 후 팀의 통합 브랜치로 병합합니다. API 계약이나 공통 파일 변경은 관련 담당자 검토가 필요합니다.

### 신규 작업 브랜치에서 작업하는 예시

```bash
# 저장소 최상위 폴더에서 실행
git status
git fetch origin
# 팀이 정한 통합 브랜치가 develop이라고 가정
git switch develop
git pull --ff-only origin develop
git switch -c feature/flights-page

# 파일 수정 후
git status
git add frontend/src/pages/FlightsPage.tsx
git commit -m "feat(frontend): 운행현황 상세 화면 구현"
git push -u origin feature/flights-page
```

`git switch develop`은 미커밋 변경이 있으면 충돌하거나 실행되지 않을 수 있으므로 기존 작업을 먼저 정리해야 합니다. **이미 존재하는 팀원 브랜치를 강제로 재생성하지 마세요.**

### 현재 `feature/frontend-dashboard` 브랜치에 공통 화면 올리기

이미 해당 브랜치에서 작업 중이라면 **브랜치를 새로 만들 필요가 없습니다.** 프로젝트 루트에서:

```bash
git branch --show-current
git status
# 현재 변경 파일을 확인하고 프론트 화면 + 문서만 선택해서 추가
git add frontend/src/App.tsx frontend/src/App.css frontend/src/components frontend/src/pages frontend/Frontend-README.md
git diff --cached --stat
git commit -m "feat(frontend): 대시보드 레이아웃 및 페이지 구조 추가"
git push -u origin feature/frontend-dashboard
```

`git diff --cached`로 실제 반영될 내용을 확인한 뒤 커밋하세요. 기존 브랜치에 다른 사람 커밋이 올라왔다면 충돌 해결을 팀원과 조율합니다. `--force` 푸시는 사용하지 않습니다.

## 5. 코드 및 API 협업 규칙

- **API 계약 우선:** 요청 주소·응답 필드·자료형은 `../docs/api-contract.md`와 `../docs/openapi.json`을 확인합니다. 변경이 필요하면 백엔드와 프론트 담당자가 먼저 협의합니다.
- **공통 API 모듈 유지:** 각 페이지에서 주소나 응답 구조를 제각각 하드코딩하지 말고 `src/api/client.ts`, `src/api/types.ts`를 재사용합니다.
- **메인 / 상세 데이터 구분:** 같은 API 데이터를 쓸 수 있어도 표시 방식은 각 컴포넌트가 책임집니다. 터미널(T1/T2), 조회 시각, 로딩·오류·데이터 없음 상태는 함께 정의합니다.
- **CSS 충돌 방지:** 페이지 CSS는 해당 페이지 고유 접두사를 사용합니다. 공통 선택자(`button`, `section`, `#root` 등)는 통합 담당자와 협의합니다.
- **외부 패키지 추가:** 팀 공유 후 `package.json`과 잠금 파일을 함께 커밋합니다.
- **작업 확인:** PR 전에 `npm run build`를 실행하고, 존재하는 경우 `npm run lint`도 실행합니다. 실패 시 원인을 PR에 기록합니다.
- **보안:** `.env`, `.env.local`, API 키, 비밀번호, DB 접속정보, `../.venv`, `node_modules/`, 빌드 산출물은 올리지 않습니다. `../.gitignore` 설정을 확인하세요.

## 6. PR 작성 양식

```markdown
## 작업 내용
- 

## 수정 파일
- 

## 테스트
- [ ] npm run build
- [ ] npm run lint (설정되어 있는 경우)
- [ ] 브라우저에서 담당 페이지 확인

## API 계약 관련 변경
- 없음 / 있음 (변경 내용 기재)

## 남은 작업 및 공유 사항
- 
```

## 7. 병합 전 점검

- [ ] 담당 파일 외 공통 파일을 임의 수정하지 않았는가?
- [ ] 메뉴 전환과 T1/T2 선택이 기존 화면에서 동작하는가?
- [ ] 기존 `api/client.ts`, `src/api/types.ts`, 백엔드 및 DB를 불필요하게 변경하지 않았는가?
- [ ] 화면 폭에 따른 레이아웃이 깨지지 않는가?
- [ ] 테스트 결과와 미완성 기능을 PR에 명확히 기재했는가?
- [ ] 비밀정보와 개발환경 파일이 커밋에 포함되지 않았는가?

---

**참고:** 이 레이아웃은 현재 API 데이터가 없는 껍데기입니다. 담당자별 상세 구현 및 API 연결은 이후 PR에서 진행합니다.

## API 연동 패치 (2026-11-03)

### 파일 구성 및 변경 범위

- `src/api/client.ts`: 모든 REST 엔드포인트의 호출 함수 및 WebSocket URL 유틸리티. 기존 `getDashboardSummary(signal)` 호출 방식은 유지합니다.
- `src/api/types.ts`: 사용자가 제공한 `openapi-typescript` 자동 생성 타입 원본입니다. **직접 수정하지 말 것.**
- `src/hooks/useApiResource.ts`: 요청 시작/성공/실패와 페이지 이동 시 취소를 담당합니다.
- `src/components/layout/ApiStatus.tsx`: 화면에 최소한의 연결 상태만 표시합니다.
- `src/components/dashboard/MainDashboard.tsx`: `/api/v1/dashboard/summary` 1회 요청. 실제 데이터 렌더링은 하지 않음.
- `src/pages/*Page.tsx`: 각 상세 화면이 독립 API를 호출하지만 데이터 표시 UI는 미구현입니다.
- `src/App.css`: API 연결 상태 표시용 CSS만 추가했습니다.

### 주요 함수

```ts
import {
  getDashboardSummary, getFlights, getFlight, getCongestion,
  getFlightStats, getAlerts, getWeather, getFacilities
} from './api/client'

// getDashboardSummary(signal?, flightNo?)
// getFlights(type, signal?, flightNo?)
// getFlight(flightNo, signal?)
// getCongestion(terminal, signal?)
// getFlightStats(direction, signal?)
// getAlerts(signal?, flightNo?)
// getWeather(signal?)
// getFacilities(signal?)
```

메인 요약에는 `flights`, `stats`, `congestion`, `weather`, `alerts`, `facilities`가 포함됩니다. 데이터는 각 팀원 담당 컴포넌트에서 `api.data`로 접근할 수 있습니다. 화면의 빈 박스는 그대로 유지되며 API 응답 수신 시에도 숫자나 그래프는 자동 표시되지 않습니다.

### 서버 연결

모든 요청은 기본적으로 `/api/v1/...` 상대 경로를 호출합니다. **기존 Vite 프록시 설정을 확인하세요.** 이미 `/api`를 `http://127.0.0.1:8000`으로 전달하고 있다면 수정할 필요 없습니다. 설정이 없다면 기존 `vite.config.ts`의 `defineConfig`에 다음 `server` 항목을 병합해야 합니다. 이 패치에서 기존 설정 파일은 덮어쓰지 않습니다.

```ts
server: {
  proxy: {
    '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
  },
},
```

프록시 대신 프론트 환경 변수 `VITE_API_BASE_URL=http://127.0.0.1:8000` 지정도 가능합니다. 다른 기기에서 접속할 때 `127.0.0.1`은 해당 기기 자신이므로 주의하세요. `.env` 실값은 Git에 올리지 마세요.

### 검증 절차

1. FastAPI를 실행하고 `http://127.0.0.1:8000/docs`에서 API가 등록됐는지 확인합니다.
2. `http://127.0.0.1:8000/api/v1/dashboard/summary` 응답을 먼저 확인합니다.
3. `cd frontend` → `npm install` → `npm run dev`.
4. 메인에서 `API 응답 수신` 표시를 확인하고, 각 메뉴를 클릭하여 API 연결 상태를 확인합니다.
5. 브라우저 개발자 도구 Network에서 `/api/v1/*` 요청이 200을 반환하는지 확인합니다. 404는 경로 확인, 422는 필수 매개변수 확인, 500은 백엔드 로그 확인, CORS/프록시는 Vite 설정 확인이 필요합니다.
6. `npm run build`로 TypeScript 및 프론트 빌드를 확인한 후 Git에 커밋합니다.

**주의:** 이 패치는 소스 파일과 계약을 바탕으로 API 호출 구조를 연결한 것으로, 실행 중인 백엔드 서버에 실제 요청하여 200 응답을 확인한 결과는 아닙니다. `npm run build` 검사 역시 개발자 환경에서 수행해야 합니다.

### 협업 및 계약상 남은 과제

- 시설 조회에는 시설별 혼잡도나 방문객 수가 없습니다. **'가장 여유로운 편의시설 3곳' 순위 계산은 현재 계약만으로 불가능**합니다. 백엔드에서 새로운 응답 필드/추천 API를 정의한 뒤 구현하세요. 임의로 3곳을 선정하면 안 됩니다.
- 날씨 `operationScore.score`는 실제 운항 확률이 아닌 *기상 운항 여건 점수*입니다. '운항 확률'을 사실로 표시하면 안 됩니다.
- WebSocket 메시지 형식과 `/ws/live` 주소는 계약에 있으나, 이 패치는 **WebSocket 자동 구독을 구현하지 않았습니다.** 실시간 구독은 별도 통합 작업으로 진행합니다.
- 혼잡도 지도 좌표/이미지는 API 계약에 없어서 빈 지도 영역을 유지합니다.
- 상세 페이지 담당자는 자기 `*Page.tsx`에서 UI를 개발하고, 메인 통합 담당자와 공통 `App.tsx`/`App.css` 수정 사항을 사전 협의하세요.
- 자동 생성 `src/api/types.ts`를 수동 수정하지 말고, 백엔드 계약이 바뀌면 OpenAPI에서 재생성하세요.
- `frontend-backup`, `.venv`, `node_modules`, `.env` 등이 커밋되지 않도록 루트 `../.gitignore`와 `git status`를 확인합니다.
