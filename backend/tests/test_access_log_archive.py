import sqlite3
import unittest
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone

from app.services.db_service import DBService


class AccessLogArchiveTests(unittest.TestCase):
    def make_service(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript("""
            CREATE TABLE access_logs (
                id INTEGER PRIMARY KEY, nfc_uid TEXT, user_id INTEGER,
                event_type TEXT NOT NULL, factor_used TEXT, reason TEXT,
                direction TEXT, door_id TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE access_log_archive (
                id INTEGER PRIMARY KEY, nfc_uid TEXT, user_id INTEGER,
                event_type TEXT NOT NULL, factor_used TEXT, reason TEXT,
                direction TEXT, door_id TEXT, created_at TEXT NOT NULL,
                archived_at TEXT NOT NULL
            );
        """)
        service = DBService.__new__(DBService)
        service._get_conn = lambda: nullcontext(connection)
        return service, connection

    def test_archive_moves_completed_days_without_losing_event(self):
        service, connection = self.make_service()
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        connection.execute(
            """INSERT INTO access_logs
               (id,nfc_uid,user_id,event_type,factor_used,reason,direction,door_id,created_at)
               VALUES (1,'A1B2',7,'denied','nfc+face','face_unknown','in','main',?)""",
            (yesterday,),
        )

        archived = service.archive_previous_days()

        self.assertEqual(archived, 1)
        self.assertEqual(connection.execute("SELECT COUNT(*) FROM access_logs").fetchone()[0], 0)
        row = connection.execute("SELECT * FROM access_log_archive WHERE id=1").fetchone()
        self.assertEqual(row["nfc_uid"], "A1B2")
        self.assertEqual(row["user_id"], 7)
        self.assertEqual(row["reason"], "face_unknown")

    def test_daily_peaks_keep_first_and_second_attempt_times(self):
        service = DBService.__new__(DBService)
        service.get_logs_for_date = lambda _day: [
            {"id": 3, "user_id": 7, "nfc_uid": "A1B2", "factor_used": "nfc+face",
             "direction": "in", "created_at": "2026-11-11T10:03:00+00:00", "event_type": "denied"},
            {"id": 2, "user_id": 7, "nfc_uid": "A1B2", "factor_used": "nfc+face",
             "direction": "in", "created_at": "2026-11-11T09:15:00+00:00", "event_type": "denied"},
            {"id": 1, "user_id": 7, "nfc_uid": "A1B2", "factor_used": "nfc+face",
             "direction": "in", "created_at": "2026-11-11T08:40:00+00:00", "event_type": "granted"},
        ]

        result = service.get_daily_log_peaks("2026-11-11")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["first_peak_at"], "2026-11-11T08:40:00+00:00")
        self.assertEqual(result[0]["repeat_peak_at"], "2026-11-11T09:15:00+00:00")
        self.assertEqual(result[0]["attempts"], 3)
        self.assertEqual(result[0]["event_type"], "denied")


if __name__ == "__main__":
    unittest.main()
