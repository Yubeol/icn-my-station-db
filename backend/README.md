# 백엔드

인천공항 대시보드의 서버 API와 업무 로직을 개발하는 폴더입니다.

접속 비밀번호와 API 키는 소스 코드에 넣지 않고 로컬 환경변수로 관리합니다.

## Docker 실행

backend 폴더에서 이미지를 만들고, 환경변수는 실행할 때 넘깁니다. 이미지에 .env를 넣지 않습니다.

```bash
docker build -t icn-backend .
docker run --rm -p 8000:8000 --env-file .env icn-backend
```

배포 주소가 정해지면 `CORS_ORIGINS`에 JSON 배열로 프론트 주소를 넣습니다.
`ALERT_WRITE_ENABLED=true`는 서버 한 곳에서만 켜고, 워커는 1개로 실행합니다.
