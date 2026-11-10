"""
LESS Backend — точка входа
Запуск: uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager
import asyncio
import json
import hashlib
import string
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from typing import Optional
from pydantic import BaseModel, Field, field_validator

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
        if path.startswith("/api/access/guest-codes") and request.method in {"POST", "PATCH", "DELETE"} and actor["role"] == "security":
            return JSONResponse(status_code=403, content={"detail": "Недостаточно прав для управления гостевыми пропусками."})
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
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
    stream_service.request_start()
    return {"success": True, "message": "Запрос запуска общего видеопотока принят."}


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




class AdminBootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    remember_me: bool = False


class AdminCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    role: str = Field(default="admin", pattern="^(admin|security)$")


class AdminActiveRequest(BaseModel):
    is_active: bool


class LivenessChallengeRequest(BaseModel):
    user_id: int = Field(gt=0)
    consent_confirmed: bool = False


class LivenessActionEvidence(BaseModel):
    action: str = Field(pattern="^(blink|turn_head|open_mouth|smile)$")
    frames: list[str] = Field(min_length=8, max_length=36)

    @field_validator("frames")
    @classmethod
    def validate_frame_sizes(cls, frames: list[str]) -> list[str]:
        if any(not isinstance(frame, str) or len(frame) > 2_100_000 for frame in frames):
            raise ValueError("Кадр проверки превышает допустимый размер.")
        return frames


class LivenessVerifyRequest(BaseModel):
    user_id: int = Field(gt=0)
    challenge_id: str = Field(min_length=20, max_length=128)
    evidence: list[LivenessActionEvidence] = Field(min_length=4, max_length=4)


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
    result = admin_auth_service.login(body.username, body.password, remember_me=body.remember_me)
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
    subject = db_service.get_user(body.user_id, include_logs=False)
    if not subject or not subject.get("is_active") or subject.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Сотрудник не найден, удалён или отключён. Сначала создайте активную карточку сотрудника.")
    require_biometric_encryption_key()
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Перед регистрацией необходимо подтвердить согласие субъекта на обработку биометрических данных.")
    db_service.record_biometric_consent(body.user_id, request.state.admin["id"])
    admin_auth_service.audit(request.state.admin["id"], "biometric.consent_recorded", str(body.user_id), "Оператор подтвердил наличие согласия субъекта")
    return liveness_service.create(request.state.admin["id"], body.user_id)


@app.post("/api/biometrics/liveness/verify")
async def verify_liveness(body: LivenessVerifyRequest, request: Request):
    result = liveness_service.verify(body.challenge_id, request.state.admin["id"], body.user_id, [item.model_dump() for item in body.evidence])
    action_summary = ",".join(f"{item.get('action')}:{item.get('signal_delta')}" for item in result.get("results", []))
    admin_auth_service.audit(
        request.state.admin["id"],
        "biometric.liveness_verified" if result.get("verified") else "biometric.liveness_failed",
        str(body.user_id),
        f"reason={result.get('reason', 'ok')}; samples={action_summary}",
    )
    if not result.get("verified"):
        reason = result.get("reason", "Проверка присутствия не пройдена.")
        action = result.get("failed_action")
        message = {
            "challenge_action_failed": "Не удалось уверенно подтвердить действие перед камерой.",
            "insufficient_frames": "Недостаточно кадров для проверки. Повторите действие.",
            "challenge_sequence_mismatch": "Последовательность действий не совпала с заданием. Начните заново.",
            "liveness_engine_unavailable": "Модуль проверки присутствия временно недоступен.",
            "liveness_model_missing": "Не установлена локальная модель распознавания лица. Выполните: python scripts/download_models.py в папке backend.",
        }.get(reason, reason)
        raise HTTPException(status_code=422, detail={
            "code": reason,
            "message": message,
            "failed_action": action,
            "signal_delta": result.get("signal_delta"),
            "diagnostics": result.get("diagnostics"),
            "results": result.get("results", []),
        })
    return result


def require_biometric_encryption_key():
    key = (settings.SECRET_KEY or "").strip()
    valid_hex_key = (
        len(key) == 64
        and all(character in string.hexdigits for character in key)
        and len(set(key.lower())) >= 12
    )
    placeholder = not valid_hex_key or any(
        marker in key.lower()
        for marker in ("change-me", "replace-with", "example", "placeholder", "your-secret")
    )
    if placeholder:
        raise HTTPException(
            status_code=503,
            detail=(
                "Зашифрованное хранилище заблокировано: SECRET_KEY отсутствует или слишком слабый. "
                "Создайте ключ командой: python -c \"import secrets; print(secrets.token_hex(32))\". "
                "Добавьте SECRET_KEY=... в backend/.env и перезапустите backend. "
                "Не меняйте ключ после сохранения биометрии: без прежнего ключа зашифрованные данные не восстановить."
            ),
        )


class UserCreateRequest(BaseModel):
    nfc_uid: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=200)
    position: str = Field(default="", max_length=200)
    pin: Optional[str] = Field(default=None, max_length=64)
    is_active: bool = True
    photo_data_url: Optional[str] = Field(default=None, max_length=7_000_000)


class UserUpdateRequest(BaseModel):
    nfc_uid: Optional[str] = Field(default=None, min_length=1, max_length=128)
    name: Optional[str] = Field(default=None, max_length=200)
    position: Optional[str] = Field(default=None, max_length=200)
    pin: Optional[str] = Field(default=None, max_length=64)
    is_active: Optional[bool] = None
    photo_data_url: Optional[str] = None


class FaceEnrollRequest(BaseModel):
    front_landmarks: list[tuple[float, float, float]] = Field(min_length=300, max_length=478)
    profile_landmarks: list[tuple[float, float, float]] = Field(min_length=300, max_length=478)
    front_photo: str = Field(min_length=32, max_length=8_000_000)
    profile_photo: str = Field(min_length=32, max_length=8_000_000)
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
async def get_user(user_id: int, request: Request):
    user = db_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден.")
    # Security operators can inspect a subject record, but biometric photographs
    # are restricted to administrators with personnel-management privileges.
    if request.state.admin["role"] == "security":
        user.pop("photo_data_url", None)
        user.pop("profile_photo_data_url", None)
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
    if not user or not user.get("is_active") or user.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Сотрудник не найден, удалён или отключён. Регистрация биометрии невозможна.")
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
    nfc_uid: Optional[str] = Field(default=None, max_length=128)
    user_id: Optional[int] = Field(default=None, gt=0)
    door_id: str = Field(default="main", min_length=1, max_length=64, pattern="^[A-Za-z0-9_.-]+$")
    direction: str = Field(default="in", pattern="^(in|out)$")
    guest_code: Optional[str] = Field(default=None, max_length=128)
    factor: str = Field(default="nfc", min_length=1, max_length=32)


class TestCardRequest(BaseModel):
    label: str = Field(default="Тестовая карта", min_length=1, max_length=80)
    door_id: str = Field(default="main", min_length=1, max_length=64, pattern="^[A-Za-z0-9_.-]+$")
    direction: str = Field(default="in", pattern="^(in|out)$")


class GuestCodeCreate(BaseModel):
    label: str = "Гость"
    valid_hours: float = Field(default=2.0, ge=0.1, le=72)
    max_uses: int = Field(default=1, ge=1, le=100)
    door_ids: Optional[list] = None


@app.post("/api/access/check")
async def access_check(body: AccessCheckRequest):
    direction = Direction.IN if body.direction == "in" else Direction.OUT
    resolved_user = None
    identity_error = None
    if body.user_id is not None:
        supplied_user = db_service.get_user(body.user_id, include_logs=False)
        if not supplied_user or not supplied_user.get("is_active") or supplied_user.get("deleted_at"):
            identity_error = AccessResult(
                AccessDecision.DENY,
                "Сотрудник не найден, удалён или отключён. Доступ запрещён.",
                "user_not_found",
            )
        elif body.guest_code:
            identity_error = AccessResult(
                AccessDecision.DENY,
                "Нельзя смешивать внутренний ID сотрудника и гостевой код в одном запросе.",
                "identity_not_proven",
            )
        elif not body.nfc_uid:
            identity_error = AccessResult(
                AccessDecision.DENY,
                "Одного внутреннего ID недостаточно для подтверждения личности. Приложите NFC-карту.",
                "identity_not_proven",
            )
        else:
            resolved_user = db_service.get_user_by_nfc(body.nfc_uid)
            if not resolved_user or resolved_user["id"] != body.user_id:
                identity_error = AccessResult(
                    AccessDecision.DENY,
                    "UID карты не соответствует указанному сотруднику. Доступ запрещён.",
                    "identity_mismatch",
                )
                resolved_user = None
            else:
                resolved_user = supplied_user
    elif body.nfc_uid and not body.guest_code:
        resolved_user = db_service.get_user_by_nfc(body.nfc_uid)
        if not resolved_user:
            identity_error = AccessResult(
                AccessDecision.DENY,
                "Карта не привязана к действующему сотруднику. Доступ запрещён.",
                "user_not_found",
            )
    resolved_user_id = resolved_user["id"] if resolved_user else None
    ctx = AccessContext(
        nfc_uid=body.nfc_uid,
        user_id=resolved_user_id,
        door_id=body.door_id,
        direction=direction,
        guest_code=body.guest_code,
        factor=body.factor,
    )
    if identity_error:
        lockout = access_policy.check_subject_lockout(ctx)
        if lockout.decision == AccessDecision.DENY:
            result = lockout
        else:
            access_policy.register_denied(ctx, identity_error.reason)
            result = identity_error
    elif body.factor.lower() in {"face", "biometric", "face_biometric"}:
        result = AccessResult(
            AccessDecision.DENY,
            "Runtime-распознавание лица не подключено к проверке прохода.",
            "face_runtime_unavailable",
        )
    else:
        result = access_policy.evaluate(ctx)
    event = "granted" if result.decision == AccessDecision.ALLOW else "denied"
    audit_identity = body.nfc_uid or (
        "GUEST:" + hashlib.sha256(body.guest_code.strip().upper().encode("utf-8")).hexdigest()[:12]
        if body.guest_code else ""
    )
    db_service.log_access(
        nfc_uid=audit_identity,
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


@app.post("/api/access/test-card")
async def simulate_test_card(body: TestCardRequest, request: Request):
    """Record a test-card event without access-policy evaluation or hardware actuation."""
    actor = request.state.admin
    event_id = db_service.log_access(
        nfc_uid="TEST-CARD", event_type="simulated", factor_used="test-card",
        reason=f"SIMULATION_ONLY · {body.label} · оператор ID {actor['id']} · физический замок не задействован",
        direction=body.direction, door_id=body.door_id,
    )
    admin_auth_service.audit(actor["id"], "access.test_card_simulated", str(event_id), "No access policy or relay action executed")
    return {"success": True, "simulation": True, "event_id": event_id,
            "message": "Виртуальная карта принята в тестовом режиме. Это имитация: проверка личности, политика доступа и физический замок не задействованы."}


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


class GuestPassAction(BaseModel):
    action: str = Field(pattern="^(close|block|restore|reset|extend)$")
    hours: float = Field(default=2, ge=0.1, le=720)


@app.patch("/api/access/guest-codes/{pass_id}")
async def update_guest_code(pass_id: int, body: GuestPassAction):
    if not db_service.update_guest_pass(pass_id, body.action, body.hours):
        raise HTTPException(status_code=404, detail="Гостевой пропуск не найден.")
    return {"success": True, "codes": db_service.list_guest_passes()}


@app.delete("/api/access/guest-codes/{pass_id}")
async def delete_guest_code(pass_id: int):
    if not db_service.update_guest_pass(pass_id, "delete"):
        raise HTTPException(status_code=404, detail="Гостевой пропуск не найден.")
    return {"success": True}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await stream_service.connect(websocket)
    try:
        try:
            raw_handshake = await asyncio.wait_for(websocket.receive_text(), timeout=5)
            if len(raw_handshake) > 4096:
                await websocket.close(code=4400, reason="Handshake too large")
                return
            handshake = json.loads(raw_handshake)
            if not isinstance(handshake, dict):
                raise ValueError("Invalid handshake")
        except (json.JSONDecodeError, TypeError, ValueError, asyncio.TimeoutError):
            await websocket.close(code=4401, reason="Authentication required")
            return
        token = handshake.get("token", "") if handshake.get("type") == "auth" else ""
        if not isinstance(token, str) or len(token) > 512:
            token = ""
        actor = admin_auth_service.authenticate(token)
        if not actor:
            await websocket.close(code=4401, reason="Unauthorized")
            return
        stream_service.register(websocket)
        await websocket.send_json({"type": "auth_ok", "user": actor})
        while True:
            data = await websocket.receive_text()
            if data == "start_stream":
                stream_service.request_start()
            elif data == "stop_stream":
                if actor["role"] == "security":
                    await websocket.send_json({"type": "error", "code": "forbidden", "message": "Недостаточно прав для остановки общего видеопотока."})
                else:
                    stream_service.stop_stream()
            else:
                await websocket.send_json({"type": "echo", "payload": {"message": data}})
    except WebSocketDisconnect:
        stream_service.disconnect(websocket)
