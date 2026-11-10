"""Persistent administrator authentication for the local LESS control plane."""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from app.config import settings


class AdminAuthService:
    SESSION_HOURS = 8
    MAX_FAILURES = 5
    LOCK_MINUTES = 15
    FAILURE_WINDOW_MINUTES = 30

    def __init__(self) -> None:
        self.ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
        self._init_db()

    def _conn(self):
        conn = sqlite3.connect(settings.DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS admin_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('superadmin','admin','security')),
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(admin_id) REFERENCES admin_accounts(id)
                );
                CREATE TABLE IF NOT EXISTS admin_login_attempts (
                    username TEXT PRIMARY KEY COLLATE NOCASE,
                    failures INTEGER NOT NULL DEFAULT 0,
                    window_started_at TEXT NOT NULL,
                    locked_until TEXT
                );
                CREATE TABLE IF NOT EXISTS admin_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id INTEGER,
                    action TEXT NOT NULL,
                    target TEXT,
                    details TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(admin_id) REFERENCES admin_accounts(id)
                );
            """)

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _iso(value: datetime) -> str:
        return value.isoformat()

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _public(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        return {"id": row["id"], "username": row["username"], "display_name": row["display_name"],
                "role": row["role"], "is_active": bool(row["is_active"]), "created_at": row["created_at"]}

    def bootstrap_status(self) -> dict[str, Any]:
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM admin_accounts").fetchone()[0]
        return {"initialized": count > 0, "admin_count": count}

    def create_admin(self, username: str, password: str, display_name: str, role: str = "superadmin") -> dict[str, Any]:
        username, display_name = username.strip(), display_name.strip() or username.strip()
        if len(username) < 3 or len(username) > 64:
            raise ValueError("Логин должен содержать от 3 до 64 символов.")
        if len(password) < 12 or len(password) > 256:
            raise ValueError("Пароль должен содержать от 12 до 256 символов.")
        if role not in {"superadmin", "admin", "security"}:
            raise ValueError("Недопустимая роль.")
        now = self._iso(self._now())
        with self._conn() as conn:
            cur = conn.execute("INSERT INTO admin_accounts(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                               (username, display_name, self.ph.hash(password), role, now))
            row = conn.execute("SELECT * FROM admin_accounts WHERE id=?", (cur.lastrowid,)).fetchone()
            return self._public(row)

    def bootstrap(self, username: str, password: str, display_name: str) -> dict[str, Any]:
        # BEGIN IMMEDIATE makes the first-admin operation atomic across concurrent requests.
        conn = self._conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            count = conn.execute("SELECT COUNT(*) FROM admin_accounts").fetchone()[0]
            if count:
                raise PermissionError("Первичная настройка уже выполнена.")
            username = username.strip()
            if len(username) < 3 or len(username) > 64 or len(password) < 12 or len(password) > 256:
                raise ValueError("Логин должен содержать от 3 символов, пароль — от 12 до 256 символов.")
            now = self._iso(self._now())
            cur = conn.execute(
                "INSERT INTO admin_accounts(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                (username, display_name.strip() or username, self.ph.hash(password), "superadmin", now),
            )
            row = conn.execute("SELECT * FROM admin_accounts WHERE id=?", (cur.lastrowid,)).fetchone()
            user = self._public(row)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        self.audit(user["id"], "bootstrap.created", user["username"], "Создан первый суперадминистратор")
        return user

    def login(self, username: str, password: str, remember_me: bool = False) -> Optional[dict[str, Any]]:
        username, now = username.strip(), self._now()
        now_s = self._iso(now)
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM admin_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL",
                (now_s,),
            )
            attempt = conn.execute("SELECT * FROM admin_login_attempts WHERE username=?", (username,)).fetchone()
            if attempt and attempt["locked_until"] and attempt["locked_until"] > now_s:
                return None
            row = conn.execute("SELECT * FROM admin_accounts WHERE username=? COLLATE NOCASE AND is_active=1", (username,)).fetchone()
            valid = False
            if row:
                try:
                    valid = self.ph.verify(row["password_hash"], password)
                except (VerifyMismatchError, VerificationError, ValueError):
                    valid = False
            if not valid:
                within_window = bool(attempt and (now - datetime.fromisoformat(attempt["window_started_at"])).total_seconds() < self.FAILURE_WINDOW_MINUTES * 60)
                failures = (attempt["failures"] if within_window else 0) + 1
                started = attempt["window_started_at"] if within_window else now_s
                locked_until = self._iso(now + timedelta(minutes=self.LOCK_MINUTES)) if failures >= self.MAX_FAILURES else None
                conn.execute(
                    """INSERT INTO admin_login_attempts(username,failures,window_started_at,locked_until)
                       VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,
                       window_started_at=excluded.window_started_at,locked_until=excluded.locked_until""",
                    (username, failures, started, locked_until),
                )
                return None
            conn.execute("DELETE FROM admin_login_attempts WHERE username=?", (username,))
            token = secrets.token_urlsafe(48)
            expires = now + (timedelta(hours=1) if remember_me else timedelta(hours=self.SESSION_HOURS))
            conn.execute("INSERT INTO admin_sessions(admin_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)",
                         (row["id"], self._token_hash(token), now_s, self._iso(expires)))
            user = self._public(row)
        self.audit(user["id"], "auth.login", user["username"], "Вход администратора")
        return {"access_token": token, "token_type": "bearer", "expires_at": self._iso(expires), "user": user}

    def authenticate(self, token: str) -> Optional[dict[str, Any]]:
        if not token:
            return None
        with self._conn() as conn:
            row = conn.execute("""
                SELECT a.*, s.expires_at FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id
                WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.is_active=1
            """, (self._token_hash(token), self._iso(self._now()))).fetchone()
            if not row:
                return None
            user = self._public(row)
            user["session_expires_at"] = row["expires_at"]
            return user

    def logout(self, token: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE admin_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
                         (self._iso(self._now()), self._token_hash(token)))

    def audit(self, admin_id: Optional[int], action: str, target: str = "", details: str = "") -> None:
        with self._conn() as conn:
            conn.execute("INSERT INTO admin_audit(admin_id,action,target,details,created_at) VALUES(?,?,?,?,?)",
                         (admin_id, action, target, details, self._iso(self._now())))

    def get_audit(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT e.id,e.admin_id,a.username,e.action,e.target,e.details,e.created_at
                FROM admin_audit e LEFT JOIN admin_accounts a ON a.id=e.admin_id
                ORDER BY e.id DESC LIMIT ?
            """, (limit,)).fetchall()
            return [dict(row) for row in rows]

    def list_admins(self) -> list[dict[str, Any]]:
        with self._conn() as conn:
            return [self._public(row) for row in conn.execute("SELECT * FROM admin_accounts ORDER BY created_at").fetchall()]

    def create_managed_admin(self, username: str, password: str, display_name: str, role: str, actor: dict[str, Any]) -> dict[str, Any]:
        user = self.create_admin(username, password, display_name, role)
        self.audit(actor["id"], "admin.created", user["username"], f"role={role}")
        return user

    def set_admin_active(self, admin_id: int, active: bool, actor: dict[str, Any]) -> bool:
        now = self._iso(self._now())
        with self._conn() as conn:
            cur = conn.execute("UPDATE admin_accounts SET is_active=?,updated_at=? WHERE id=?", (int(active), now, admin_id))
            if cur.rowcount:
                conn.execute("UPDATE admin_sessions SET revoked_at=? WHERE admin_id=? AND revoked_at IS NULL", (now, admin_id))
            changed = cur.rowcount > 0
        if changed:
            self.audit(actor["id"], "admin.activated" if active else "admin.disabled", str(admin_id))
        return changed


admin_auth_service = AdminAuthService()
