"""
LESS Backend — точка входа
Запуск: uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from typing import Optional, Any
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.services.camera_service import camera_service
from app.services.serial_service import serial_service
from app.services.db_service import db_service
from app.services.auth_service import auth_service
from app.services.ai_analyzer import ai_analyzer
from app.services.stream_service import stream_service
from app.services.face_recognition_service import face_recognition_service
from app.services.liveness_service import liveness_service
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
    logger.info(
        f"Face models: {'ready' if face_recognition_service.ready else 'MISSING — run scripts/download_face_models.py'}"
    )
    logger.info(
        f"Liveness model: {'ready' if liveness_service.ready else 'MISSING — run scripts/download_models.py'}"
    )
    yield
    logger.info("LESS Backend shutting down...")
    camera_service.stop()
    serial_service.disconnect()
    stream_service.stop_stream()


app = FastAPI(
    title="LESS — Local Entry Security System",
    description="Backend для многофакторной СКУД",
    version="0.2.0",
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
    return {"service": "LESS Backend", "version": "0.2.0", "status": "running"}


@app.get("/api/status")
async def status():
    return {
        "backend": "ok",
        "camera": "running" if camera_service.is_running else "stopped",
        "serial": "connected" if serial_service.is_connected else "disconnected",
        "db": "ok",
        "ai": "ok",
        "face_models": face_recognition_service.ready,
        "liveness_model": liveness_service.ready,
        "clients_ws": len(stream_service.clients),
        "last_faces": len(stream_service.last_faces),
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
    stream_service.request_start()
    return {"success": True}


@app.post("/api/camera/stop")
async def camera_stop():
    stream_service.stop_stream()
    return {"success": True}


@app.get("/api/serial/ports")
async def list_serial_ports():
    return {"ports": serial_service.list_ports()}


@app.post("/api/serial/connect")
async def serial_connect(port: Optional[str] = None):
    ok = serial_service.connect(port=port)
    return {"success": ok, "port": port or settings.SERIAL_PORT}


# ── Users (minimal, compatible with frontend api.ts) ─────────────────────────

class UserCreateBody(BaseModel):
    nfc_uid: str = Field(min_length=1, max_length=128)
    name: str = ""
    position: str = ""
    pin: Optional[str] = None
    is_active: bool = True


class UserUpdateBody(BaseModel):
    nfc_uid: Optional[str] = None
    name: Optional[str] = None
    position: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None


@app.get("/api/users")
async def list_users(include_inactive: bool = Query(True)):
    users = db_service.list_users(include_inactive=include_inactive) if hasattr(db_service, "list_users") else []
    return {"users": users}


@app.post("/api/users")
async def create_user(body: UserCreateBody):
    from app.services.crypto_service import crypto_service
    pin_hash = crypto_service.hash_secret(body.pin) if body.pin else None
    kwargs = {"nfc_uid": body.nfc_uid, "name": body.name, "pin_hash": pin_hash}
    if hasattr(db_service, "add_user"):
        try:
            user_id = db_service.add_user(**kwargs, position=body.position)
        except TypeError:
            user_id = db_service.add_user(**kwargs)
    else:
        raise HTTPException(500, "db_service.add_user missing")
    return {"id": user_id, "nfc_uid": body.nfc_uid, "name": body.name}


@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    if hasattr(db_service, "get_user"):
        user = db_service.get_user(user_id)
        if not user:
            raise HTTPException(404, "User not found")
        return user
    raise HTTPException(501, "Not implemented")


@app.patch("/api/users/{user_id}")
async def update_user(user_id: int, body: UserUpdateBody):
    if hasattr(db_service, "update_user"):
        data = body.model_dump(exclude_none=True)
        if "pin" in data:
            from app.services.crypto_service import crypto_service
            data["pin_hash"] = crypto_service.hash_secret(data.pop("pin"))
        ok = db_service.update_user(user_id, **data)
        if not ok:
            raise HTTPException(404, "User not found")
        return db_service.get_user(user_id) if hasattr(db_service, "get_user") else {"id": user_id}
    raise HTTPException(501, "Not implemented")


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, hard: bool = Query(False)):
    if hasattr(db_service, "delete_user"):
        db_service.delete_user(user_id, hard=hard)
        return {"success": True}
    raise HTTPException(501, "Not implemented")


# ── Face / biometrics ────────────────────────────────────────────────────────

class FaceDetectRequest(BaseModel):
    image: str = Field(min_length=32, max_length=7_000_000)


class FaceEnrollRequest(BaseModel):
    image: Optional[str] = Field(default=None, max_length=7_000_000)
    liveness_proof: Optional[str] = None


class LivenessChallengeRequest(BaseModel):
    user_id: int = Field(gt=0)


class LivenessActionEvidence(BaseModel):
    action: str = Field(pattern="^(blink|turn_head|open_mouth|smile)$")
    frames: list[str] = Field(min_length=8, max_length=36)

    @field_validator("frames")
    @classmethod
    def validate_frame_sizes(cls, frames: list[str]) -> list[str]:
        if any(not isinstance(f, str) or len(f) > 2_100_000 for f in frames):
            raise ValueError("Кадр превышает допустимый размер")
        return frames


class LivenessVerifyRequest(BaseModel):
    user_id: int = Field(gt=0)
    challenge_id: str = Field(min_length=20, max_length=128)
    evidence: list[LivenessActionEvidence] = Field(min_length=4, max_length=4)


@app.post("/api/face/detect")
async def face_detect(body: FaceDetectRequest):
    if not face_recognition_service.ready:
        raise HTTPException(503, "Модели YuNet/SFace не установлены. python scripts/download_face_models.py")
    try:
        image = face_recognition_service.decode_image(body.image)
        faces = face_recognition_service.detect_faces(image)
        return {"faces": faces, "count": len(faces)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/face/embedding")
async def face_embedding(body: FaceDetectRequest):
    if not face_recognition_service.ready:
        raise HTTPException(503, "Модели YuNet/SFace не установлены.")
    try:
        result = face_recognition_service.embedding_from_image(body.image)
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/users/{user_id}/face-enroll")
async def face_enroll(user_id: int, body: FaceEnrollRequest | None = None):
    """Mark face enrolled; optionally store embedding from image."""
    body = body or FaceEnrollRequest()
    if body.image and face_recognition_service.ready:
        try:
            emb = face_recognition_service.embedding_from_image(body.image)
            if hasattr(db_service, "set_face_embedding"):
                db_service.set_face_embedding(user_id, emb["embedding"])
            elif hasattr(db_service, "update_user"):
                try:
                    db_service.update_user(user_id, face_enrolled=1)
                except TypeError:
                    pass
            return {"success": True, "face_area": emb.get("face_area"), "dims": 128}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    # Fallback: mark enrolled without embedding
    if hasattr(db_service, "update_user"):
        try:
            db_service.update_user(user_id, face_enrolled=1)
        except TypeError:
            pass
    return {"success": True, "note": "enrolled_without_embedding"}


@app.post("/api/biometrics/liveness/challenge")
async def create_liveness_challenge(body: LivenessChallengeRequest):
    if not liveness_service.ready:
        raise HTTPException(
            503,
            "Модель liveness не установлена. python scripts/download_models.py",
        )
    return liveness_service.create(admin_id=1, subject_id=body.user_id)


@app.post("/api/biometrics/liveness/verify")
async def verify_liveness(body: LivenessVerifyRequest):
    result = liveness_service.verify(
        body.challenge_id,
        admin_id=1,
        subject_id=body.user_id,
        evidence=[item.model_dump() for item in body.evidence],
    )
    if not result.get("verified"):
        raise HTTPException(422, detail=result)
    return result


# ── Access ───────────────────────────────────────────────────────────────────

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
    ctx = AccessContext(
        nfc_uid=body.nfc_uid,
        user_id=body.user_id,
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
        user_id=body.user_id,
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
                stream_service.request_start()
            elif data == "stop_stream":
                stream_service.stop_stream()
            else:
                await websocket.send_json({"type": "echo", "payload": {"message": data}})
    except WebSocketDisconnect:
        stream_service.disconnect(websocket)
