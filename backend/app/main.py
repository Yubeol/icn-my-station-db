from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import ws, ws_yolo
from app.core.config import settings
from app.core.db import close_pool
from app.core.errors import FlightNotFoundError
from app.core.log_filter import install_token_mask
from app.routers import alerts, congestion, dashboard, facilities, flights, stats, weather
from app.services import yolo_results
from app.services.alert_worker import start_alert_worker

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    yolo_results.install()  # 워커 result 처리(30초 집계·제스처 이벤트)를 허브에 연결한다
    install_token_mask()  # 접속 로그의 token= 값을 가린다
    worker = start_alert_worker()  # db 모드에서만 알림 감지를 돌린다
    yield
    if worker is not None:
        worker.cancel()
    close_pool()  # db 모드에서 열린 연결 풀을 정리한다. mock 모드면 아무 일도 하지 않는다.


app = FastAPI(title="ICN My Station API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(FlightNotFoundError)
def flight_not_found_handler(_: Request, exc: FlightNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


for module in (dashboard, flights, congestion, stats, alerts, weather, facilities):
    app.include_router(module.router, prefix=API_PREFIX)
app.include_router(ws.router)
app.include_router(ws_yolo.router)