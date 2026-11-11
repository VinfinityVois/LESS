import unittest
from unittest.mock import patch

from app.services.fingerprint_service import (
    FingerprintDeviceStatus,
    FingerprintDeviceUnavailable,
    FingerprintService,
    FingerprintVerification,
)


class FakeFingerprintAdapter:
    def __init__(self, device_id="reader-01", challenge=None, authenticated=True):
        self.device_id = device_id
        self.challenge = challenge
        self.authenticated = authenticated

    def status(self):
        return FingerprintDeviceStatus(True, self.device_id, "TestVendor", "ready")

    def enroll_subject(self, subject_ref):
        return "opaque-template-ref"

    def verify_subject(self, subject_ref, challenge):
        return FingerprintVerification(
            verified=True,
            device_id=self.device_id,
            transaction_id="txn-01",
            challenge=self.challenge if self.challenge is not None else challenge,
            authenticated=self.authenticated,
            assurance="vendor_sdk_match",
        )


class FingerprintServiceTests(unittest.TestCase):
    def test_no_device_is_explicitly_unavailable_and_fails_closed(self):
        service = FingerprintService()
        self.assertFalse(service.status().available)
        with self.assertRaises(FingerprintDeviceUnavailable):
            service.enroll_subject("user-ref:1")
        with self.assertRaises(FingerprintDeviceUnavailable):
            service.verify_subject("user-ref:1", "a" * 32)

    def test_device_must_match_pinned_identifier(self):
        with patch("app.services.fingerprint_service.settings.FINGERPRINT_DEVICE_ID", "reader-pinned"):
            service = FingerprintService(FakeFingerprintAdapter(device_id="reader-other"))
            self.assertFalse(service.status().available)

    def test_verification_is_bound_to_device_and_one_time_challenge(self):
        with patch("app.services.fingerprint_service.settings.FINGERPRINT_DEVICE_ID", "reader-01"):
            service = FingerprintService(FakeFingerprintAdapter(challenge="old-challenge"))
            with self.assertRaises(FingerprintDeviceUnavailable):
                service.verify_subject("user-ref:1", "fresh-challenge-" + "x" * 20)

            valid = FingerprintService(FakeFingerprintAdapter())
            result = valid.verify_subject("user-ref:1", "fresh-challenge-" + "x" * 20)
            self.assertTrue(result.authenticated)


if __name__ == "__main__":
    unittest.main()
