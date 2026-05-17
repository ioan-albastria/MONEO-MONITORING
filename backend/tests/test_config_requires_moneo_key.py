"""
Tests for config.py secret hygiene (Slice 5).

Verifies that instantiating Settings without MONEO_API_KEY raises a
ValidationError that names the missing field, so the operator knows
exactly what to fix.

NOTE: The lifespan startup probe (main.py) is NOT tested here — that
would require a full ASGI integration test and is an integration
concern. Smoke-test it manually by starting the server with and
without MONEO_API_KEY set.
"""
import os
import pytest
from pydantic import ValidationError


def test_settings_requires_moneo_api_key(monkeypatch):
    """
    Settings raised a ValidationError when MONEO_API_KEY is absent.
    The error message must name MONEO_API_KEY so the operator knows what to fix.
    """
    # Ensure MONEO_API_KEY is not present in the environment
    monkeypatch.delenv("MONEO_API_KEY", raising=False)

    # Import Settings fresh — bypass the module-level `settings = Settings()` singleton
    # by importing the class directly and constructing with _env_file=None so it doesn't
    # pick up a local .env file on the developer's machine.
    from config import Settings

    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)  # type: ignore[call-arg]

    error_text = str(exc_info.value)
    assert "moneo_api_key" in error_text.lower(), (
        f"Expected 'moneo_api_key' in ValidationError text, got:\n{error_text}"
    )


def test_settings_accepts_moneo_api_key_from_env(monkeypatch):
    """Settings instantiates successfully when MONEO_API_KEY is provided."""
    monkeypatch.setenv("MONEO_API_KEY", "test-token-value")
    # Also provide DATABASE_URL to avoid any other required-field surprises on CI
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:password@localhost/test")

    from config import Settings

    s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert s.moneo_api_key == "test-token-value"
