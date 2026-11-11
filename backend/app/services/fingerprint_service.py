"""Vendor-neutral fingerprint reader contract.

The core application deliberately ships without a fake reader. A real adapter
must be added only after selecting hardware and reviewing its SDK/security model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.config import settings


@dataclass(frozen=True)
class FingerprintDeviceStatus:
    available: bool
    device_id: str | None
    vendor: str | None
    message: str


@dataclass(frozen=True)
class FingerprintVerification:
    verified: bool
    device_id: str
    transaction_id: str
    challenge: str
    authenticated: bool
    assurance: str


class FingerprintAdapter(Protocol):
    def status(self) -> FingerprintDeviceStatus: ...

    def enroll_subject(self, subject_ref: str) -> str:
        """Enroll on the reader and return an opaque vendor-side reference."""
        ...

    def verify_subject(self, subject_ref: str, challenge: str) -> FingerprintVerification:
        """Perform matching inside the vendor adapter; never return raw samples."""
        ...


class FingerprintDeviceUnavailable(RuntimeError):
    pass


class FingerprintService:
    def __init__(self, adapter: FingerprintAdapter | None = None):
        self._adapter = adapter
        self._expected_device_id = settings.FINGERPRINT_DEVICE_ID.strip()

    def status(self) -> FingerprintDeviceStatus:
        if self._adapter is None:
            return FingerprintDeviceStatus(
                available=False,
                device_id=None,
                vendor=None,
                message="Сканер отпечатков не выбран и не подключён. Фактор отключён.",
            )
        try:
            status = self._adapter.status()
            if not status.available:
                return status
            if not self._expected_device_id or status.device_id != self._expected_device_id:
                return FingerprintDeviceStatus(
                    available=False,
                    device_id=status.device_id,
                    vendor=status.vendor,
                    message="Устройство не совпадает с закреплённым FINGERPRINT_DEVICE_ID. Проверка заблокирована.",
                )
            return status
        except Exception:
            return FingerprintDeviceStatus(
                available=False,
                device_id=None,
                vendor=None,
                message="Не удалось получить безопасный статус сканера.",
            )

    def enroll_subject(self, subject_ref: str) -> str:
        if self._adapter is None or not self.status().available:
            raise FingerprintDeviceUnavailable("Сканер отпечатков недоступен; регистрация невозможна.")
        reference = self._adapter.enroll_subject(subject_ref)
        if not reference or len(reference) > 256:
            raise FingerprintDeviceUnavailable("Сканер вернул некорректную ссылку шаблона.")
        return reference

    def verify_subject(self, subject_ref: str, challenge: str) -> FingerprintVerification:
        status = self.status()
        if self._adapter is None or not status.available:
            raise FingerprintDeviceUnavailable("Сканер отпечатков недоступен; проверка невозможна.")
        if not challenge or len(challenge) < 16 or len(challenge) > 256:
            raise ValueError("Требуется одноразовый challenge длиной 16–256 символов.")
        result = self._adapter.verify_subject(subject_ref, challenge)
        if (
            not result.device_id
            or result.device_id != self._expected_device_id
            or not result.transaction_id
            or result.challenge != challenge
            or result.authenticated is not True
        ):
            raise FingerprintDeviceUnavailable("Ответ сканера не прошёл привязку к устройству и одноразовому challenge.")
        return result


fingerprint_service = FingerprintService()
