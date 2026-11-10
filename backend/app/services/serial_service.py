"""Serial transport for NFC readers and authenticated LESS door controllers."""
from __future__ import annotations

from loguru import logger
from typing import Optional, Callable, Any
import serial
import serial.tools.list_ports
import hashlib
import hmac
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.services.tamper_evident_audit import audit_journal


class SerialService:
    PROTOCOL = "LESS-HW/1"

    def __init__(self):
        self.ser: Optional[serial.Serial] = None
        self.is_connected = False
        self.on_card_read: Optional[Callable[[str], None]] = None
        self._condition = threading.Condition()
        self._pending: dict[str, dict[str, Any]] = {}
        self._last_sequence = -1
        self._hardware_status: dict[str, Any] = {
            "configured": bool(getattr(settings, "CONTROLLER_HMAC_KEY", "")),
            "authenticated": False,
            "controller_id": None,
            "lock_state": "unknown",
            "door_state": "unknown",
            "last_seen": None,
            "last_event": None,
            "alarm": None,
        }

    def list_ports(self) -> list[str]:
        return [p.device for p in serial.tools.list_ports.comports()]

    def connect(self, port: str = None, baudrate: int = None) -> bool:
        port = port or settings.SERIAL_PORT
        baudrate = baudrate or settings.SERIAL_BAUDRATE
        try:
            self.ser = serial.Serial(port=port, baudrate=baudrate, timeout=settings.SERIAL_TIMEOUT)
            self.is_connected = True
            self._hardware_status["serial_connected"] = True
            logger.info(f"Подключено к устройству на {port}")
            return True
        except Exception as e:
            logger.error(f"Ошибка подключения к {port}: {e}")
            self.is_connected = False
            self._hardware_status["serial_connected"] = False
            return False

    def disconnect(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
        self.ser = None
        self.is_connected = False
        self._hardware_status["serial_connected"] = False
        self._hardware_status["authenticated"] = False
        logger.info("Serial отключён")

    @staticmethod
    def _controller_key() -> bytes:
        value = (getattr(settings, "CONTROLLER_HMAC_KEY", "") or "").strip()
        try:
            key = bytes.fromhex(value) if len(value) == 64 else value.encode("utf-8")
        except ValueError:
            key = b""
        if len(key) < 32 or len(set(key)) < 12:
            raise RuntimeError("CONTROLLER_HMAC_KEY должен быть отдельным случайным ключом не короче 32 байт.")
        return key

    @staticmethod
    def _canonical(payload: dict[str, Any]) -> bytes:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    def _sign(self, payload: dict[str, Any]) -> str:
        return hmac.new(self._controller_key(), self._canonical(payload), hashlib.sha256).hexdigest()

    def send_secure_command(self, action: str, door_id: str = "main", duration_ms: int = 3000) -> dict[str, Any]:
        if action not in {"unlock", "lock"}:
            raise ValueError("Недопустимая команда контроллера.")
        if not self.ser or not self.is_connected or not self.ser.is_open:
            raise RuntimeError("Контроллер не подключён по Serial.")
        command_id = uuid.uuid4().hex
        payload = {
            "protocol": self.PROTOCOL,
            "type": "command",
            "command_id": command_id,
            "nonce": secrets.token_hex(16),
            "issued_at": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "door_id": door_id,
            "duration_ms": max(500, min(int(duration_ms), 10000)) if action == "unlock" else 0,
        }
        payload["signature"] = self._sign(payload)
        with self._condition:
            self._pending[command_id] = {"nonce": payload["nonce"], "ack": None, "created_at": datetime.now(timezone.utc).isoformat()}
        try:
            self.ser.write((self.PROTOCOL + " " + json.dumps(payload, separators=(",", ":")) + "\\n").encode("utf-8"))
            self.ser.flush()
        except Exception:
            with self._condition:
                self._pending.pop(command_id, None)
            raise
        audit_journal.append("hardware.command_sent", target=door_id, details={"command_id": command_id, "action": action})
        return {"command_id": command_id, "state": "pending", "action": action, "door_id": door_id}

    def wait_for_ack(self, command_id: str, timeout: float = 4.0) -> Optional[dict[str, Any]]:
        with self._condition:
            self._condition.wait_for(
                lambda: command_id not in self._pending or self._pending[command_id].get("ack") is not None,
                timeout=max(0.1, min(timeout, 8.0)),
            )
            pending = self._pending.pop(command_id, None)
            return pending.get("ack") if pending else None

    def _handle_controller_line(self, line: str) -> bool:
        prefix = self.PROTOCOL + " "
        if not line.startswith(prefix):
            return False
        try:
            message = json.loads(line[len(prefix):])
            signature = str(message.pop("signature"))
            expected = self._sign(message)
            if not hmac.compare_digest(signature, expected):
                raise ValueError("signature_mismatch")
            if message.get("protocol") != self.PROTOCOL or message.get("type") not in {"ack", "telemetry"}:
                raise ValueError("invalid_message")
            expected_id = (getattr(settings, "CONTROLLER_ID", "") or "").strip()
            if expected_id and message.get("controller_id") != expected_id:
                raise ValueError("controller_id_mismatch")
            stamp = datetime.fromisoformat(str(message.get("timestamp", "")).replace("Z", "+00:00"))
            if stamp.tzinfo is None or abs((datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds()) > 10:
                raise ValueError("stale_controller_message")
            sequence = int(message.get("sequence", -1))
            with self._condition:
                if sequence <= self._last_sequence:
                    raise ValueError("replayed_sequence")
                self._last_sequence = sequence
                self._hardware_status.update({
                    "authenticated": True,
                    "controller_id": str(message.get("controller_id", ""))[:80],
                    "lock_state": str(message.get("lock_state", "unknown")),
                    "door_state": str(message.get("door_state", "unknown")),
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "last_event": message.get("event"),
                    "alarm": message.get("alarm"),
                    "sequence": sequence,
                })
                command_id = message.get("command_id")
                if message.get("type") == "ack" and command_id in self._pending:
                    pending = self._pending[command_id]
                    if not hmac.compare_digest(str(message.get("nonce", "")), pending["nonce"]):
                        raise ValueError("nonce_mismatch")
                    pending["ack"] = {
                        "accepted": message.get("result") == "accepted",
                        "lock_state": message.get("lock_state"),
                        "door_state": message.get("door_state"),
                        "reason": message.get("reason"),
                        "sequence": sequence,
                    }
                self._condition.notify_all()
            if message.get("door_state") in {"forced_open", "held_open"} or message.get("alarm"):
                audit_journal.append(
                    "hardware.alarm",
                    target=str(message.get("door_id", "main")),
                    details={"door_state": message.get("door_state"), "alarm": message.get("alarm"), "sequence": sequence},
                )
            elif message.get("type") == "ack":
                audit_journal.append(
                    "hardware.command_acknowledged",
                    target=str(message.get("door_id", "main")),
                    details={"command_id": message.get("command_id"), "result": message.get("result"),
                             "lock_state": message.get("lock_state"), "door_state": message.get("door_state"),
                             "sequence": sequence},
                )
            return True
        except Exception as exc:
            logger.warning(f"Отклонено неподтверждённое сообщение контроллера: {exc}")
            audit_journal.append("hardware.message_rejected", details={"reason": str(exc)[:160]})
            return True

    def hardware_status(self) -> dict[str, Any]:
        return {**self._hardware_status, "serial_connected": bool(self.is_connected)}

    def read_line(self) -> Optional[str]:
        if not self.ser or not self.is_connected:
            return None
        try:
            if self.ser.in_waiting:
                line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    return None
                if self._handle_controller_line(line):
                    return None
                return line
        except Exception as e:
            logger.error(f"Ошибка чтения Serial: {e}")
        return None


serial_service = SerialService()
