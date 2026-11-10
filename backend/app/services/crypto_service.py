"""
Криптографический сервис: Argon2id + AES-256-GCM.
"""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import os
import base64
from app.config import settings


class CryptoService:
    def __init__(self):
        self.ph = PasswordHasher(
            time_cost=settings.ARGON2_TIME_COST,
            memory_cost=settings.ARGON2_MEMORY_COST,
        )

    def hash_secret(self, secret: str) -> str:
        """Хеширование ПИН / пароля / биометрического шаблона."""
        return self.ph.hash(secret)

    def verify_secret(self, hash_str: str, secret: str) -> bool:
        try:
            self.ph.verify(hash_str, secret)
            return True
        except VerifyMismatchError:
            return False

    def generate_key(self) -> bytes:
        return AESGCM.generate_key(bit_length=256)

    def encrypt(self, data: bytes, key: bytes) -> bytes:
        aesgcm = AESGCM(key)
        nonce = os.urandom(12)
        ct = aesgcm.encrypt(nonce, data, None)
        return nonce + ct

    def decrypt(self, encrypted: bytes, key: bytes) -> bytes:
        aesgcm = AESGCM(key)
        nonce = encrypted[:12]
        ct = encrypted[12:]
        return aesgcm.decrypt(nonce, ct, None)

    def encrypt_to_b64(self, data: bytes, key: bytes) -> str:
        return base64.b64encode(self.encrypt(data, key)).decode("utf-8")

    def decrypt_from_b64(self, b64_data: str, key: bytes) -> bytes:
        return self.decrypt(base64.b64decode(b64_data), key)


crypto_service = CryptoService()
