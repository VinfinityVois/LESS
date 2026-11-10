"""SQLCipher-backed SQLite connections and one-time plaintext migration.

The migration writes a verified encrypted replacement before atomically replacing
the legacy database. A second encrypted backup is retained beside the database.
"""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

from sqlcipher3 import dbapi2 as sqlite3

from app.config import settings


SQLITE_HEADER = b"SQLite format 3\x00"


def validate_database_key(secret_key: str) -> str:
    key = (secret_key or "").strip().lower()
    if len(key) != 64 or any(ch not in "0123456789abcdef" for ch in key) or len(set(key)) < 12:
        raise RuntimeError(
            "Зашифрованная база данных не запущена: задайте уникальный SECRET_KEY из 64 hex-символов "
            "в backend/.env. Создать его: python -c \"import secrets; print(secrets.token_hex(32))\". "
            "Не используйте пример из .env.example и сохраните резервную копию ключа отдельно."
        )
    return key


def _apply_key(conn, key: str) -> None:
    # The raw 256-bit hex key avoids SQLCipher's password-based KDF ambiguity.
    conn.execute(f'PRAGMA key = "x\'{key}\'"')
    conn.execute("PRAGMA cipher_compatibility = 4")
    conn.execute("PRAGMA cipher_memory_security = ON")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA secure_delete = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 10000")


class ClosingConnection(sqlite3.Connection):
    """Close connections when used in a with-statement."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def _open_cipher(path: Path, key: str):
    conn = sqlite3.connect(str(path), timeout=10, factory=ClosingConnection)
    conn.row_factory = sqlite3.Row
    try:
        _apply_key(conn, key)
        # Force key verification immediately; SQLCipher otherwise opens lazily.
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        return conn
    except Exception:
        conn.close()
        raise


def connect_encrypted(path: Path | str | None = None):
    key = validate_database_key(settings.SECRET_KEY)
    conn = _open_cipher(Path(path or settings.DB_PATH), key)
    return conn


def _verify_encrypted(path: Path, key: str) -> None:
    conn = _open_cipher(path, key)
    try:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        if not rows or any(str(row[0]).lower() != "ok" for row in rows):
            raise RuntimeError("Проверка целостности зашифрованной базы не пройдена.")
        version = conn.execute("PRAGMA cipher_version").fetchone()
        if not version or not version[0]:
            raise RuntimeError("SQLCipher не подтвердил активное шифрование.")
    finally:
        conn.close()


def ensure_encrypted_database(db_path: Path | str, secret_key: str) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    key = validate_database_key(secret_key)

    if not path.exists() or path.stat().st_size == 0:
        return

    with path.open("rb") as stream:
        header = stream.read(len(SQLITE_HEADER))

    if header != SQLITE_HEADER:
        # Never silently treat an unreadable database as a new empty database.
        try:
            _verify_encrypted(path, key)
        except Exception as exc:
            raise RuntimeError(
                "Не удалось открыть существующую БД с текущим SECRET_KEY. "
                "База не изменена. Верните прежний ключ или восстановите проверенную резервную копию."
            ) from exc
        return

    # Plain SQLite detected. Do not modify it until the encrypted export passes
    # both SQLCipher key verification and SQLite integrity_check.
    lock_path = path.with_name(path.name + ".migration.lock")
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise RuntimeError("Обнаружена другая миграция БД. Убедитесь, что backend не запущен в другом процессе.") from exc

    temp_path = path.with_name(path.name + ".sqlcipher-migration.tmp")
    backup_path = path.with_name(path.name + ".pre-encryption-" + time.strftime("%Y%m%d-%H%M%S") + ".sqlcipher")
    backup_temp = backup_path.with_name(backup_path.name + ".tmp")

    source = None
    try:
        for candidate in (temp_path, backup_temp):
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass
        source = sqlite3.connect(str(path), timeout=10)
        source.execute("PRAGMA cipher_compatibility = 4")
        source.execute("PRAGMA temp_store = MEMORY")
        checkpoint = source.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if checkpoint and int(checkpoint[0]) != 0:
            raise RuntimeError("Не удалось завершить WAL-транзакции. Остановите все процессы backend и повторите.")
        source.execute("PRAGMA journal_mode = DELETE").fetchone()
        source.execute(
            f'ATTACH DATABASE ? AS encrypted KEY "x\'{key}\'"',
            (str(temp_path),),
        )
        source.execute("SELECT sqlcipher_export('encrypted')").fetchone()
        source.execute("DETACH DATABASE encrypted")
        source.close()
        source = None

        _verify_encrypted(temp_path, key)

        # Keep a second, already encrypted recovery copy. No plaintext backup is
        # created by this migration.
        shutil.copy2(temp_path, backup_temp)
        with backup_temp.open("rb+") as stream:
            os.fsync(stream.fileno())
        os.replace(backup_temp, backup_path)
        os.replace(temp_path, path)
        try:
            os.chmod(path, 0o600)
            os.chmod(backup_path, 0o600)
        except OSError:
            # Windows ACLs, not POSIX mode bits, govern access on Windows.
            pass
        _verify_encrypted(path, key)
    except Exception as exc:
        if source is not None:
            source.close()
        for candidate in (temp_path, backup_temp):
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(
            "Миграция SQLite → SQLCipher не завершена. Исходная база сохранена; "
            "проверьте свободное место, остановку backend и верность SECRET_KEY."
        ) from exc
    finally:
        os.close(lock_fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
