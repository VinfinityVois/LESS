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
from app.services.tamper_evident_audit import audit_journal
from app.services.db_service import db_service
from app.services.auth_service import auth_service
from app.services.admin_auth_service import admin_auth_service
from app.services.liveness_service import liveness_service
from app.services.face_recognition_service import face_recognition_service
from app.services.ai_analyzer import ai_analyzer
from app.services.ml_anomaly_detector import ml_anomaly_detector
from app.services.incident_correlation import incident_correlation_engine
from app.services.fingerprint_service import fingerprint_service
from app.services.local_ai_assistant import local_ai_assistant
from app.services.pad_metrics import evaluate_pad_trials
from app.services.stream_service import stream_service
from app.services.access_policy import (
    access_policy,
    AccessContext,
    Direction,
    AccessDecision,
    AccessResult,
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


class IncidentStatusRequest(BaseModel):
    status: str = Field(pattern="^(open|resolved|dismissed)$")


class IncidentAssistantRequest(BaseModel):
    incident_id: int = Field(gt=0)
    question: str = Field(default="", max_length=500)


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
            or (path.startswith("/api/serial") and request.method != "GET")
            or path in {"/api/ai/analyze", "/api/ai/anomaly/analyze", "/api/ai/incidents/analyze"}
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

@app.get("/api/security/audit/verify")
async def verify_security_audit():
    return audit_journal.verify()


@app.get("/api/hardware/status")
async def hardware_status():
    return serial_service.hardware_status()


@app.post("/api/ai/analyze")
async def run_ai_analyze():
    return {"generated_alerts": ai_analyzer.run_periodic_check()}


@app.post("/api/ai/anomaly/analyze")
async def run_ml_anomaly_analysis(request: Request):
    """Run advisory cohort anomaly analysis; never changes access decisions."""
    logs = db_service.get_recent_logs(limit=5000)
    result = ml_anomaly_detector.analyze(logs)
    admin_auth_service.audit(request.state.admin["id"], "ai.anomaly_analysis_run", "access_logs", f"status={result.get('status')}; anomalies={result.get('anomaly_count', 0)}")
    return result


@app.post("/api/ai/incidents/analyze")
async def analyze_security_incidents(request: Request):
    """Correlate rule and ML signals into advisory, auditable incidents."""
    logs = db_service.get_recent_logs(limit=1000)
    ml_result = ml_anomaly_detector.analyze(logs)
    candidates = incident_correlation_engine.build_incidents(logs, ml_result)
    persisted = [db_service.upsert_security_incident(item) for item in candidates]
    admin_auth_service.audit(request.state.admin["id"], "ai.incident_analysis_run", "security_incidents", f"ml_status={ml_result.get('status')}; generated={len(persisted)}")
    return {"ml_status": ml_result.get("status"), "generated": len(persisted), "incidents": persisted}


@app.get("/api/ai/incidents")
async def list_security_incidents(limit: int = Query(100, ge=1, le=500), status: Optional[str] = Query(None, pattern="^(open|resolved|dismissed)$")):
    return {"incidents": db_service.get_security_incidents(limit=limit, status=status)}


@app.patch("/api/ai/incidents/{incident_id}")
async def update_security_incident(incident_id: int, body: IncidentStatusRequest, request: Request):
    incident = db_service.update_security_incident_status(incident_id, body.status)
    if not incident:
        raise HTTPException(status_code=404, detail="Инцидент не найден.")
    admin_auth_service.audit(request.state.admin["id"], "security.incident_status_updated", str(incident_id), f"status={body.status}")
    return incident


@app.get("/api/ai/assistant/status")
async def local_ai_assistant_status():
    return await local_ai_assistant.status()


@app.post("/api/ai/assistant/explain")
async def explain_security_incident(body: IncidentAssistantRequest, request: Request):
    incident = db_service.get_security_incident(body.incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Инцидент не найден.")
    admin_auth_service.audit(request.state.admin["id"], "ai.incident_explanation_requested", str(body.incident_id), "Запрошено локальное объяснение инцидента")
    return await local_ai_assistant.explain_incident(incident, body.question)


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

@app.get("/api/serial/read")
def serial_read():
    line = serial_service.read_line()
    return {"line": line}





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
    purpose: str = Field(default="face_enrollment", pattern="^(face_enrollment|pad_testing)$")


class LivenessActionEvidence(BaseModel):
    action: str = Field(pattern="^(blink|turn_head|open_mouth|smile)$")
    frames: list[str] = Field(min_length=8, max_length=36)

    @field_validator("frames")
    @classmethod
    def validate_frame_sizes(cls, frames: list[str]) -> list[str]:
        if any(not isinstance(frame, str) or len(frame) > 2_100_000 for frame in frames):
            raise ValueError("Кадр проверки превышает допустимый размер.")
        return frames


class PADTrialRequest(BaseModel):
    trial_class: str = Field(pattern="^(bona_fide|attack)$")
    attack_type: str = Field(default="", max_length=64)
    accepted: bool
    failure_reason: str = Field(default="", max_length=200)
    test_condition: str = Field(default="", max_length=120)
    camera_label: str = Field(default="", max_length=80)


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


@app.get("/api/biometrics/fingerprint/status")
async def fingerprint_device_status():
    status = fingerprint_service.status()
    return {"available": status.available, "device_id": status.device_id, "vendor": status.vendor, "message": status.message}


@app.post("/api/biometrics/liveness/challenge")
async def create_liveness_challenge(body: LivenessChallengeRequest, request: Request):
    subject = db_service.get_user(body.user_id, include_logs=False)
    if not subject or not subject.get("is_active") or subject.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Сотрудник не найден, удалён или отключён. Сначала создайте активную карточку сотрудника.")
    require_biometric_encryption_key()
    if not body.consent_confirmed:
        raise HTTPException(status_code=400, detail="Перед регистрацией необходимо подтвердить согласие субъекта на обработку биометрических данных.")
    consent_purpose = "Полевое испытание PAD" if body.purpose == "pad_testing" else "Регистрация биометрического шаблона"
    db_service.record_biometric_consent(body.user_id, request.state.admin["id"], purpose=consent_purpose)
    admin_auth_service.audit(request.state.admin["id"], "biometric.consent_recorded", str(body.user_id), "Оператор подтвердил наличие согласия субъекта")
    return liveness_service.create(request.state.admin["id"], body.user_id, purpose=body.purpose)


@app.post("/api/biometrics/liveness/evaluation-trials")
async def record_pad_evaluation_trial(body: PADTrialRequest, request: Request):
    if body.trial_class == "attack" and not body.attack_type.strip():
        raise HTTPException(status_code=422, detail="Для испытания атаки укажите её тип.")
    trial_id = db_service.record_pad_trial(
        body.trial_class,
        body.attack_type.strip(),
        body.accepted,
        body.failure_reason,
        body.test_condition,
        body.camera_label,
    )
    admin_auth_service.audit(
        request.state.admin["id"],
        "biometric.pad_trial_recorded",
        str(trial_id),
        f"class={body.trial_class}; attack_type={body.attack_type}; accepted={body.accepted}; camera={body.camera_label}; condition={body.test_condition}",
    )
    return {"id": trial_id, "recorded": True}


@app.get("/api/biometrics/liveness/evaluation-report")
async def get_pad_evaluation_report():
    trials = db_service.get_pad_trials(limit=5000)
    try:
        report = evaluate_pad_trials(trials)
        return {"status": "ok", "report": report}
    except ValueError as exc:
        return {
            "status": "insufficient_data",
            "counts": {"total": len(trials)},
            "message": str(exc),
        }


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
    try:
        front = await asyncio.to_thread(face_recognition_service.embedding_from_image, body.front_photo)
        profile = await asyncio.to_thread(face_recognition_service.embedding_from_image, body.profile_photo)
        candidates = db_service.find_similar_face_vectors(
            user_id=user_id, front_vector=front["embedding"],
            profile_vector=profile["embedding"], limit=5,
        )
        db_service.save_face_profile(
            user_id=user_id, front_landmarks=body.front_landmarks,
            profile_landmarks=body.profile_landmarks, front_photo=body.front_photo,
            profile_photo=body.profile_photo,
        )
        db_service.save_face_vectors(user_id, front["embedding"], profile["embedding"])
    except RuntimeError as exc:
        code = str(exc)
        status = 503 if code == "face_models_missing" else 422
        raise HTTPException(status_code=status, detail=(
            "Не установлены модели YuNet/SFace. Выполните python scripts/download_face_models.py в папке backend."
            if code == "face_models_missing" else "Не удалось создать биометрический вектор."
        )) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=(
            "На каждом снимке должно быть ровно одно достаточно крупное лицо."
            if str(exc) in {"face_count_invalid", "face_too_small"} else str(exc)
        )) from exc
    return {
        "success": True,
        "message": "Биометрический профиль сохранён: два зашифрованных 128-мерных шаблона YuNet/SFace.",
        "duplicate_candidates": candidates,
        "embedding_dimensions": 128,
        "note": "Процент сходства — cosine similarity модели, а не вероятность личности. Рабочий порог применяется отдельно при проходе.",
    }



class FaceAccessChallengeRequest(BaseModel):
    nfc_uid: str = Field(min_length=1, max_length=128)
    door_id: str = Field(default="main", min_length=1, max_length=64, pattern="^[A-Za-z0-9_.-]+$")
    direction: str = Field(default="in", pattern="^(in|out)$")


class FaceAccessVerifyRequest(BaseModel):
    nfc_uid: str = Field(min_length=1, max_length=128)
    challenge_id: str = Field(min_length=20, max_length=128)
    door_id: str = Field(default="main", min_length=1, max_length=64, pattern="^[A-Za-z0-9_.-]+$")
    direction: str = Field(default="in", pattern="^(in|out)$")
    evidence: list[LivenessActionEvidence] = Field(min_length=4, max_length=4)

    @field_validator("evidence")
    @classmethod
    def limit_total_evidence_size(cls, evidence: list[LivenessActionEvidence]) -> list[LivenessActionEvidence]:
        total_chars = sum(len(frame) for item in evidence for frame in item.frames)
        if total_chars > 24_000_000:
            raise ValueError("Суммарный размер кадров проверки превышает 24 МБ.")
        return evidence

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


async def request_hardware_unlock(door_id: str) -> dict:
    command = serial_service.send_secure_command("unlock", door_id, duration_ms=3000)
    ack = await asyncio.to_thread(
        serial_service.wait_for_ack,
        command["command_id"],
        float(getattr(settings, "CONTROLLER_ACK_TIMEOUT", 4.0)),
    )
    if not ack:
        raise TimeoutError("controller_ack_timeout")
    if not ack.get("accepted") or ack.get("lock_state") != "unlocked" or ack.get("door_state") not in {"closed", "open"}:
        raise RuntimeError("controller_ack_invalid")
    return ack


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
        result = access_policy.evaluate(ctx, defer_commit=True)
    hardware_ack = None
    if result.decision == AccessDecision.ALLOW:
        try:
            hardware_ack = await request_hardware_unlock(body.door_id)
            result = access_policy.commit_success(ctx)
        except Exception as exc:
            access_policy.register_denied(ctx, "hardware_controller_failure")
            code = "hardware_ack_invalid" if str(exc) in {"controller_ack_invalid", "controller_ack_timeout"} else "hardware_controller_unavailable"
            message = "Контроллер не подтвердил физическое состояние двери. Проход запрещён."
            result = AccessResult(AccessDecision.DENY, message, code)
            logger.warning(f"Hardware unlock fail-closed: {exc}")
    event = "granted" if result.decision == AccessDecision.ALLOW else "denied"
    audit_identity = body.nfc_uid or (
        "GUEST:" + hashlib.sha256(body.guest_code.strip().upper().encode("utf-8")).hexdigest()[:12]
        if body.guest_code else ""
    )
    event_id = db_service.log_access(
        nfc_uid=audit_identity,
        event_type=event,
        factor_used=body.factor,
        reason=f"{result.code}: {result.reason}; controller={hardware_ack or 'not_confirmed'}",
        user_id=resolved_user_id,
        direction=direction.value,
        door_id=body.door_id,
    )
    return {
        "decision": result.decision.value,
        "reason": result.reason,
        "code": result.code,
        "event_id": event_id,
        "hardware": {"confirmed": bool(hardware_ack), "lock_state": (hardware_ack or {}).get("lock_state", "unknown"),
                     "door_state": (hardware_ack or {}).get("door_state", "unknown")},
        "details": result.details,
    }


@app.post("/api/access/face-challenge")
async def create_face_access_challenge(body: FaceAccessChallengeRequest, request: Request):
    subject = db_service.get_user_by_nfc(body.nfc_uid)
    if not subject:
        db_service.log_access(body.nfc_uid, "denied", "nfc+face", "user_not_found: карта не зарегистрирована", direction=body.direction, door_id=body.door_id)
        raise HTTPException(status_code=404, detail={"code": "user_not_found", "message": "Карта не зарегистрирована или сотрудник отключён. Проход запрещён."})
    templates = {item["user_id"] for item in db_service.list_face_vectors()}
    if subject["id"] not in templates:
        db_service.log_access(body.nfc_uid, "denied", "nfc+face", "face_profile_missing: нет настоящего SFace-шаблона", user_id=subject["id"], direction=body.direction, door_id=body.door_id)
        raise HTTPException(status_code=403, detail={"code": "face_profile_missing", "message": "Для сотрудника не зарегистрирован настоящий биометрический шаблон. Проход запрещён."})
    if not db_service.has_biometric_consent(subject["id"]):
        db_service.log_access(body.nfc_uid, "denied", "nfc+face", "biometric_consent_missing", user_id=subject["id"], direction=body.direction, door_id=body.door_id)
        raise HTTPException(status_code=403, detail={"code": "biometric_consent_missing", "message": "Нет действующего согласия на обработку биометрии. Проход запрещён."})
    challenge = liveness_service.create(request.state.admin["id"], subject["id"])
    profile = db_service.get_user(subject["id"], include_logs=False) or {}
    return {
        **challenge,
        "user": {
            "id": subject["id"], "name": subject.get("name") or "Без имени",
            "position": subject.get("position") or "",
            "photo_data_url": profile.get("photo_data_url") or profile.get("profile_photo_data_url"),
        },
        "door_id": body.door_id,
        "direction": body.direction,
    }


@app.post("/api/access/check-face")
async def access_check_face(body: FaceAccessVerifyRequest, request: Request):
    subject = db_service.get_user_by_nfc(body.nfc_uid)
    direction = Direction.IN if body.direction == "in" else Direction.OUT
    if not subject or not subject.get("is_active") or subject.get("deleted_at"):
        raise HTTPException(status_code=403, detail={"code": "user_not_found", "message": "Карта неизвестна или отключена. Проход запрещён."})
    admin_id = request.state.admin["id"]
    verification = liveness_service.verify(
        body.challenge_id, admin_id, subject["id"],
        [item.model_dump() for item in body.evidence],
    )
    if not verification.get("verified"):
        reason = verification.get("reason", "liveness_failed")
        ctx = AccessContext(nfc_uid=body.nfc_uid, user_id=subject["id"], door_id=body.door_id, direction=direction, factor="nfc+face")
        access_policy.register_denied(ctx, reason)
        event_id = db_service.log_access(
            body.nfc_uid, "denied", "nfc+face",
            f"liveness_failed:{reason}", user_id=subject["id"],
            direction=direction.value, door_id=body.door_id,
        )
        admin_auth_service.audit(admin_id, "access.face_liveness_failed", str(event_id), reason)
        raise HTTPException(status_code=422, detail={
            "code": reason, "message": "Проверка живого присутствия не пройдена. Доступ запрещён.",
            "failed_action": verification.get("failed_action"),
            "diagnostics": verification.get("diagnostics"),
        })
    proof = verification.get("proof_token", "")
    if not liveness_service.consume_proof(proof, admin_id, subject["id"]):
        raise HTTPException(status_code=422, detail={"code": "liveness_proof_invalid", "message": "Подтверждение живого присутствия недействительно."})
    try:
        final_frame = body.evidence[-1].frames[-1]
        observed = await asyncio.to_thread(face_recognition_service.embedding_from_image, final_frame)
    except RuntimeError as exc:
        ctx = AccessContext(nfc_uid=body.nfc_uid, user_id=subject["id"], door_id=body.door_id, direction=direction, factor="nfc+face")
        access_policy.register_denied(ctx, "face_engine_unavailable")
        event_id = db_service.log_access(body.nfc_uid, "denied", "nfc+face", "face_engine_unavailable", user_id=subject["id"], direction=direction.value, door_id=body.door_id)
        admin_auth_service.audit(admin_id, "access.face_engine_unavailable", str(event_id), str(exc))
        raise HTTPException(status_code=503, detail={"code": "face_engine_unavailable", "message": "Модуль распознавания лица недоступен или модели не установлены. Проход запрещён."}) from exc
    except ValueError as exc:
        ctx = AccessContext(nfc_uid=body.nfc_uid, user_id=subject["id"], door_id=body.door_id, direction=direction, factor="nfc+face")
        access_policy.register_denied(ctx, "face_not_detected")
        event_id = db_service.log_access(body.nfc_uid, "denied", "nfc+face", "face_not_detected", user_id=subject["id"], direction=direction.value, door_id=body.door_id)
        admin_auth_service.audit(admin_id, "access.face_not_detected", str(event_id), str(exc))
        raise HTTPException(status_code=422, detail={"code": "face_not_detected", "message": "Не удалось выделить ровно одно лицо в кадре. Проход запрещён."}) from exc

    from app.services.face_recognition_service import face_recognition_service as face_engine
    ranked = []
    for item in db_service.list_face_vectors():
        scores = [face_engine.cosine_similarity(observed["embedding"], item["front_vector"])]
        if item["profile_vector"]:
            scores.append(face_engine.cosine_similarity(observed["embedding"], item["profile_vector"]))
        ranked.append({**item, "score": max(scores)})
    ranked.sort(key=lambda item: item["score"], reverse=True)
    best = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None
    threshold = face_engine.MATCH_THRESHOLD
    margin = best["score"] - second["score"] if best and second else 1.0
    if not best or best["score"] < threshold:
        decision_code, decision_message = "face_unknown", "Лицо не найдено среди зарегистрированных сотрудников."
        matched = None
    elif margin < face_engine.AMBIGUITY_MARGIN:
        decision_code, decision_message = "face_ambiguous", "Совпадение неоднозначно: несколько профилей имеют близкую оценку."
        matched = None
    elif best["user_id"] != subject["id"]:
        decision_code, decision_message = "face_card_mismatch", "Лицо не соответствует сотруднику, которому принадлежит приложенная карта."
        matched = best
    else:
        decision_code, decision_message, matched = "face_verified", "Личность подтверждена по карте и лицу.", best

    if not matched or decision_code != "face_verified":
        ctx = AccessContext(nfc_uid=body.nfc_uid, user_id=subject["id"], door_id=body.door_id, direction=direction, factor="nfc+face")
        access_policy.register_denied(ctx, decision_code)
        event_id = db_service.log_access(body.nfc_uid, "denied", "nfc+face",
            f"{decision_code}: {decision_message}; score={best['score'] if best else 'none'}",
            user_id=subject["id"], direction=direction.value, door_id=body.door_id)
        admin_auth_service.audit(admin_id, "access.face_denied", str(event_id), decision_code)
        return {
            "decision": "deny", "code": decision_code, "reason": decision_message,
            "similarity": round(best["score"] * 100, 1) if best else None,
            "subject": {
                "id": (matched or {}).get("user_id", subject["id"]),
                "name": (matched or {}).get("name") or subject.get("name") or "Без имени",
                "position": (matched or {}).get("position") or subject.get("position") or "",
                "photo_data_url": (matched or {}).get("photo_data_url") or (
                    (db_service.get_user(subject["id"], include_logs=False) or {}).get("photo_data_url")
                ),
            },
        }

    ctx = AccessContext(nfc_uid=body.nfc_uid, user_id=subject["id"], door_id=body.door_id, direction=direction, factor="nfc+face")
    policy_result = access_policy.evaluate(ctx, defer_commit=True)
    final_decision = policy_result.decision
    final_code = policy_result.code
    final_reason = policy_result.reason
    hardware_ack = None

    # A policy decision is not a physical access grant. Require a signed,
    # fresh controller ACK and a sane door-sensor state before recording grant.
    if final_decision == AccessDecision.ALLOW:
        try:
            hardware_ack = await request_hardware_unlock(body.door_id)
            committed = access_policy.commit_success(ctx)
            if committed.decision != AccessDecision.ALLOW:
                final_decision = AccessDecision.DENY
                final_code = committed.code
                final_reason = committed.reason
                access_policy.register_denied(ctx, final_code)
        except Exception as exc:
            final_decision = AccessDecision.DENY
            final_code = "hardware_ack_invalid" if str(exc) in {"controller_ack_invalid", "controller_ack_timeout"} else "hardware_controller_unavailable"
            final_reason = "Контроллер не подтвердил физическое состояние двери. Проход запрещён."
            access_policy.register_denied(ctx, final_code)
            logger.warning(f"Hardware unlock fail-closed: {exc}")

    event = "granted" if final_decision == AccessDecision.ALLOW else "denied"
    event_id = db_service.log_access(
        body.nfc_uid, event, "nfc+face",
        f"{final_code}: {final_reason}; face_cosine={best['score']:.4f}; controller={hardware_ack or 'not_confirmed'}",
        user_id=subject["id"], direction=direction.value, door_id=body.door_id,
    )
    admin_auth_service.audit(
        admin_id,
        "access.hardware_confirmed" if event == "granted" else "access.hardware_denied",
        str(event_id),
        f"code={final_code}; controller_ack={bool(hardware_ack)}",
    )
    return {
        "decision": final_decision.value, "code": final_code,
        "reason": final_reason, "similarity": round(best["score"] * 100, 1),
        "liveness": "passed", "event_id": event_id,
        "hardware": {
            "confirmed": bool(hardware_ack and hardware_ack.get("accepted") and hardware_ack.get("lock_state") == "unlocked"),
            "lock_state": (hardware_ack or {}).get("lock_state", "unknown"),
            "door_state": (hardware_ack or {}).get("door_state", "unknown"),
        },
        "subject": {
            "id": subject["id"], "name": subject.get("name") or "Без имени",
            "position": subject.get("position") or "",
            "photo_data_url": best.get("photo_data_url"),
        },
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
