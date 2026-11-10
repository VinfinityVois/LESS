"""
SQLite service for LESS.
Sensitive face templates and profile photos are encrypted at rest with AES-GCM.
Set a unique SECRET_KEY in the backend environment before using real personal data.
"""
from loguru import logger
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import sqlite3
import base64
import hashlib
import json
import os
import math
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.config import settings


class DBService:
    def __init__(self):
        self.db_path = settings.DB_PATH
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

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
                CREATE TABLE IF NOT EXISTS ai_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_type TEXT NOT NULL,
                    message TEXT,
                    severity TEXT DEFAULT 'medium',
                    related_log_ids TEXT,
                    created_at TEXT NOT NULL,
                    is_resolved INTEGER DEFAULT 0
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
            """)
            self._ensure_column(conn, "users", "position", "TEXT DEFAULT ''")
            self._ensure_column(conn, "users", "face_profile_embedding", "BLOB")
            self._ensure_column(conn, "users", "photo_blob", "BLOB")
            self._ensure_column(conn, "users", "profile_photo_blob", "BLOB")
            self._ensure_column(conn, "users", "deleted_at", "TEXT")
            self._ensure_column(conn, "access_logs", "direction", "TEXT")
            self._ensure_column(conn, "access_logs", "door_id", "TEXT")
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
        user["face_enrolled"] = int(bool(user.get("face_embedding")))
        user["photo_available"] = bool(user.get("photo_blob") or user.get("profile_photo_blob"))
        for private_field in ("face_embedding", "face_profile_embedding", "pin_hash", "fingerprint_hash"):
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
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE nfc_uid=? AND is_active=1 AND deleted_at IS NULL", (nfc_uid,)).fetchone()
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
                  (SELECT created_at FROM access_logs l WHERE l.user_id=u.id AND l.direction='in' AND l.event_type='granted' ORDER BY l.id DESC LIMIT 1) AS last_entry,
                  (SELECT created_at FROM access_logs l WHERE l.user_id=u.id AND l.direction='out' AND l.event_type='granted' ORDER BY l.id DESC LIMIT 1) AS last_exit,
                  (SELECT COUNT(*) FROM access_logs l WHERE l.user_id=u.id) AS total_events
                FROM users u WHERE u.id=?
            """, (user_id,)).fetchone()
            if not row:
                return None
            user = self._row_user(row, include_photo=True)
            user["photo_data_url"] = self._photo_data_url(user.pop("photo_blob", None))
            user["profile_photo_data_url"] = self._photo_data_url(user.pop("profile_photo_blob", None))
            user.pop("face_embedding", None)
            user.pop("face_profile_embedding", None)
            user.pop("pin_hash", None)
            user.pop("fingerprint_hash", None)
            if include_logs:
                logs = conn.execute(
                    "SELECT id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at FROM access_logs WHERE user_id=? ORDER BY id DESC LIMIT 100",
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
            cur = conn.execute(f"UPDATE users SET {assignments} WHERE id=?", (*values.values(), user_id))
            return cur.rowcount > 0

    def delete_user(self, user_id: int, hard: bool = False) -> bool:
        with self._get_conn() as conn:
            if hard:
                cur = conn.execute("DELETE FROM users WHERE id=?", (user_id,))
            else:
                now = datetime.now(timezone.utc).isoformat()
                cur = conn.execute(
                    "UPDATE users SET is_active=0,deleted_at=?,updated_at=? WHERE id=?",
                    (now, now, user_id),
                )
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
                          profile_photo: str) -> None:
        front = self._encrypt(json.dumps(front_landmarks, separators=(",", ":")).encode())
        profile = self._encrypt(json.dumps(profile_landmarks, separators=(",", ":")).encode())
        photo = self._photo_blob(front_photo)
        profile_photo_blob = self._photo_blob(profile_photo)
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE users SET face_embedding=?,face_profile_embedding=?,photo_blob=COALESCE(?,photo_blob),profile_photo_blob=?,updated_at=? WHERE id=?",
                (front, profile, photo, profile_photo_blob, datetime.now(timezone.utc).isoformat(), user_id),
            )

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

    def log_access(self, nfc_uid: str, event_type: str, factor_used: str = None,
                   reason: str = None, user_id: int = None, direction: str = None,
                   door_id: str = None) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO access_logs (nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (nfc_uid, user_id, event_type, factor_used, reason, direction, door_id, now),
            )
            return int(cur.lastrowid)

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM access_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [dict(row) for row in rows]

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
