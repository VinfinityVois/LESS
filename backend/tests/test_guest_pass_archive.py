import sqlite3
import tempfile
import unittest
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import settings

_IMPORT_DB_DIR = tempfile.TemporaryDirectory()
_PREVIOUS_SECRET_KEY = settings.SECRET_KEY
_PREVIOUS_DB_PATH = settings.DB_PATH
_PREVIOUS_DATA_DIR = settings.DATA_DIR
settings.SECRET_KEY = "0123456789abcdef" * 4
settings.DATA_DIR = Path(_IMPORT_DB_DIR.name)
settings.DB_PATH = Path(_IMPORT_DB_DIR.name) / "guest-test-import.db"
from app.services.db_service import DBService
settings.SECRET_KEY = _PREVIOUS_SECRET_KEY
settings.DB_PATH = _PREVIOUS_DB_PATH
settings.DATA_DIR = _PREVIOUS_DATA_DIR


class GuestPassArchiveTests(unittest.TestCase):
    def make_service(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript("""
            CREATE TABLE guest_passes (
                id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL, code_prefix TEXT NOT NULL,
                label TEXT NOT NULL, expires_at TEXT NOT NULL, max_uses INTEGER NOT NULL,
                uses INTEGER NOT NULL, door_ids TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT
            );
            CREATE TABLE guest_pass_archive (
                id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL, code_prefix TEXT NOT NULL,
                label TEXT NOT NULL, expires_at TEXT NOT NULL, max_uses INTEGER NOT NULL,
                uses INTEGER NOT NULL, door_ids TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT, archived_at TEXT NOT NULL,
                archive_reason TEXT NOT NULL
            );
        """)
        service = DBService.__new__(DBService)
        service._get_conn = lambda: nullcontext(connection)
        return service, connection

    def insert_pass(self, connection, pass_id, expires_at, uses=0, max_uses=1, status="active"):
        connection.execute(
            """INSERT INTO guest_passes
               (id,code_hash,code_prefix,label,expires_at,max_uses,uses,door_ids,status,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (pass_id, f"hash-{pass_id}", f"{pass_id:04d}", f"TEST-GUEST-{pass_id:03d}",
             expires_at, max_uses, uses, '["main"]', status, datetime.now(timezone.utc).isoformat()),
        )

    def test_expired_and_exhausted_passes_are_archived(self):
        service, connection = self.make_service()
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        self.insert_pass(connection, 1, past)
        self.insert_pass(connection, 2, future, uses=1, max_uses=1)
        self.insert_pass(connection, 3, future, uses=0, max_uses=2)

        archived = service.archive_expired_guest_passes()

        self.assertEqual(archived, 2)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM guest_passes").fetchone()[0], 1)
        reasons = {row["id"]: row["archive_reason"] for row in connection.execute("SELECT * FROM guest_pass_archive")}
        self.assertEqual(reasons, {1: "expired", 2: "uses_exhausted"})

    def test_active_pass_exposes_exact_remaining_seconds(self):
        service, connection = self.make_service()
        expiry = datetime.now(timezone.utc) + timedelta(minutes=12, seconds=30)
        self.insert_pass(connection, 7, expiry.isoformat(), max_uses=2)
        item = service.list_guest_passes()[0]
        self.assertGreater(item["remaining_seconds"], 700)
        self.assertLessEqual(item["remaining_seconds"], 750)
        self.assertTrue(item["active"])
        self.assertIn("мин.", item["remaining_human"])

    def test_manual_delete_preserves_pass_in_archive(self):
        service, connection = self.make_service()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        self.insert_pass(connection, 9, future, max_uses=3)
        self.assertTrue(service.update_guest_pass(9, "delete"))
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM guest_passes").fetchone()[0], 0)
        row = connection.execute("SELECT * FROM guest_pass_archive WHERE id=9").fetchone()
        self.assertEqual(row["archive_reason"], "manually_deleted")
        self.assertEqual(row["label"], "TEST-GUEST-009")


if __name__ == "__main__":
    unittest.main()
