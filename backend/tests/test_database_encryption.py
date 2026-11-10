from __future__ import annotations

import sqlite3 as stdlib_sqlite3
import tempfile
import unittest
from pathlib import Path

from app.config import settings
from app.services.database import SQLITE_HEADER, connect_encrypted, ensure_encrypted_database


class SQLCipherMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "legacy.db"
        self.previous_key = settings.SECRET_KEY
        settings.SECRET_KEY = "0123456789abcdef" * 4

    def tearDown(self):
        settings.SECRET_KEY = self.previous_key
        self.temp_dir.cleanup()

    def test_plaintext_database_is_migrated_and_preserved(self):
        with stdlib_sqlite3.connect(self.db_path) as conn:
            conn.execute("CREATE TABLE private_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            conn.execute("INSERT INTO private_records(value) VALUES (?)", ("employee-private-data",))

        ensure_encrypted_database(self.db_path, settings.SECRET_KEY)

        with self.db_path.open("rb") as stream:
            self.assertNotEqual(stream.read(len(SQLITE_HEADER)), SQLITE_HEADER)

        with connect_encrypted(self.db_path) as conn:
            self.assertEqual(
                conn.execute("SELECT value FROM private_records").fetchone()[0],
                "employee-private-data",
            )
        with self.assertRaises(Exception):
            conn.execute("SELECT 1")

        backups = list(Path(self.temp_dir.name).glob("legacy.db.pre-encryption-*.sqlcipher"))
        self.assertEqual(len(backups), 1)
        with connect_encrypted(backups[0]) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM private_records").fetchone()[0], 1)

        with stdlib_sqlite3.connect(self.db_path) as conn:
            with self.assertRaises(stdlib_sqlite3.DatabaseError):
                conn.execute("SELECT * FROM private_records").fetchall()

    def test_wrong_key_fails_closed_without_replacing_database(self):
        with stdlib_sqlite3.connect(self.db_path) as conn:
            conn.execute("CREATE TABLE private_records (value TEXT)")
            conn.execute("INSERT INTO private_records VALUES ('keep-me')")

        ensure_encrypted_database(self.db_path, settings.SECRET_KEY)
        encrypted_bytes = self.db_path.read_bytes()
        settings.SECRET_KEY = "fedcba9876543210" * 4

        with self.assertRaises(RuntimeError):
            ensure_encrypted_database(self.db_path, settings.SECRET_KEY)

        self.assertEqual(self.db_path.read_bytes(), encrypted_bytes)


if __name__ == "__main__":
    unittest.main()
