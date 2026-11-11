import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from app.services.ml_anomaly_detector import MLAnomalyDetector


class MLAnomalyDetectorTests(unittest.TestCase):
    def test_returns_insufficient_data_without_fitting_model(self):
        result = MLAnomalyDetector(min_subjects=3, min_events=2).analyze([
            {"id": 1, "user_id": 1, "event_type": "granted", "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": 2, "user_id": 1, "event_type": "denied", "created_at": datetime.now(timezone.utc).isoformat()},
        ])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["anomalies"], [])


    def test_model_failure_returns_advisory_error_instead_of_raising(self):
        from datetime import datetime, timezone
        logs = []
        now = datetime.now(timezone.utc).isoformat()
        for subject in range(3):
            for index in range(3):
                logs.append({
                    "id": subject * 10 + index,
                    "user_id": subject + 1,
                    "event_type": "granted",
                    "created_at": now,
                })
        with patch("sklearn.ensemble.IsolationForest.fit", side_effect=ValueError("bad cohort")):
            result = MLAnomalyDetector(min_subjects=2, min_events=2).analyze(logs)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["anomalies"], [])

    def test_anomaly_results_never_expose_raw_nfc_uid(self):
        detector = MLAnomalyDetector(min_subjects=2, min_events=2)
        now = datetime.now(timezone.utc)
        logs = []
        for subject in range(3):
            for index in range(5):
                logs.append({
                    "id": subject * 10 + index,
                    "nfc_uid": f"RAW-CARD-{subject}",
                    "event_type": "denied" if subject == 2 else "granted",
                    "door_id": "door-x" if subject == 2 else "door-main",
                    "factor_used": "face" if subject == 2 else "nfc",
                    "created_at": (now - timedelta(minutes=index * (subject + 1))).isoformat(),
                })
        result = detector.analyze(logs)
        self.assertIn(result["status"], {"ok", "insufficient_data"})
        rendered = str(result)
        self.assertNotIn("RAW-CARD", rendered)


if __name__ == "__main__":
    unittest.main()
