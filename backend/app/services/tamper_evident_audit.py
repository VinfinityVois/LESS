"""Tamper-evident, append-only security audit journal.

The journal is stored outside SQLite as canonical JSONL records chained with
HMAC-SHA256. It detects edits, insertion, deletion and reordering when the
signing key remains secret. It is not WORM storage: an OS administrator who
can replace both this file and the key can still rewrite history.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings


class TamperEvidentAudit:
    GENESIS = "0" * 64

    def __init__(self) -> None:
        self.path: Path = settings.DATA_DIR / "security_audit.jsonl"
        self._lock = threading.RLock()
        self._key = self._derive_key()
        self._last_hash = self.GENESIS
        self._sequence = 0
        self._healthy = True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._verify_and_load()

    def _derive_key(self) -> bytes:
        secret = (settings.AUDIT_HMAC_KEY or "").strip()
        if len(secret) == 64:
            try:
                raw = bytes.fromhex(secret)
            except ValueError:
                raw = secret.encode("utf-8")
        else:
            raw = secret.encode("utf-8")
        if len(raw) < 32 or len(set(raw)) < 12:
            raise RuntimeError("Для защищённого аудита требуется отдельный AUDIT_HMAC_KEY: 32 случайных байта в hex.")
        return hashlib.sha256(b"LESS/security-audit/v1/" + raw).digest()

    @staticmethod
    def _canonical(value: dict[str, Any]) -> bytes:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

    def _record_hash(self, body: dict[str, Any]) -> str:
        return hmac.new(self._key, self._canonical(body), hashlib.sha256).hexdigest()

    def _verify_and_load(self) -> None:
        if not self.path.exists():
            return
        previous = self.GENESIS
        sequence = 0
        try:
            with self.path.open("r", encoding="utf-8") as stream:
                for line_number, line in enumerate(stream, 1):
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    supplied = record.pop("hmac")
                    if record.get("sequence") != sequence + 1 or record.get("previous_hash") != previous:
                        raise ValueError(f"Нарушена последовательность аудита в строке {line_number}.")
                    expected = self._record_hash(record)
                    if not hmac.compare_digest(str(supplied), expected):
                        raise ValueError(f"Неверная подпись аудита в строке {line_number}.")
                    sequence += 1
                    previous = expected
        except Exception as exc:
            self._healthy = False
            raise RuntimeError("Цепочка аудита повреждена. Запись операций заблокирована до расследования.") from exc
        self._sequence, self._last_hash = sequence, previous

    def append(self, event: str, actor_id: int | None = None, target: str = "", details: Any = None) -> dict[str, Any]:
        with self._lock:
            if not self._healthy:
                raise RuntimeError("Защищённый аудит недоступен: обнаружено повреждение цепочки.")
            body = {
                "sequence": self._sequence + 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": str(event)[:160],
                "actor_id": actor_id,
                "target": str(target)[:256],
                "details": details if isinstance(details, (dict, list, int, float, bool)) or details is None else str(details)[:2000],
                "previous_hash": self._last_hash,
            }
            digest = self._record_hash(body)
            record = {**body, "hmac": digest}
            payload = self._canonical(record) + b"\n"
            flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
            fd = os.open(self.path, flags, 0o600)
            try:
                with os.fdopen(fd, "ab", closefd=True) as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception:
                self._healthy = False
                raise
            self._sequence += 1
            self._last_hash = digest
            return {"sequence": self._sequence, "hash": digest}

    def verify(self) -> dict[str, Any]:
        with self._lock:
            previous = self.GENESIS
            sequence = 0
            try:
                if self.path.exists():
                    with self.path.open("r", encoding="utf-8") as stream:
                        for line_number, line in enumerate(stream, 1):
                            if not line.strip():
                                continue
                            record = json.loads(line)
                            supplied = record.pop("hmac")
                            if record.get("sequence") != sequence + 1 or record.get("previous_hash") != previous:
                                raise ValueError(f"Нарушена последовательность в строке {line_number}")
                            expected = self._record_hash(record)
                            if not hmac.compare_digest(str(supplied), expected):
                                raise ValueError(f"Подпись не совпадает в строке {line_number}")
                            sequence += 1
                            previous = expected
                healthy = True
            except Exception as exc:
                healthy = False
                return {"valid": False, "records": sequence, "error": str(exc)}
            if healthy:
                self._sequence, self._last_hash, self._healthy = sequence, previous, True
            return {"valid": healthy, "records": sequence, "head": previous, "storage": str(self.path)}


audit_journal = TamperEvidentAudit()
