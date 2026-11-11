import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from safe_load_test import validate_target


class SafeLoadTestGuardTests(unittest.TestCase):
    def test_accepts_loopback_status_endpoint(self):
        self.assertEqual(validate_target("http://127.0.0.1:8000/api/status"),
                         "http://127.0.0.1:8000/api/status")

    def test_rejects_public_targets(self):
        with self.assertRaises(SystemExit):
            validate_target("http://example.com/api/status")

    def test_rejects_non_status_paths(self):
        with self.assertRaises(SystemExit):
            validate_target("http://127.0.0.1:8000/api/access/check")

    def test_rejects_https_and_non_http_schemes(self):
        with self.assertRaises(SystemExit):
            validate_target("https://127.0.0.1:8000/api/status")


if __name__ == "__main__":
    unittest.main()
