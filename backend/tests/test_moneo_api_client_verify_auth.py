"""
Tests for MoneoApiClient.verify_auth() (Slice 5).

Four scenarios:
  1. 200 OK  → ok=True,  message contains "OK"
  2. 401     → ok=False, status_code=401, message contains "FAILED" and "Token Rotation"
  3. 503     → ok=False, status_code=503, message contains "unexpected HTTP 503"
  4. ConnectError → ok=False, status_code=None, message contains "transport error"
"""
import pytest
import pytest_asyncio
import httpx
from unittest.mock import AsyncMock, patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_response(status_code: int, body: str = "") -> httpx.Response:
    """Build a minimal httpx.Response stub."""
    return httpx.Response(status_code=status_code, text=body)


async def _patched_client_get(response):
    """Return an async callable that yields *response*."""
    async def _get(*args, **kwargs):
        return response
    return _get


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_verify_auth_200_returns_ok(monkeypatch):
    """HTTP 200 → ok=True, message contains 'OK'."""
    from services.moneo_api_client import MoneoApiClient

    client = MoneoApiClient.__new__(MoneoApiClient)
    client.base_url = "https://example.com/api/platform/v1"
    mock_inner = AsyncMock()
    mock_inner.get = AsyncMock(return_value=_make_response(200))
    client._client = mock_inner

    result = await client.verify_auth()

    assert result["ok"] is True
    assert result["status_code"] == 200
    assert "OK" in result["message"]
    mock_inner.get.assert_called_once()
    call_kwargs = mock_inner.get.call_args
    assert "pageSize" in str(call_kwargs)


@pytest.mark.asyncio
async def test_verify_auth_401_returns_failed(monkeypatch):
    """HTTP 401 → ok=False, status_code=401, message contains 'FAILED' and 'Token Rotation'."""
    from services.moneo_api_client import MoneoApiClient

    client = MoneoApiClient.__new__(MoneoApiClient)
    client.base_url = "https://example.com/api/platform/v1"
    mock_inner = AsyncMock()
    mock_inner.get = AsyncMock(return_value=_make_response(401, "Unauthorized"))
    client._client = mock_inner

    result = await client.verify_auth()

    assert result["ok"] is False
    assert result["status_code"] == 401
    assert "FAILED" in result["message"]
    assert "Token Rotation" in result["message"]


@pytest.mark.asyncio
async def test_verify_auth_503_returns_unexpected(monkeypatch):
    """HTTP 503 → ok=False, status_code=503, message contains 'unexpected HTTP 503'."""
    from services.moneo_api_client import MoneoApiClient

    client = MoneoApiClient.__new__(MoneoApiClient)
    client.base_url = "https://example.com/api/platform/v1"
    mock_inner = AsyncMock()
    mock_inner.get = AsyncMock(return_value=_make_response(503, "Service Unavailable"))
    client._client = mock_inner

    result = await client.verify_auth()

    assert result["ok"] is False
    assert result["status_code"] == 503
    assert "unexpected HTTP 503" in result["message"]


@pytest.mark.asyncio
async def test_verify_auth_connect_error_returns_transport_error(monkeypatch):
    """ConnectError → ok=False, status_code=None, message contains 'transport error'."""
    from services.moneo_api_client import MoneoApiClient

    client = MoneoApiClient.__new__(MoneoApiClient)
    client.base_url = "https://example.com/api/platform/v1"
    mock_inner = AsyncMock()
    mock_inner.get = AsyncMock(
        side_effect=httpx.ConnectError("Connection refused")
    )
    client._client = mock_inner

    result = await client.verify_auth()

    assert result["ok"] is False
    assert result["status_code"] is None
    assert "transport error" in result["message"]
