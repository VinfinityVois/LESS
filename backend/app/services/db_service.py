"""
SQLite service for LESS. The complete database is encrypted with SQLCipher;
face templates and profile photos receive an additional AES-GCM encryption layer.
"""
from loguru import logger
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import base64
import hashlib
import json
import os
import math
import secrets
from datetime import timedelta
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import settings
from app.services.database import connect_encrypted, ensure_encrypted_database
from app.services.tamper_evident_audit import audit_journal


class DBService:
    def __init__(self):
        self.db_path = settings.DB_PATH
        ensure_encrypted_database(self.db_path, settings.SECRET_KEY)
        self._init_db()

    def _get_conn(self):
        return connect_encrypted(self.db_path)

    def _init_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nfc_uid TEXT UNIQUE NOT NULL,
                    name TEXT,
                    position TEXT DEFAULT '',
                    pin_hash TEXT,
                    fingerprint_hash TEXT,
                    face_embedding BLOB,
                    face_profile_embedding BLOB,
                    face_vector BLOB,
                    face_profile_vector BLOB,
                    photo_blob BLOB,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS access_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nfc_uid TEXT,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,
                    factor_used TEXT,
                    reason TEXT,
                    direction TEXT,
                    door_id TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS access_log_archive (
                    id INTEGER PRIMARY KEY,
                    nfc_uid TEXT,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,
                    factor_used TEXT,
                    reason TEXT,
                    direction TEXT,
                    door_id TEXT,
                    created_at TEXT NOT NULL,
                    archived_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ai_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_type TEXT NOT NULL,
                    message TEXT,
                    severity TEXT DEFAULT 'medium',
                    related_log_ids TEXT,
                    created_at TEXT NOT NULL,
                    is_resolved INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS guest_passes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code_hash TEXT NOT NULL UNIQUE,
                    code_prefix TEXT NOT NULL,
                    label TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    uses INTEGER NOT NULL DEFAULT 0,
                    door_ids TEXT NOT NULL DEFAULT '["main"]',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS guest_pass_archive (
                    id INTEGER PRIMARY KEY,
                    code_hash TEXT NOT NULL,
                    code_prefix TEXT NOT NULL,
                    label TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    uses INTEGER NOT NULL DEFAULT 0,
                    door_ids TEXT NOT NULL DEFAULT '["main"]',
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    archived_at TEXT NOT NULL,
                    archive_reason TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS biometric_consents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    admin_id INTEGER NOT NULL,
                    purpose TEXT NOT NULL,
                    consent_at TEXT NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS pad_trials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trial_class TEXT NOT NULL,
                    attack_type TEXT NOT NULL DEFAULT '',
                    accepted INTEGER NOT NULL,
                    failure_reason TEXT,
                    test_condition TEXT DEFAULT '',
                    camera_label TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS security_incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dedupe_key TEXT NOT NULL UNIQUE,
                    subject_ref TEXT,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    risk_score INTEGER NOT NULL,
                    evidence_json TEXT NOT NULL,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    occurrences INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'open',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS access_security_state (
                    subject_key TEXT PRIMARY KEY,
                    failures INTEGER NOT NULL DEFAULT 0,
                    window_started_at TEXT NOT NULL,
                    locked_until TEXT
                );
            """)
            self._ensure_column(conn, "users", "position", "TEXT DEFAULT ''")
            self._ensure_column(conn, "users", "face_profile_embedding", "BLOB")
            self._ensure_column(conn, "users", "face_vector", "BLOB")
            self._ensure_column(conn, "users", "face_profile_vector", "BLOB")
            self._ensure_column(conn, "users", "photo_blob", "BLOB")
            self._ensure_column(conn, "users", "profile_photo_blob", "BLOB")
            self._ensure_column(conn, "users", "face_observation", "BLOB")
            self._ensure_column(conn, "users", "deleted_at", "TEXT")
            self._ensure_column(conn, "access_logs", "direction", "TEXT")
            self._ensure_column(conn, "access_logs", "door_id", "TEXT")
            self._ensure_column(conn, "pad_trials", "test_condition", "TEXT")
            self._ensure_column(conn, "pad_trials", "camera_label", "TEXT")
        logger.info(f"БД инициализирована: {self.db_path}")
        if settings.SECRET_KEY == "change-me-in-production-use-openssl-rand-hex-32":
            logger.warning("SECRET_KEY задан значением по умолчанию: замените его перед хранением биометрии и фотографий.")

    @staticmethod
    def _ensure_column(conn, table: str, column: str, definition: str):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @staticmethod
    def _key() -> bytes:
        return hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()

    def _encrypt(self, raw: bytes) -> bytes:
        nonce = os.urandom(12)
        return nonce + AESGCM(self._key()).encrypt(nonce, raw, None)

    def _decrypt(self, blob: Optional[bytes]) -> Optional[bytes]:
        if not blob:
            return None
        try:
            return AESGCM(self._key()).decrypt(blob[:12], blob[12:], None)
        except Exception:
            logger.exception("Не удалось расшифровать персональные данные")
            return None

    def _photo_blob(self, data_url: Optional[str]) -> Optional[bytes]:
        if not data_url:
            return None
        if not data_url.startswith("data:image/") or "," not in data_url:
            raise ValueError("Ожидается data URL изображения.")
        mime = data_url.split(";", 1)[0][5:]
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            raise ValueError("Поддерживаются JPEG, PNG и WebP.")
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        if len(raw) > 5_000_000:
            raise ValueError("Фото превышает 5 МБ.")
        return self._encrypt(mime.encode("ascii") + b"\\0" + raw)

    def _photo_data_url(self, blob: Optional[bytes]) -> Optional[str]:
        packed = self._decrypt(blob)
        if not packed:
            return None
        mime, _, raw = packed.partition(b"\\0")
        if mime.decode("ascii", errors="ignore") not in {"image/jpeg", "image/png", "image/webp"}:
            return None
        return "data:" + mime.decode("ascii") + ";base64," + base64.b64encode(raw).decode("ascii")

    @staticmethod
    def _row_user(row, include_photo=False):
        if not row:
            return None
        user = dict(row)
        user["is_active"] = int(user.get("is_active") or 0)
        user["face_enrolled"] = int(bool(user.get("face_vector")))
        user["photo_available"] = bool(user.get("photo_blob") or user.get("profile_photo_blob"))
        for private_field in ("face_embedding", "face_profile_embedding", "face_vector", "face_profile_vector", "face_observation", "pin_hash", "fingerprint_hash"):
            user.pop(private_field, None)
        if not include_photo:
            user.pop("photo_blob", None)
            user.pop("profile_photo_blob", None)
        return user

    def add_user(self, nfc_uid: str, name: str = "", pin_hash: str = None,
                 fingerprint_hash: str = None, position: str = "", is_active: bool = True,
                 photo_data_url: Optional[str] = None) -> int:
        now = datetime.now(timezone.utc).isoformat()
        photo = self._photo_blob(photo_data_url)
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO users (nfc_uid,name,position,pin_hash,fingerprint_hash,photo_blob,is_active,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (nfc_uid, name, position, pin_hash, fingerprint_hash, photo, int(is_active), now),
            )
            return int(cur.lastrowid)

    def get_user_by_nfc(self, nfc_uid: str) -> Optional[Dict[str, Any]]:
        normalized = "".join(char for char in str(nfc_uid or "") if char.isalnum()).upper()
        if not normalized:
            return None
        with self._get_conn() as conn:
            row = conn.execute(
                """SELECT * FROM users
                   WHERE upper(replace(replace(replace(nfc_uid, ':', ''), '-', ''), ' ', ''))=?
                     AND is_active=1 AND deleted_at IS NULL""",
                (normalized,),
            ).fetchone()
            return dict(row) if row else None

    def list_users(self, include_inactive: bool = True, include_deleted: bool = False) -> List[Dict[str, Any]]:
        sql = """
            SELECT u.*,
              (SELECT created_at FROM access_logs l WHERE l.user_id=u.id AND l.direction='in' AND l.event_type='granted' ORDER BY l.id DESC LIMIT 1) AS last_entry,
              (SELECT created_at FROM access_logs l WHERE l.user_id=u.id AND l.direction='out' AND l.event_type='granted' ORDER BY l.id DESC LIMIT 1) AS last_exit,
              (SELECT COUNT(*) FROM access_logs l WHERE l.user_id=u.id) AS total_events
            FROM users u
        """
        filters = []
        if not include_inactive:
            filters.append("u.is_active=1")
        if not include_deleted:
            filters.append("u.deleted_at IS NULL")
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY u.created_at DESC"
        with self._get_conn() as conn:
            return [self._row_user(row) for row in conn.execute(sql).fetchall()]

    def get_user(self, user_id: int, include_logs: bool = True) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute("""
                SELECT u.*,
                  (SELECT created_at FROM (
                    SELECT created_at,user_id,direction,event_type,id FROM access_logs
                    UNION ALL SELECT created_at,user_id,direction,event_type,id FROM access_log_archive
                  ) l WHERE l.user_id=u.id AND l.direction='in' AND l.event_type='granted' ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS last_entry,
                  (SELECT created_at FROM (
                    SELECT created_at,user_id,direction,event_type,id FROM access_logs
                    UNION ALL SELECT created_at,user_id,direction,event_type,id FROM access_log_archive
                  ) l WHERE l.user_id=u.id AND l.direction='out' AND l.event_type='granted' ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS last_exit,
                  (SELECT COUNT(*) FROM (
                    SELECT user_id FROM access_logs UNION ALL SELECT user_id FROM access_log_archive
                  ) l WHERE l.user_id=u.id) AS total_events
                FROM users u WHERE u.id=?
            """, (user_id,)).fetchone()
            if not row:
                return None
            user = self._row_user(row, include_photo=True)
            user["photo_data_url"] = self._photo_data_url(user.pop("photo_blob", None))
            user["profile_photo_data_url"] = self._photo_data_url(user.pop("profile_photo_blob", None))
            observation_raw = self._decrypt(row["face_observation"])
            if observation_raw:
                try:
                    user["face_appearance"] = json.loads(observation_raw.decode("utf-8"))
                except (ValueError, TypeError, UnicodeDecodeError):
                    user["face_appearance"] = None
            else:
                user["face_appearance"] = None
            user.pop("face_embedding", None)
            user.pop("face_profile_embedding", None)
            user.pop("face_vector", None)
            user.pop("face_profile_vector", None)
            user.pop("pin_hash", None)
            user.pop("fingerprint_hash", None)
            if include_logs:
                logs = conn.execute(
                    """SELECT * FROM (
                         SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_logs
                         UNION ALL SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_log_archive
                       ) WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100""",
                    (user_id,),
                ).fetchall()
                user["logs"] = [dict(item) for item in logs]
            return user

    def update_user(self, user_id: int, changes: Dict[str, Any]) -> bool:
        allowed = {"nfc_uid", "name", "position", "pin_hash", "is_active", "photo_data_url"}
        values = {key: value for key, value in changes.items() if key in allowed}
        if "photo_data_url" in values:
            values["photo_blob"] = self._photo_blob(values.pop("photo_data_url"))
        if not values:
            return self.get_user(user_id, include_logs=False) is not None
        values["updated_at"] = datetime.now(timezone.utc).isoformat()
        assignments = ", ".join(f"{key}=?" for key in values)
        with self._get_conn() as conn:
            # nosec B608: assignments are composed exclusively from the static allowlist above; values remain bound parameters.
            cur = conn.execute(f"UPDATE users SET {assignments} WHERE id=?", (*values.values(), user_id))
            return cur.rowcount > 0

    def delete_user(self, user_id: int, hard: bool = False) -> bool:
        with self._get_conn() as conn:
            exists = conn.execute("SELECT id,nfc_uid FROM users WHERE id=?", (user_id,)).fetchone()
            if not exists:
                return False
            if hard:
                # Keep the historical access event, but detach/anonymize its
                # personal identity before deleting the employee row. Consent
                # records and lockout state are removed with the biometric profile.
                conn.execute(
                    "UPDATE access_logs SET user_id=NULL,nfc_uid='DELETED' WHERE user_id=?",
                    (user_id,),
                )
                conn.execute(
                    "UPDATE access_log_archive SET user_id=NULL,nfc_uid='DELETED' WHERE user_id=?",
                    (user_id,),
                )
                conn.execute("DELETE FROM biometric_consents WHERE user_id=?", (user_id,))
                conn.execute("DELETE FROM access_security_state WHERE subject_key=?",
                             (str(exists["nfc_uid"]),))
                cur = conn.execute("DELETE FROM users WHERE id=?", (user_id,))
            else:
                now = datetime.now(timezone.utc).isoformat()
                conn.execute("UPDATE biometric_consents SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", (now, user_id))
                cur = conn.execute(
                    """UPDATE users SET is_active=0,deleted_at=?,updated_at=?,
                       face_embedding=NULL,face_profile_embedding=NULL,face_vector=NULL,
                       face_profile_vector=NULL,face_observation=NULL,
                       photo_blob=NULL,profile_photo_blob=NULL
                       WHERE id=?""",
                    (now, now, user_id),
                )
            return cur.rowcount > 0


    @staticmethod
    def _guest_hash(code: str) -> str:
        return hashlib.sha256(code.strip().upper().encode()).hexdigest()

    def create_guest_pass(self, label: str, valid_hours: float, max_uses: int, door_ids: List[str]) -> Dict[str, Any]:
        code = secrets.token_urlsafe(16).upper()[:20]
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=valid_hours)
        with self._get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO guest_passes(code_hash,code_prefix,label,expires_at,max_uses,uses,door_ids,status,created_at) VALUES(?,?,?,?,?,0,?,'active',?)",
                (self._guest_hash(code), code[-4:], label, expires.isoformat(), max_uses, json.dumps(door_ids or ["main"]), now.isoformat()),
            )
            pass_id = int(cur.lastrowid)
        return {"id": pass_id, "code": code, "label": label, "expires_at": expires.isoformat(), "max_uses": max_uses, "uses": 0, "door_ids": door_ids or ["main"], "status": "active", "created_at": now.isoformat()}

    def archive_expired_guest_passes(self) -> int:
        """Archive expired or fully used guest passes, preserving an audit copy."""
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO guest_pass_archive
                   (id,code_hash,code_prefix,label,expires_at,max_uses,uses,door_ids,status,
                    created_at,updated_at,archived_at,archive_reason)
                   SELECT id,code_hash,code_prefix,label,expires_at,max_uses,uses,door_ids,status,
                          created_at,updated_at,?,CASE
                            WHEN uses >= max_uses THEN 'uses_exhausted'
                            ELSE 'expired'
                          END
                   FROM guest_passes
                   WHERE expires_at <= ? OR uses >= max_uses""",
                (now_iso, now_iso),
            )
            archived = conn.execute(
                "SELECT COUNT(*) AS n FROM guest_passes WHERE expires_at <= ? OR uses >= max_uses",
                (now_iso,),
            ).fetchone()["n"]
            conn.execute(
                "DELETE FROM guest_passes WHERE expires_at <= ? OR uses >= max_uses",
                (now_iso,),
            )
            return int(archived)

    def list_guest_passes(self) -> List[Dict[str, Any]]:
        self.archive_expired_guest_passes()
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM guest_passes ORDER BY id DESC").fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["door_ids"] = json.loads(item["door_ids"] or '["main"]')
            expires = datetime.fromisoformat(item["expires_at"])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            remaining = max(0, int((expires - now).total_seconds()))
            item["remaining_seconds"] = remaining
            item["remaining_human"] = self._format_guest_remaining(remaining)
            item["active"] = item["status"] == "active" and remaining > 0 and item["uses"] < item["max_uses"]
            item.pop("code_hash", None)
            out.append(item)
        return out

    @staticmethod
    def _format_guest_remaining(seconds: int) -> str:
        if seconds <= 0:
            return "Срок истёк"
        days, remainder = divmod(seconds, 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes, _ = divmod(remainder, 60)
        if days:
            return f"{days} дн. {hours} ч. {minutes} мин."
        if hours:
            return f"{hours} ч. {minutes} мин."
        return f"{minutes} мин."

    def list_guest_pass_archive(self) -> List[Dict[str, Any]]:
        self.archive_expired_guest_passes()
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM guest_pass_archive ORDER BY archived_at DESC,id DESC"
            ).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item["door_ids"] = json.loads(item["door_ids"] or '["main"]')
            item.pop("code_hash", None)
            out.append(item)
        return out

    def get_guest_pass_archive_days(self) -> List[Dict[str, Any]]:
        self.archive_expired_guest_passes()
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT date(archived_at,'localtime') AS day,COUNT(*) AS passes
                   FROM guest_pass_archive
                   GROUP BY date(archived_at,'localtime') ORDER BY day DESC"""
            ).fetchall()
        return [dict(row) for row in rows]

    def get_guest_pass_by_code(self, code: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM guest_passes WHERE code_hash=?", (self._guest_hash(code),)).fetchone()
        if not row:
            return None
        item = dict(row)
        item["door_ids"] = json.loads(item["door_ids"] or '["main"]')
        return item

    def consume_guest_pass(self, pass_id: int) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("UPDATE guest_passes SET uses=uses+1,updated_at=? WHERE id=? AND status='active' AND expires_at>? AND uses<max_uses",
                               (datetime.now(timezone.utc).isoformat(), pass_id, datetime.now(timezone.utc).isoformat()))
            return cur.rowcount > 0

    def update_guest_pass(self, pass_id: int, action: str, hours: float = 0) -> bool:
        now = datetime.now(timezone.utc)
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM guest_passes WHERE id=?", (pass_id,)).fetchone()
            if not row:
                return False
            if action == "delete":
                cur = conn.execute("DELETE FROM guest_passes WHERE id=?", (pass_id,))
                return cur.rowcount > 0
            if action == "close":
                status, uses, expires = "closed", row["uses"], row["expires_at"]
            elif action == "block":
                status, uses, expires = "blocked", row["uses"], row["expires_at"]
            elif action == "restore":
                status, uses, expires = "active", row["uses"], row["expires_at"]
            elif action == "reset":
                status, uses, expires = "active", 0, row["expires_at"]
            elif action == "extend":
                current = datetime.fromisoformat(row["expires_at"])
                base = max(current, now)
                status, uses, expires = "active", row["uses"], (base + timedelta(hours=max(0.1, hours))).isoformat()
            else:
                raise ValueError("Unknown guest pass action")
            cur = conn.execute("UPDATE guest_passes SET status=?,uses=?,expires_at=?,updated_at=? WHERE id=?",
                               (status, uses, expires, now.isoformat(), pass_id))
            return cur.rowcount > 0

    def record_biometric_consent(self, user_id: int, admin_id: int, purpose: str = "Регистрация биометрического шаблона") -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                "INSERT INTO biometric_consents(user_id,admin_id,purpose,consent_at) VALUES(?,?,?,?)",
                (user_id, admin_id, purpose, now),
            )

    def has_biometric_consent(self, user_id: int) -> bool:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM biometric_consents WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            return row is not None

    def save_face_profile(self, user_id: int, front_landmarks: List[List[float]],
                          profile_landmarks: List[List[float]], front_photo: str,
                          profile_photo: str, glasses: str = "unknown",
                          mask: str = "unknown", face_shape: str = "unknown") -> None:
        # Full normalized MediaPipe mesh is stored encrypted as supplemental geometry.
        # SFace vectors remain the actual identity templates; appearance flags are operator observations.
        if glasses not in {"with", "without", "unknown"} or mask not in {"with", "without", "unknown"}:
            raise ValueError("Недопустимые признаки внешнего вида биометрического профиля.")
        photo = self._photo_blob(front_photo)
        profile_photo_blob = self._photo_blob(profile_photo)
        front_mesh = self._encrypt(json.dumps(front_landmarks, separators=(",", ":")).encode("utf-8"))
        profile_mesh = self._encrypt(json.dumps(profile_landmarks, separators=(",", ":")).encode("utf-8"))
        observation = self._encrypt(json.dumps({
            "glasses": glasses, "mask": mask, "face_shape": face_shape,
            "landmark_model": "MediaPipe Face Landmarker · 478 points",
            "landmark_regions": ["face_outline", "eyes", "nose", "mouth", "facial_contour"],
            "landmark_indices": {
                "left_eye": [33, 133, 159, 145],
                "right_eye": [362, 263, 386, 374],
                "nose": [168, 6, 197, 5, 4, 1, 2],
                "mouth": [61, 291, 0, 17],
                "left_ear_side_anchor": [234],
                "right_ear_side_anchor": [454],
            },
            "ear_note": "Face mesh provides lateral contour anchors, not anatomical ear landmarks.",
            "observation_source": "operator_confirmed",
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        with self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE users SET face_embedding=?,face_profile_embedding=?,face_observation=?,photo_blob=COALESCE(?,photo_blob),profile_photo_blob=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
                (front_mesh, profile_mesh, observation, photo, profile_photo_blob, datetime.now(timezone.utc).isoformat(), user_id),
            )
            if cur.rowcount != 1:
                raise ValueError("Профиль сотрудника не найден или уже удалён. Биометрия не сохранена.")


    def save_face_vectors(self, user_id: int, front_vector: List[float], profile_vector: List[float]) -> None:
        if len(front_vector) != 128 or len(profile_vector) != 128:
            raise ValueError("Ожидаются два биометрических вектора размерностью 128.")
        front = self._encrypt(json.dumps(front_vector, separators=(",", ":")).encode())
        profile = self._encrypt(json.dumps(profile_vector, separators=(",", ":")).encode())
        with self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE users SET face_vector=?,face_profile_vector=?,updated_at=? WHERE id=? AND deleted_at IS NULL",
                (front, profile, datetime.now(timezone.utc).isoformat(), user_id),
            )
            if cur.rowcount != 1:
                raise ValueError("Профиль сотрудника не найден или уже удалён. Биометрия не сохранена.")

    def list_face_vectors(self) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT id,name,position,photo_blob,profile_photo_blob,face_vector,face_profile_vector FROM users WHERE is_active=1 AND deleted_at IS NULL AND face_vector IS NOT NULL"
            ).fetchall()
        result = []
        for row in rows:
            front_raw = self._decrypt(row["face_vector"])
            profile_raw = self._decrypt(row["face_profile_vector"])
            if not front_raw:
                continue
            try:
                front = json.loads(front_raw.decode("utf-8"))
                profile = json.loads(profile_raw.decode("utf-8")) if profile_raw else []
                if len(front) != 128 or (profile and len(profile) != 128):
                    continue
                result.append({
                    "user_id": int(row["id"]), "name": row["name"] or "Без имени",
                    "position": row["position"] or "", "front_vector": front,
                    "profile_vector": profile,
                    "photo_data_url": self._photo_data_url(row["photo_blob"] or row["profile_photo_blob"]),
                })
            except (ValueError, TypeError, UnicodeDecodeError):
                continue
        return result

    def find_similar_face_vectors(self, user_id: int, front_vector: List[float], profile_vector: List[float], limit: int = 5) -> List[Dict[str, Any]]:
        from app.services.face_recognition_service import face_recognition_service
        candidates = []
        for item in self.list_face_vectors():
            if item["user_id"] == user_id:
                continue
            scores = [face_recognition_service.cosine_similarity(front_vector, item["front_vector"])]
            if profile_vector:
                scores.append(face_recognition_service.cosine_similarity(profile_vector, item["front_vector"]))
            if item["profile_vector"]:
                scores.append(face_recognition_service.cosine_similarity(front_vector, item["profile_vector"]))
                if profile_vector:
                    scores.append(face_recognition_service.cosine_similarity(profile_vector, item["profile_vector"]))
            score = max(scores)
            candidates.append({"user_id": item["user_id"], "name": item["name"], "similarity": round(max(0.0, score) * 100, 1)})
        candidates.sort(key=lambda item: item["similarity"], reverse=True)
        return candidates[:limit]

    def find_similar_faces(self, user_id: int, landmarks: List[List[float]], limit: int = 5) -> List[Dict[str, Any]]:
        target = [v for point in landmarks for v in point[:3]]
        candidates = []
        with self._get_conn() as conn:
            rows = conn.execute("SELECT id,name,face_embedding FROM users WHERE id<>? AND face_embedding IS NOT NULL AND is_active=1", (user_id,)).fetchall()
        for row in rows:
            raw = self._decrypt(row["face_embedding"])
            if not raw:
                continue
            try:
                stored = json.loads(raw.decode())
                vector = [v for point in stored for v in point[:3]]
                if len(vector) != len(target) or not vector:
                    continue
                rmse = math.sqrt(sum((a-b)**2 for a,b in zip(target, vector)) / len(vector))
                similarity = max(0.0, min(100.0, 100.0 - rmse * 100.0))
                candidates.append({"user_id": row["id"], "name": row["name"] or "Без имени", "similarity": round(similarity, 1)})
            except Exception:
                continue
        candidates.sort(key=lambda item: item["similarity"], reverse=True)
        return candidates[:limit]

    def get_access_lockout(self, subject_key: str) -> Optional[str]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT locked_until FROM access_security_state WHERE subject_key=?",
                (subject_key,),
            ).fetchone()
            return row["locked_until"] if row else None

    def record_access_failure(self, subject_key: str, now: datetime,
                              window_seconds: int, threshold: int,
                              lock_seconds: int) -> tuple[int, Optional[str]]:
        now = now.astimezone(timezone.utc)
        now_s = now.isoformat()
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT failures,window_started_at FROM access_security_state WHERE subject_key=?",
                (subject_key,),
            ).fetchone()
            within_window = False
            if row:
                try:
                    started = datetime.fromisoformat(row["window_started_at"])
                    within_window = (now - started).total_seconds() < window_seconds
                except (TypeError, ValueError):
                    within_window = False
            failures = (int(row["failures"]) if row and within_window else 0) + 1
            started_at = row["window_started_at"] if row and within_window else now_s
            locked_until = (now + timedelta(seconds=lock_seconds)).isoformat() if failures >= threshold else None
            conn.execute(
                """INSERT INTO access_security_state(subject_key,failures,window_started_at,locked_until)
                   VALUES(?,?,?,?) ON CONFLICT(subject_key) DO UPDATE SET
                   failures=excluded.failures,window_started_at=excluded.window_started_at,
                   locked_until=excluded.locked_until""",
                (subject_key, failures, started_at, locked_until),
            )
            return failures, locked_until

    def clear_access_failures(self, subject_key: str) -> None:
        with self._get_conn() as conn:
            conn.execute("DELETE FROM access_security_state WHERE subject_key=?", (subject_key,))

    def get_last_granted_direction(self, user_id: int, door_id: str) -> Optional[str]:
        with self._get_conn() as conn:
            row = conn.execute(
                """SELECT direction FROM (
                     SELECT direction,created_at,id,user_id,door_id,event_type FROM access_logs
                     UNION ALL SELECT direction,created_at,id,user_id,door_id,event_type FROM access_log_archive
                   )
                   WHERE user_id=? AND door_id=? AND event_type='granted'
                     AND direction IN ('in','out')
                   ORDER BY created_at DESC,id DESC LIMIT 1""",
                (user_id, door_id),
            ).fetchone()
            return row["direction"] if row else None

    def log_access(self, nfc_uid: str, event_type: str, factor_used: str = None,
                   reason: str = None, user_id: int = None, direction: str = None,
                   door_id: str = None) -> int:
        now = datetime.now(timezone.utc).isoformat()
        # Write the independently chained audit record first. If it cannot be
        # durably appended, do not report or persist a successful access event.
        audit_journal.append(
            "access.event",
            target=str(user_id if user_id is not None else nfc_uid or "unknown"),
            details={
                "event_type": event_type, "factor": factor_used, "reason": reason,
                "direction": direction, "door_id": door_id, "timestamp": now,
            },
        )
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO access_logs (nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (nfc_uid, user_id, event_type, factor_used, reason, direction, door_id, now),
            )
            return int(cur.lastrowid)

    def archive_previous_days(self) -> int:
        """Move completed local calendar days to an archive table without discarding history."""
        today = datetime.now().date().isoformat()
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO access_log_archive
                   (id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at,archived_at)
                   SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at,?
                   FROM access_logs WHERE date(created_at,'localtime') < ?""",
                (now, today),
            )
            archived = conn.execute("SELECT COUNT(*) AS n FROM access_logs WHERE date(created_at,'localtime') < ?", (today,)).fetchone()["n"]
            conn.execute("DELETE FROM access_logs WHERE date(created_at,'localtime') < ?", (today,))
            return int(archived)

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        self.archive_previous_days()
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT l.*,u.name AS user_name FROM (
                     SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_logs
                     UNION ALL
                     SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_log_archive
                   ) l LEFT JOIN users u ON u.id=l.user_id
                   ORDER BY l.created_at DESC,l.id DESC LIMIT ?""", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def get_log_days(self) -> List[Dict[str, Any]]:
        self.archive_previous_days()
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT date(created_at,'localtime') AS day, COUNT(*) AS events,
                          SUM(CASE WHEN event_type='granted' THEN 1 ELSE 0 END) AS granted,
                          SUM(CASE WHEN event_type NOT IN ('granted','simulated') THEN 1 ELSE 0 END) AS denied
                   FROM (
                     SELECT created_at,event_type FROM access_logs
                     UNION ALL SELECT created_at,event_type FROM access_log_archive
                   ) GROUP BY date(created_at,'localtime') ORDER BY day DESC"""
            ).fetchall()
            return [dict(row) for row in rows]

    def get_logs_for_date(self, day: str) -> List[Dict[str, Any]]:
        self.archive_previous_days()
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT l.*,u.name AS user_name FROM (
                     SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_logs
                     UNION ALL SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_log_archive
                   ) l LEFT JOIN users u ON u.id=l.user_id
                   WHERE date(l.created_at,'localtime')=? ORDER BY l.created_at DESC,l.id DESC""", (day,)
            ).fetchall()
            return [dict(row) for row in rows]

    def get_daily_log_peaks(self, day: str) -> List[Dict[str, Any]]:
        logs = self.get_logs_for_date(day)
        groups: Dict[tuple, List[Dict[str, Any]]] = {}
        for item in logs:
            key = (item.get("user_id"), item.get("nfc_uid") or "", item.get("factor_used") or "", item.get("direction") or "")
            groups.setdefault(key, []).append(item)
        result = []
        for items in groups.values():
            chronological = sorted(items, key=lambda item: item.get("created_at") or "")
            latest = chronological[-1]
            result.append({
                **latest,
                "first_peak_at": chronological[0].get("created_at"),
                "repeat_peak_at": chronological[1].get("created_at") if len(chronological) > 1 else None,
                "attempts": len(chronological),
            })
        return sorted(result, key=lambda item: item.get("created_at") or "", reverse=True)



    def record_pad_trial(self, trial_class: str, attack_type: str, accepted: bool, failure_reason: str | None = None, test_condition: str = "", camera_label: str = "") -> int:
        if trial_class not in {"bona_fide", "attack"}:
            raise ValueError("Недопустимый класс PAD испытания.")
        if trial_class == "attack" and not attack_type:
            raise ValueError("Для attack испытания требуется тип атаки.")
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO pad_trials (trial_class,attack_type,accepted,failure_reason,test_condition,camera_label,created_at) VALUES (?,?,?,?,?,?,?)",
                (trial_class, attack_type if trial_class == "attack" else "", int(accepted), (failure_reason or "")[:200], (test_condition or "")[:120], (camera_label or "")[:80], now),
            )
            return int(cur.lastrowid)

    def get_pad_trials(self, limit: int = 1000) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT trial_class AS class,attack_type,accepted,failure_reason,test_condition,camera_label,created_at FROM pad_trials ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [
                {**dict(row), "accepted": bool(row["accepted"])}
                for row in rows
            ]

    def upsert_security_incident(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        evidence_json = json.dumps(incident.get("evidence", {}), ensure_ascii=False, sort_keys=True)
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO security_incidents
                   (dedupe_key,subject_ref,title,summary,severity,risk_score,evidence_json,
                    first_seen,last_seen,occurrences,status,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,1,'open',?)
                   ON CONFLICT(dedupe_key) DO UPDATE SET
                     title=excluded.title,
                     summary=excluded.summary,
                     severity=excluded.severity,
                     risk_score=excluded.risk_score,
                     evidence_json=excluded.evidence_json,
                     last_seen=excluded.last_seen,
                     occurrences=CASE WHEN excluded.last_seen > security_incidents.last_seen THEN security_incidents.occurrences+1 ELSE security_incidents.occurrences END,
                     status=CASE WHEN excluded.last_seen > security_incidents.last_seen AND security_incidents.status!='open' THEN 'open' ELSE security_incidents.status END,
                     updated_at=excluded.updated_at""",
                (
                    incident["dedupe_key"], incident.get("subject_ref"), incident["title"],
                    incident["summary"], incident["severity"], int(incident["risk_score"]),
                    evidence_json, incident["first_seen"], incident["last_seen"], now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM security_incidents WHERE dedupe_key=?",
                (incident["dedupe_key"],),
            ).fetchone()
            return dict(row) if row else {}



    def update_security_incident_status(self, incident_id: int, status: str) -> Dict[str, Any] | None:
        if status not in {"open", "resolved", "dismissed"}:
            raise ValueError("Недопустимый статус инцидента.")
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE security_incidents SET status=?,updated_at=? WHERE id=?",
                (status, now, incident_id),
            )
            row = conn.execute(
                "SELECT * FROM security_incidents WHERE id=?",
                (incident_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            try:
                item["evidence"] = json.loads(item.pop("evidence_json"))
            except (TypeError, ValueError):
                item["evidence"] = {}
            return item

    def get_security_incident(self, incident_id: int) -> Dict[str, Any] | None:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM security_incidents WHERE id=?",
                (incident_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            try:
                item["evidence"] = json.loads(item.pop("evidence_json"))
            except (TypeError, ValueError):
                item["evidence"] = {}
            return item

    def get_security_incidents(self, limit: int = 100, status: str | None = None) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM security_incidents WHERE status=? ORDER BY risk_score DESC,last_seen DESC LIMIT ?",
                    (status, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM security_incidents ORDER BY risk_score DESC,last_seen DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            result = []
            for row in rows:
                item = dict(row)
                try:
                    item["evidence"] = json.loads(item.pop("evidence_json"))
                except (TypeError, ValueError):
                    item["evidence"] = {}
                result.append(item)
            return result

    def add_ai_alert(self, alert_type: str, message: str, severity: str = "medium", related_log_ids: str = None) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO ai_alerts (alert_type,message,severity,related_log_ids,created_at) VALUES (?,?,?,?,?)",
                (alert_type, message, severity, related_log_ids, now),
            )
            return int(cur.lastrowid)

    def get_recent_alerts(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM ai_alerts WHERE is_resolved=0 ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [dict(row) for row in rows]


db_service = DBService()
