"""
LESS Backend — точка входа
Запуск: uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from typing import Optional
from pydantic import BaseModel, Field

from app.config import settings
from app.services.camera_service import camera_service
from app.services.serial_service import serial_service
from app.services.db_service import db_service
from app.services.auth_service import auth_service
from app.services.admin_auth_service import admin_auth_service
from app.services.liveness_service import liveness_service
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


PUBLIC_AUTH_PATHS = {"/api/status", "/api/auth/bootstrap-status", "/api/auth/bootstrap", "/api/auth/login"}

@app.middleware("http")
async def protect_control_plane(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_AUTH_PATHS and request.method != "OPTIONS":
        header = request.headers.get("Authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        actor = admin_auth_service.authenticate(token)
        if not actor:
            return JSONResponse(status_code=401, content={"detail": "Требуется авторизация администратора."})
        request.state.admin = actor
        if actor["role"] == "security" and (
            (path.startswith("/api/users") and request.method in {"POST", "PATCH", "DELETE"})
            or path.startswith("/api/biometrics")
            or path.startswith("/api/camera")
            or path.startswith("/api/serial")
            or path.startswith("/api/ai")
            or path == "/api/access/check"
        ):
            return JSONResponse(status_code=403, content={"detail": "Недостаточно прав для этой операции."})
        if path.startswith("/api/biometrics") and actor["role"] == "security":
            return JSONResponse(status_code=403, content={"detail": "Недостаточно прав для биометрической регистрации."})
        if path.startswith("/api/auth/admins") and actor["role"] != "superadmin":
            return JSONResponse(status_code=403, content={"detail": "Управлять администраторами может только суперадминистратор."})
        if path.startswith("/api/access/guest-codes") and request.method == "POST" and actor["role"] == "security":
            return JSONResponse(status_code=403, content={"detail": "Недостаточно прав для выдачи гостевых пропусков."})
    response = await call_next(request)
    actor = getattr(request.state, "admin", None)
    if actor and request.method in {"POST", "PATCH", "DELETE"} and response.status_code < 400:
        admin_auth_service.audit(actor["id"], f"api.{request.method.lower()}", path, f"status={response.status_code}")
    return response


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




class AdminBootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class AdminCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    role: str = Field(default="admin", pattern="^(admin|security)$")


class AdminActiveRequest(BaseModel):
    is_active: bool


class LivenessChallengeRequest(BaseModel):
    user_id: int
    consent_confirmed: bool = False


class LivenessVerifyRequest(BaseModel):
    user_id: int
    challenge_id: str = Field(min_length=20, max_length=128)
    evidence: list[dict]


@app.get("/api/auth/bootstrap-status")
async def auth_bootstrap_status():
    return admin_auth_service.bootstrap_status()


@app.post("/api/auth/bootstrap")
async def auth_bootstrap(body: AdminBootstrapRequest):
    try:
        admin_auth_service.bootstrap(body.username, body.password, body.display_name)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return admin_auth_service.login(body.username, body.password)


@app.post("/api/auth/login")
async def auth_login(body: AdminLoginRequest):
    result = admin_auth_service.login(body.username, body.password)
    if not result:
        raise HTTPException(status_code=401, detail="Неверный логин/пароль или вход временно заблокирован.")
    return result


@app.get("/api/auth/me")
async def auth_me(request: Request):
    return request.state.admin


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    admin_auth_service.logout(token)
    return {"success": True}


@app.get("/api/auth/admins")
async def auth_list_admins():
    return {"admins": admin_auth_service.list_admins()}


@app.post("/api/auth/admins")
async def auth_create_admin(body: AdminCreateRequest, request: Request):
    try:
        return admin_auth_service.create_managed_admin(body.username, body.password, body.display_name, body.role, request.state.admin)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Не удалось создать учётную запись. Проверьте уникальность логина.") from exc


@app.patch("/api/auth/admins/{admin_id}")
async def auth_set_admin_active(admin_id: int, body: AdminActiveRequest, request: Request):
    if admin_id == request.state.admin["id"] and not body.is_active:
        raise HTTPException(status_code=400, detail="Нельзя отключить собственную активную учётную запись.")
    if not admin_auth_service.set_admin_active(admin_id, body.is_active, request.state.admin):
        raise HTTPException(status_code=404, detail="Администратор не найден.")
    return {"success": True}


@app.get("/api/auth/audit")
async def auth_audit(limit: int = Query(100, ge=1, le=500)):
    return {"events": admin_auth_service.get_audit(limit)}


@app.post("/api/biometrics/liveness/challenge")
async def create_liveness_challenge(body: LivenessChallengeRequest, request: Request):
    require_biometric_encryption_key()
    if not db_service.get_user(body.user_id, include_logs=False):
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Перед регистрацией необходимо подтвердить согласие субъекта на обработку биометрических данных.")
    db_service.record_biometric_consent(body.user_id, request.state.admin["id"])
    admin_auth_service.audit(request.state.admin["id"], "biometric.consent_recorded", str(body.user_id), "Оператор подтвердил наличие согласия субъекта")
    return liveness_service.create(request.state.admin["id"], body.user_id)


@app.post("/api/biometrics/liveness/verify")
async def verify_liveness(body: LivenessVerifyRequest, request: Request):
    result = liveness_service.verify(body.challenge_id, request.state.admin["id"], body.user_id, body.evidence)
    if not result.get("verified"):
        raise HTTPException(status_code=422, detail=result.get("reason", "Проверка присутствия не пройдена."))
    return result


def require_biometric_encryption_key():
    if settings.SECRET_KEY == "change-me-in-production-use-openssl-rand-hex-32":
        raise HTTPException(status_code=503, detail="Перед сохранением фото и биометрии задайте уникальный SECRET_KEY в backend/.env.")


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
    liveness_proof: str = Field(min_length=20, max_length=128)


@app.get("/api/users")
async def list_users(include_inactive: bool = Query(True)):
    return {"users": db_service.list_users(include_inactive=include_inactive)}


@app.post("/api/users")
async def create_user(body: UserCreateRequest):
    if body.photo_data_url:
        require_biometric_encryption_key()
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
    if changes.get("photo_data_url"):
        require_biometric_encryption_key()
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
async def enroll_face(user_id: int, body: FaceEnrollRequest, request: Request):
    user = db_service.get_user(user_id, include_logs=False)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    require_biometric_encryption_key()
    if not db_service.has_biometric_consent(user_id):
        raise HTTPException(status_code=403, detail="Для регистрации биометрии требуется зафиксированное согласие субъекта.")
    if not liveness_service.consume_proof(body.liveness_proof, request.state.admin["id"], user_id):
        raise HTTPException(status_code=422, detail="Нет действительного подтверждения проверки присутствия. Пройдите liveness challenge заново.")
    if len(body.front_landmarks) < 300 or len(body.profile_landmarks) < 300:
        raise HTTPException(status_code=422, detail="Недостаточно контрольных точек лица.")
    if len(body.front_photo) > 8_000_000 or len(body.profile_photo) > 8_000_000:
        raise HTTPException(status_code=413, detail="Изображение превышает допустимый размер.")
    candidates = db_service.find_similar_faces(user_id=user_id, landmarks=body.front_landmarks, limit=5)
    try:
        db_service.save_face_profile(
            user_id=user_id, front_landmarks=body.front_landmarks,
            profile_landmarks=body.profile_landmarks, front_photo=body.front_photo,
            profile_photo=body.profile_photo,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
        direction=direction.value,
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
        try:
            handshake = json.loads(await websocket.receive_text())
        except (json.JSONDecodeError, TypeError):
            await websocket.close(code=4401, reason="Authentication required")
            stream_service.disconnect(websocket)
            return
        token = handshake.get("token", "") if handshake.get("type") == "auth" else ""
        actor = admin_auth_service.authenticate(token)
        if not actor:
            await websocket.close(code=4401, reason="Unauthorized")
            stream_service.disconnect(websocket)
            return
        await websocket.send_json({"type": "auth_ok", "user": actor})
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
