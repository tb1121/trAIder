from __future__ import annotations

import hashlib
import hmac
import secrets


def normalize_email(email: str) -> str:
    return email.strip().lower()


def build_display_name(display_name: str | None, email: str) -> str:
    cleaned = (display_name or "").strip()
    if cleaned:
        return cleaned
    return email.split("@", 1)[0].replace(".", " ").title() or "Trader"


def hash_password(password: str, salt: str | None = None) -> str:
    actual_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        actual_salt.encode("utf-8"),
        200_000,
    )
    return f"{actual_salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _ = stored_hash.split("$", 1)
    except ValueError:
        return False

    return hmac.compare_digest(hash_password(password, salt), stored_hash)
