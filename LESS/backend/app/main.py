"""
LESS Backend — точка входа
Запуск: uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from typing import Optional

from app.config import settings
from app.services.camera_service import camera_service
from app.services.serial_service import serial_service
from app.services.db_service import db_service
from app.services.auth_service import auth_service
from app.services.ai_analyzer import ai_analyzer
from app.services.stream_service import stream_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LESS Backend starting...")
    logger.info(f"Listening on http://{settings.HOST}:{settings.PORT}")
    # Инициализация БД уже происходит в db_service
    yield
    logger.info("LESS Backend shutting down...")
    camera_service.stop()
    serial_service.disconnect()
    stream_service.stop_stream()


app = FastAPI(
    title="LESS — Local Entry Security System",
    description="Backend для многофакторной СКУД",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://localhost:5173",  # vite pure
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "LESS Backend",
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/api/status")
async def status():
    return {
        "backend": "ok",
        "camera": "running" if camera_service.is_running else "stopped",
        "serial": "connected" if serial_service.is_connected else "disconnected",
        "db": "ok",
        "ai": "ok",
        "clients_ws": len(stream_service.clients),
    }


@app.get("/api/logs")
async def get_logs(limit: int = Query(50, ge=1, le=500)):
    return db_service.get_recent_logs(limit=limit)


@app.get("/api/alerts")
async def get_alerts(limit: int = Query(20, ge=1, le=100)):
    return db_service.get_recent_alerts(limit=limit)


@app.post("/api/ai/analyze")
async def run_ai_analyze():
    alerts = ai_analyzer.run_periodic_check()
    return {"generated_alerts": alerts}


@app.post("/api/camera/start")
async def camera_start():
    ok = camera_service.start()
    return {"success": ok}


@app.post("/api/camera/stop")
async def camera_stop():
    camera_service.stop()
    stream_service.stop_stream()
    return {"success": True}


@app.get("/api/serial/ports")
async def list_serial_ports():
    return {"ports": serial_service.list_ports()}


@app.post("/api/serial/connect")
async def serial_connect(port: Optional[str] = None):
    ok = serial_service.connect(port=port)
    return {"success": ok, "port": port or settings.SERIAL_PORT}


@app.post("/api/users")
async def create_user(nfc_uid: str, name: str = "", pin: str = None):
    from app.services.crypto_service import crypto_service
    pin_hash = crypto_service.hash_secret(pin) if pin else None
    user_id = db_service.add_user(nfc_uid=nfc_uid, name=name, pin_hash=pin_hash)
    return {"id": user_id, "nfc_uid": nfc_uid}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await stream_service.connect(websocket)
    try:
        # При подключении можно сразу начать стрим, если камера готова
        while True:
            # Клиент может присылать команды
            data = await websocket.receive_text()
            if data == "start_stream":
                if not stream_service.is_streaming:
                    # Запускаем в фоне
                    import asyncio
                    asyncio.create_task(stream_service.start_camera_stream())
            elif data == "stop_stream":
                stream_service.stop_stream()
            else:
                await websocket.send_json({"type": "echo", "payload": {"message": data}})
    except WebSocketDisconnect:
        stream_service.disconnect(websocket)
