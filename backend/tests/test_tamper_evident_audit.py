from pathlib import Path

import pytest

from app.config import settings
from app.services.tamper_evident_audit import TamperEvidentAudit


def test_audit_chain_appends_and_verifies(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "AUDIT_HMAC_KEY", bytes(range(32)).hex())
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    journal = TamperEvidentAudit()

    first = journal.append("access.event", actor_id=7, target="employee:12", details={"decision": "deny"})
    second = journal.append("admin.audit", actor_id=7, target="user:12", details="profile changed")

    result = journal.verify()
    assert first["sequence"] == 1
    assert second["sequence"] == 2
    assert result["valid"] is True
    assert result["records"] == 2


def test_audit_chain_detects_tampering_and_blocks_append(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(settings, "AUDIT_HMAC_KEY", bytes(range(1, 33)).hex())
    monkeypatch.setattr(settings, "DATA_DIR", tmp_path)
    journal = TamperEvidentAudit()
    journal.append("access.event", target="door:main", details={"decision": "allow"})

    content = journal.path.read_text(encoding="utf-8")
    journal.path.write_text(content.replace("access.event", "access.deleted"), encoding="utf-8")

    result = journal.verify()
    assert result["valid"] is False
    with pytest.raises(RuntimeError):
        journal.append("access.event", target="door:main")


def test_controller_frame_is_encrypted_and_authenticated(monkeypatch):
    import base64
    import json

    from app.services.serial_service import SerialService

    monkeypatch.setattr(settings, "CONTROLLER_HMAC_KEY", bytes(range(32)).hex())
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
    assert "unlock" not in frame
    assert service._decrypt_frame(frame.strip()) == payload

    prefix, envelope_text = frame.strip().split(" ", 1)
    envelope = json.loads(envelope_text)
    ciphertext = bytearray(base64.b64decode(envelope["ciphertext"]))
    ciphertext[0] ^= 0x01
    envelope["ciphertext"] = base64.b64encode(ciphertext).decode("ascii")
    tampered = prefix + " " + json.dumps(envelope)
    with pytest.raises(Exception):
        service._decrypt_frame(tampered)
