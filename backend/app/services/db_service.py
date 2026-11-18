"""
Сервис работы с БД (SQLite).
"""

from loguru import logger
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import json
import sqlite3
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
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nfc_uid TEXT UNIQUE NOT NULL,
                    name TEXT,
                    position TEXT,
                    pin_hash TEXT,
                    fingerprint_hash TEXT,
                    face_embedding TEXT,
                    face_enrolled INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    last_entry TEXT,
                    last_exit TEXT
                );

                CREATE TABLE IF NOT EXISTS access_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nfc_uid TEXT,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,
                    factor_used TEXT,
                    reason TEXT,
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
                """
            )
            # Lightweight migrations for older DBs
            cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
            if "position" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN position TEXT")
            if "face_enrolled" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN face_enrolled INTEGER DEFAULT 0")
            if "last_entry" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN last_entry TEXT")
            if "last_exit" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN last_exit TEXT")
            # face_embedding may be BLOB in old schema — leave as-is; new writes use TEXT JSON
        logger.info(f"БД инициализирована: {self.db_path}")

    def add_user(
        self,
        nfc_uid: str,
        name: str = "",
        pin_hash: str = None,
        fingerprint_hash: str = None,
        position: str = "",
        is_active: bool = True,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO users
                   (nfc_uid, name, position, pin_hash, fingerprint_hash, is_active, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (nfc_uid, name, position, pin_hash, fingerprint_hash, 1 if is_active else 0, now),
            )
            return cur.lastrowid

    def list_users(self, include_inactive: bool = True) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            if include_inactive:
                rows = conn.execute("SELECT * FROM users ORDER BY id DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM users WHERE is_active = 1 ORDER BY id DESC"
                ).fetchall()
            return [self._user_row(r) for r in rows]

    def get_user(self, user_id: int, include_logs: bool = True) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None
            user = self._user_row(row)
            if include_logs:
                logs = conn.execute(
                    "SELECT * FROM access_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20",
                    (user_id,),
                ).fetchall()
                user["logs"] = [dict(r) for r in logs]
            return user

    def update_user(self, user_id: int, **fields) -> bool:
        allowed = {
            "name", "position", "nfc_uid", "pin_hash", "is_active",
            "face_enrolled", "last_entry", "last_exit",
        }
        data = {k: v for k, v in fields.items() if k in allowed}
        if not data:
            return False
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        if "is_active" in data:
            data["is_active"] = 1 if data["is_active"] else 0
        cols = ", ".join(f"{k} = ?" for k in data)
        vals = list(data.values()) + [user_id]
        with self._get_conn() as conn:
            cur = conn.execute(f"UPDATE users SET {cols} WHERE id = ?", vals)
            return cur.rowcount > 0

    def delete_user(self, user_id: int, hard: bool = False) -> bool:
        with self._get_conn() as conn:
            if hard:
                cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            else:
                cur = conn.execute(
                    "UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), user_id),
                )
            return cur.rowcount > 0

    def set_face_embedding(self, user_id: int, embedding: list) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(embedding)
        with self._get_conn() as conn:
            cur = conn.execute(
                """UPDATE users
                   SET face_embedding = ?, face_enrolled = 1, updated_at = ?
                   WHERE id = ?""",
                (payload, now, user_id),
            )
            return cur.rowcount > 0

    def get_face_gallery(self) -> List[tuple]:
        """Return list of (user_id, embedding_list) for active enrolled users."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT id, face_embedding FROM users WHERE is_active = 1 AND face_enrolled = 1 AND face_embedding IS NOT NULL"
            ).fetchall()
            gallery = []
            for r in rows:
                try:
                    emb = json.loads(r["face_embedding"])
                    if isinstance(emb, list) and len(emb) == 128:
                        gallery.append((r["id"], emb))
                except Exception:
                    continue
            return gallery

    def get_user_by_nfc(self, nfc_uid: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE nfc_uid = ? AND is_active = 1", (nfc_uid,)
            ).fetchone()
            return self._user_row(row) if row else None

    def log_access(
        self,
        nfc_uid: str,
        event_type: str,
        factor_used: str = None,
        reason: str = None,
        user_id: int = None,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO access_logs
                   (nfc_uid, user_id, event_type, factor_used, reason, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (nfc_uid, user_id, event_type, factor_used, reason, now),
            )
            return cur.lastrowid

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM access_logs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    def add_ai_alert(
        self,
        alert_type: str,
        message: str,
        severity: str = "medium",
        related_log_ids: str = None,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                """INSERT INTO ai_alerts
                   (alert_type, message, severity, related_log_ids, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (alert_type, message, severity, related_log_ids, now),
            )
            return cur.lastrowid

    def get_recent_alerts(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM ai_alerts WHERE is_resolved = 0 ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    def _user_row(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        # Never send raw embedding to UI
        d.pop("face_embedding", None)
        d.pop("pin_hash", None)
        d.pop("fingerprint_hash", None)
        return d


db_service = DBService()
