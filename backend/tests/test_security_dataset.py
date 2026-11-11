import csv
import unittest
from pathlib import Path


class SecurityDatasetTests(unittest.TestCase):
    def test_dataset_has_200_synthetic_records_and_all_test_approaches(self):
        path = Path(__file__).parent / "fixtures" / "security_test_dataset.csv"
        with path.open(encoding="utf-8", newline="") as source:
            rows = list(csv.DictReader(source))
        self.assertEqual(len(rows), 200)
        self.assertEqual(len({row["case_id"] for row in rows}), 200)
        self.assertEqual({row["approach"] for row in rows}, {"black_box", "gray_box", "white_box"})
        self.assertTrue(all(row["synthetic_subject"].startswith("TEST-SUBJECT-") for row in rows))
        self.assertTrue(all(row["synthetic_uid"].startswith("TEST-") for row in rows))
        self.assertTrue(all(row["expected_result"] for row in rows))

    def test_dataset_covers_security_and_biometric_domains(self):
        path = Path(__file__).parent / "fixtures" / "security_test_dataset.csv"
        with path.open(encoding="utf-8", newline="") as source:
            categories = {row["category"] for row in csv.DictReader(source)}
        self.assertTrue({"authentication", "authorization", "rate_limit", "liveness",
                         "biometric", "guest_access", "archive", "database", "audit",
                         "request_guard"}.issubset(categories))


if __name__ == "__main__":
    unittest.main()
