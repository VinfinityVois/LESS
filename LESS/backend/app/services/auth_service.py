"""
Сервис аутентификации (2FA: NFC + биометрия/ПИН/отпечаток).
"""

from loguru import logger
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from app.services.crypto_service import crypto_service


class AuthService:
    def __init__(self):
        self.pending_nfc: Optional[str] = None  # UID ожидающий второй фактор
        self.pending_since: Optional[datetime] = None

    def start_auth(self, nfc_uid: str) -> Dict[str, Any]:
        """Начало аутентификации после чтения NFC."""
        self.pending_nfc = nfc_uid
        self.pending_since = datetime.now(timezone.utc)
        logger.info(f"Начата 2FA для карты {nfc_uid}")
        return {
            "status": "awaiting_second_factor",
            "nfc_uid": nfc_uid,
            "required": ["face", "pin"],  # или fingerprint
        }

    def verify_second_factor(
        self,
        factor_type: str,
        value: str,
        stored_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Проверка второго фактора.
        factor_type: 'pin' | 'fingerprint' | 'face'
        """
        if not self.pending_nfc:
            return {"success": False, "reason": "no_pending_auth"}

        # Для PIN / fingerprint — проверка хеша
        if factor_type in ("pin", "fingerprint") and stored_hash:
            ok = crypto_service.verify_secret(stored_hash, value)
            if not ok:
                logger.warning(f"Неверный {factor_type} для {self.pending_nfc}")
                return {"success": False, "reason": "invalid_factor"}

        # Для face пока заглушка (реальная проверка будет в camera_service + AI)
        if factor_type == "face":
            # TODO: сравнение эмбеддинга лица
            pass

        uid = self.pending_nfc
        self.pending_nfc = None
        self.pending_since = None
        logger.info(f"Успешная 2FA для {uid} ({factor_type})")
        return {
            "success": True,
            "nfc_uid": uid,
            "factor": factor_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def cancel(self):
        self.pending_nfc = None
        self.pending_since = None


auth_service = AuthService()
