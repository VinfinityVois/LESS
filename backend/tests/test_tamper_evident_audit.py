from pathlib import Path
import tempfile
import unittest

from app.config import settings
from app.services.tamper_evident_audit import TamperEvidentAudit


class TamperEvidentAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_key = settings.AUDIT_HMAC_KEY
        self.old_data_dir = settings.DATA_DIR
        self.old_controller_key = settings.CONTROLLER_HMAC_KEY
        settings.AUDIT_HMAC_KEY = bytes(range(32)).hex()
        settings.DATA_DIR = Path(self.temp_dir.name)

    def tearDown(self):
        settings.AUDIT_HMAC_KEY = self.old_key
        settings.DATA_DIR = self.old_data_dir
        settings.CONTROLLER_HMAC_KEY = self.old_controller_key
        self.temp_dir.cleanup()

    def test_audit_chain_appends_and_verifies(self):
        journal = TamperEvidentAudit()
        first = journal.append("access.event", actor_id=7, target="employee:12", details={"decision": "deny"})
        second = journal.append("admin.audit", actor_id=7, target="user:12", details="profile changed")

        result = journal.verify()
        self.assertEqual(first["sequence"], 1)
        self.assertEqual(second["sequence"], 2)
        self.assertTrue(result["valid"])
        self.assertEqual(result["records"], 2)

    def test_audit_chain_detects_tampering_and_blocks_append(self):
        journal = TamperEvidentAudit()
        journal.append("access.event", target="door:main", details={"decision": "allow"})
        original = journal.path.read_text(encoding="utf-8")
        journal.path.write_text(original.replace("access.event", "access.deleted"), encoding="utf-8")

        result = journal.verify()
        self.assertFalse(result["valid"])
        with self.assertRaises(RuntimeError):
            journal.append("access.event", target="door:main")

    def test_controller_frame_is_encrypted_and_authenticated(self):
        import base64
        import json
        from app.services.serial_service import SerialService

        settings.CONTROLLER_HMAC_KEY = bytes(range(1, 33)).hex()
        service = SerialService()
        payload = {
            "protocol": "LESS-HW/1",
            "type": "command",
            "command_id": "abc123",
            "nonce": "0123456789abcdef0123456789abcdef",
            "action": "unlock",
            "door_id": "main",
        }
        frame = service._encrypt_frame(payload)
        self.assertNotIn("unlock", frame)
        self.assertEqual(service._decrypt_frame(frame.strip()), payload)

        prefix, envelope_text = frame.strip().split(" ", 1)
        envelope = json.loads(envelope_text)
        ciphertext = bytearray(base64.b64decode(envelope["ciphertext"]))
        ciphertext[0] ^= 0x01
        envelope["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")
        tampered = prefix + " " + json.dumps(envelope)
        with self.assertRaises(Exception):
            service._decrypt_frame(tampered)


if __name__ == "__main__":
    unittest.main()
