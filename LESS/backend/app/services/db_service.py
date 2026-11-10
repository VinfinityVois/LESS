"""
Сервис работы с БД.
На первом этапе — обычный SQLite.
Позже можно заменить на SQLCipher.
"""

from loguru import logger
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
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
                    pin_hash TEXT,
                    fingerprint_hash TEXT,
                    face_embedding BLOB,
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS access_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nfc_uid TEXT,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,  -- granted / denied / error
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
        logger.info(f"БД инициализирована: {self.db_path}")

    def add_user(
        self,
        nfc_uid: str,
        name: str = "",
        pin_hash: str = None,
        fingerprint_hash: str = None,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (nfc_uid, name, pin_hash, fingerprint_hash, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (nfc_uid, name, pin_hash, fingerprint_hash, now),
            )
            return cur.lastrowid

    def get_user_by_nfc(self, nfc_uid: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE nfc_uid = ? AND is_active = 1",
                (nfc_uid,),
            ).fetchone()
            return dict(row) if row else None

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
                """
                INSERT INTO access_logs (nfc_uid, user_id, event_type, factor_used, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (nfc_uid, user_id, event_type, factor_used, reason, now),
            )
            return cur.lastrowid

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM access_logs ORDER BY id DESC LIMIT ?",
                (limit,),
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
                """
                INSERT INTO ai_alerts (alert_type, message, severity, related_log_ids, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
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


db_service = DBService()
