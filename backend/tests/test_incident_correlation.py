import unittest
import hashlib
from datetime import datetime, timedelta, timezone

from app.services.incident_correlation import IncidentCorrelationEngine


class IncidentCorrelationTests(unittest.TestCase):
    def test_correlates_denials_and_ml_signal_with_explanations(self):
        now = datetime.now(timezone.utc)
        logs = [
            {
                "id": index + 1,
                "nfc_uid": "RAW-UID-001",
                "user_id": None,
                "event_type": "denied",
                "factor_used": "nfc",
                "reason": "policy_denied",
                "door_id": "main",
                "created_at": (now - timedelta(minutes=index)).isoformat(),
            }
            for index in range(5)
        ]
        result = IncidentCorrelationEngine().build_incidents(
            logs,
            {"anomalies": [{
                "subject_ref": "card:" + hashlib.sha256(b"RAW-UID-001").hexdigest()[:12],
                "relative_anomaly_score": 90,
                "model": "IsolationForest",
            }]},
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["risk_score"], 53)
        self.assertEqual(result[0]["severity"], "medium")
        self.assertIn("repeated_denials", str(result[0]["evidence"]["factors"]))
        self.assertIn("ml_anomaly", str(result[0]["evidence"]["factors"]))
        self.assertNotIn("RAW-UID-001", str(result))


    def test_rapid_multi_door_sequence_is_correlated(self):
        now = datetime.now(timezone.utc)
        logs = [
            {
                "id": 21,
                "user_id": 77,
                "event_type": "granted",
                "door_id": "north",
                "created_at": (now - timedelta(minutes=2)).isoformat(),
            },
            {
                "id": 22,
                "user_id": 77,
                "event_type": "granted",
                "door_id": "south",
                "created_at": (now - timedelta(minutes=1)).isoformat(),
            },
        ]
        result = IncidentCorrelationEngine().build_incidents(logs)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["risk_score"], 20)
        self.assertIn("rapid_multi_door", str(result[0]["evidence"]["factors"]))

    def test_controller_alarm_has_high_priority_and_deduplication_key(self):
        now = datetime.now(timezone.utc).isoformat()
        result = IncidentCorrelationEngine().build_incidents([{
            "id": 9,
            "user_id": 5,
            "event_type": "denied",
            "reason": "forced_open controller alarm",
            "door_id": "main",
            "created_at": now,
        }])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["risk_score"], 60)
        self.assertTrue(result[0]["dedupe_key"])


if __name__ == "__main__":
    unittest.main()
