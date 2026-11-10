"""
LESS Backend — точка входа
Запуск: uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from typing import Optional
from pydantic import BaseModel, Field

from app.config import settings
from app.services.camera_service import camera_service
from app.services.serial_service import serial_service
from app.services.db_service import db_service
from app.services.auth_service import auth_service
from app.services.ai_analyzer import ai_analyzer
from app.services.stream_service import stream_service
from app.services.access_policy import (
    access_policy,
    AccessContext,
    Direction,
    AccessDecision,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("LESS Backend starting...")
    logger.info(f"Listening on http://{settings.HOST}:{settings.PORT}")
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
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"service": "LESS Backend", "version": "0.1.0", "status": "running"}


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
    return {"generated_alerts": ai_analyzer.run_periodic_check()}


@app.post("/api/camera/start")
async def camera_start():
    return {"success": camera_service.start()}


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


class UserCreateRequest(BaseModel):
    nfc_uid: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=200)
    position: str = Field(default="", max_length=200)
    pin: Optional[str] = Field(default=None, max_length=64)
    is_active: bool = True
    photo_data_url: Optional[str] = None


class UserUpdateRequest(BaseModel):
    nfc_uid: Optional[str] = Field(default=None, min_length=1, max_length=128)
    name: Optional[str] = Field(default=None, max_length=200)
    position: Optional[str] = Field(default=None, max_length=200)
    pin: Optional[str] = Field(default=None, max_length=64)
    is_active: Optional[bool] = None
    photo_data_url: Optional[str] = None


class FaceEnrollRequest(BaseModel):
    front_landmarks: list[list[float]]
    profile_landmarks: list[list[float]]
    front_photo: str
    profile_photo: str


@app.get("/api/users")
async def list_users(include_inactive: bool = Query(True)):
    return {"users": db_service.list_users(include_inactive=include_inactive)}


@app.post("/api/users")
async def create_user(body: UserCreateRequest):
    from app.services.crypto_service import crypto_service
    pin_hash = crypto_service.hash_secret(body.pin) if body.pin else None
    try:
        user_id = db_service.add_user(
            nfc_uid=body.nfc_uid.strip(), name=body.name.strip(),
            position=body.position.strip(), pin_hash=pin_hash,
            is_active=body.is_active, photo_data_url=body.photo_data_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail="UID уже используется или запись не может быть создана.") from exc
    return db_service.get_user(user_id, include_logs=False)


@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    user = db_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    return user


@app.patch("/api/users/{user_id}")
async def update_user(user_id: int, body: UserUpdateRequest):
    from app.services.crypto_service import crypto_service
    changes = body.model_dump(exclude_unset=True)
    if "pin" in changes:
        pin = changes.pop("pin")
        if pin:
            changes["pin_hash"] = crypto_service.hash_secret(pin)
    try:
        updated = db_service.update_user(user_id, changes)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="UID уже используется или изменение не удалось.") from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    return db_service.get_user(user_id)


@app.delete("/api/users/{user_id}")
async def remove_user(user_id: int, hard: bool = Query(False)):
    if not db_service.delete_user(user_id, hard=hard):
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    return {"success": True, "deleted": hard, "is_active": False if not hard else None}


@app.post("/api/users/{user_id}/face-enroll")
async def enroll_face(user_id: int, body: FaceEnrollRequest):
    user = db_service.get_user(user_id, include_logs=False)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    if len(body.front_landmarks) < 300 or len(body.profile_landmarks) < 300:
        raise HTTPException(status_code=422, detail="Недостаточно контрольных точек лица.")
    if len(body.front_photo) > 8_000_000 or len(body.profile_photo) > 8_000_000:
        raise HTTPException(status_code=413, detail="Изображение превышает допустимый размер.")
    candidates = db_service.find_similar_faces(user_id=user_id, landmarks=body.front_landmarks, limit=5)
    db_service.save_face_profile(
        user_id=user_id, front_landmarks=body.front_landmarks,
        profile_landmarks=body.profile_landmarks, front_photo=body.front_photo,
    )
    return {
        "success": True,
        "message": "Биометрический профиль сохранён.",
        "duplicate_candidates": candidates,
        "note": "Сходство рассчитывается по геометрии контрольных точек и требует проверки оператором.",
    }


class AccessCheckRequest(BaseModel):
    nfc_uid: Optional[str] = None
    user_id: Optional[int] = None
    door_id: str = "main"
    direction: str = "in"
    guest_code: Optional[str] = None
    factor: str = "nfc"


class GuestCodeCreate(BaseModel):
    label: str = "Гость"
    valid_hours: float = Field(default=2.0, ge=0.1, le=72)
    max_uses: int = Field(default=1, ge=1, le=100)
    door_ids: Optional[list] = None


@app.post("/api/access/check")
async def access_check(body: AccessCheckRequest):
    direction = Direction.IN if body.direction.lower() != "out" else Direction.OUT
    resolved_user = db_service.get_user_by_nfc(body.nfc_uid) if body.nfc_uid else None
    resolved_user_id = body.user_id or (resolved_user["id"] if resolved_user else None)
    ctx = AccessContext(
        nfc_uid=body.nfc_uid,
        user_id=resolved_user_id,
        door_id=body.door_id,
        direction=direction,
        guest_code=body.guest_code,
        factor=body.factor,
    )
    result = access_policy.evaluate(ctx)
    event = "granted" if result.decision == AccessDecision.ALLOW else "denied"
    db_service.log_access(
        nfc_uid=body.nfc_uid or body.guest_code or "",
        event_type=event,
        factor_used=body.factor,
        reason=f"{result.code}: {result.reason}",
        user_id=resolved_user_id,
        direction=body.direction,
        door_id=body.door_id,
    )
    return {
        "decision": result.decision.value,
        "reason": result.reason,
        "code": result.code,
        "details": result.details,
    }


@app.get("/api/access/doors")
async def list_doors():
    doors = []
    for d in access_policy.doors.values():
        doors.append({
            "door_id": d.door_id,
            "name": d.name,
            "anti_passback": d.anti_passback,
            "dual_control": d.dual_control,
            "schedule": [
                {
                    "start": w.start.isoformat(timespec="minutes"),
                    "end": w.end.isoformat(timespec="minutes"),
                    "weekdays": list(w.weekdays),
                }
                for w in d.schedule
            ],
        })
    return {"doors": doors}


@app.post("/api/access/guest-codes")
async def create_guest_code(body: GuestCodeCreate):
    return access_policy.create_guest_code(
        label=body.label,
        valid_hours=body.valid_hours,
        max_uses=body.max_uses,
        door_ids=body.door_ids,
    )


@app.get("/api/access/guest-codes")
async def list_guest_codes():
    return {"codes": access_policy.list_guest_codes()}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await stream_service.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "start_stream":
                if not stream_service.is_streaming:
                    import asyncio
                    asyncio.create_task(stream_service.start_camera_stream())
            elif data == "stop_stream":
                stream_service.stop_stream()
            else:
                await websocket.send_json({"type": "echo", "payload": {"message": data}})
    except WebSocketDisconnect:
        stream_service.disconnect(websocket)
