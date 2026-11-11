import unittest
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
                "subject_ref": "card:somehash",
                "relative_anomaly_score": 90,
                "model": "IsolationForest",
            }]},
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["risk_score"], 35)
        self.assertEqual(result[0]["severity"], "medium")
        self.assertIn("repeated_denials", str(result[0]["evidence"]["factors"]))
        self.assertNotIn("RAW-UID-001", str(result))

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
        self.assertEqual(result[0]["risk_score"], 45)
        self.assertTrue(result[0]["dedupe_key"])


if __name__ == "__main__":
    unittest.main()
