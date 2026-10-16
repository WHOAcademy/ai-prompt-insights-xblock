"""Encrypt API credentials before storing them in XBlock settings."""
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

class EncryptionConfigurationError(ValueError):
    """Signal missing or invalid Fernet settings or stored ciphertext."""


def _fernet():
    """Create a Fernet cipher from the configured Django setting."""
    key = getattr(settings, "AI_PROMPT_INSIGHTS_ENCRYPTION_KEY", None)
    if not key:
        raise EncryptionConfigurationError("API key encryption is not configured.")
    try:
        return Fernet(key.encode("ascii") if isinstance(key, str) else key)
    except (TypeError, ValueError, UnicodeError) as exc:
        raise EncryptionConfigurationError("Invalid API key encryption configuration.") from exc

def encrypt_api_key(value):
    """Encrypt an API key before storing it in XBlock settings."""
    return "fernet:" + _fernet().encrypt(value.encode("utf-8")).decode("ascii")

def decrypt_api_key(value):
    """Decrypt saved ciphertext or reject legacy plaintext values."""
    if not value:
        return ""
    if not value.startswith("fernet:"):
        raise EncryptionConfigurationError("Re-enter the legacy API key in Studio to encrypt it.")
    try:
        return _fernet().decrypt(value[len("fernet:"):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise EncryptionConfigurationError("Cannot decrypt the configured API key.") from exc
