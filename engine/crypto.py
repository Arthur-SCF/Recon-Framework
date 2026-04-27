"""
Encryption helpers for secrets stored in the database.

Keys are derived with PBKDF2-HMAC-SHA256 (600 000 iterations) from
RECON_MASTER_KEY + ENCRYPTION_SALT and cached in-process with lru_cache.
Never log key material. Never return raw key bytes outside this module.
"""
import base64
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

log = logging.getLogger("engine.crypto")


class CryptoError(Exception):
    """Raised on encryption/decryption failure."""


@lru_cache(maxsize=1)
def _derive_fernet(master_key: str, salt: str) -> Fernet:
    """
    Derive a Fernet key from RECON_MASTER_KEY + ENCRYPTION_SALT.
    Cached — derived once per process lifetime.
    600 000 PBKDF2 iterations per OWASP 2023 recommendation.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt.encode(),
        iterations=600_000,
    )
    raw_key = kdf.derive(master_key.encode())
    return Fernet(base64.urlsafe_b64encode(raw_key))


def _get_fernet() -> Fernet:
    from engine.config import get_settings
    s = get_settings()
    return _derive_fernet(s.recon_master_key, s.encryption_salt)


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns a base64-encoded Fernet token."""
    try:
        return _get_fernet().encrypt(plaintext.encode()).decode()
    except Exception as exc:
        log.error("Encryption failed")
        raise CryptoError("Encryption failed") from exc


def decrypt(token: str) -> str:
    """Decrypt a Fernet token. Raises CryptoError on failure."""
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        log.warning("Decryption failed — invalid or tampered token")
        raise CryptoError("Decryption failed — invalid token") from exc
    except Exception as exc:
        log.error("Decryption error")
        raise CryptoError("Decryption error") from exc
