import unittest

from app.services.fingerprint_service import FingerprintDeviceUnavailable, FingerprintService


class FingerprintServiceTests(unittest.TestCase):
    def test_no_device_is_explicitly_unavailable_and_fails_closed(self):
        service = FingerprintService()
        self.assertFalse(service.status().available)
        with self.assertRaises(FingerprintDeviceUnavailable):
            service.enroll_subject("user-ref:1")
        with self.assertRaises(FingerprintDeviceUnavailable):
            service.verify_subject("user-ref:1", "a" * 32)


if __name__ == "__main__":
    unittest.main()
