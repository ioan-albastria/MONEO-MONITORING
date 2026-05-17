import asyncio
import logging
import random
from typing import Any, Optional

import httpx

from config import settings

# Retry policy for get_processdata (applied per-call, not per-sensor-cycle).
#   Retryable:   ConnectError / ReadTimeout; HTTP 429, 500, 502, 503, 504.
#   Not retried: 401, 403, 404 — these are config bugs or auth failures that must
#                surface immediately rather than be silently retried (see Slice 5).
#   Strategy:    Full jitter — delay = uniform(0, base * 2^attempt), base=0.5 s.
#   On 429:      Retry-After header (seconds) is honoured as a lower bound on the delay.
#   Max attempts: 3 (initial try + up to 2 retries).
_RETRY_ON_STATUS = frozenset({429, 500, 502, 503, 504})
_NO_RETRY_STATUS = frozenset({401, 403, 404})
_MAX_ATTEMPTS = 3
_BASE_DELAY_S = 0.5

logger = logging.getLogger(__name__)


class MoneoApiClient:
    """HTTP client for the IFM MONEO API (https://api-docs.moneo.ifm/)."""

    def __init__(self):
        self.base_url = settings.moneo_api_base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {settings.moneo_api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def get_devices(self) -> list[dict]:
        """Fetch all topology nodes from MONEO (/nodes)."""
        try:
            response = await self._client.get(f"{self.base_url}/nodes")
            response.raise_for_status()
            return response.json().get("data", [])
        except httpx.HTTPStatusError as e:
            logger.error("MONEO get_devices HTTP error %s: %s", e.response.status_code, e)
            raise
        except Exception as e:
            logger.error("MONEO get_devices error: %s", e)
            raise

    async def get_processdata(
        self,
        device_id: str,
        datasource_id: str,
        from_ms: int | None = None,
        to_ms: int | None = None,
        order: str = "+timestamp",
        page: int = 1,
        page_size: int = 500,
    ) -> dict:
        """
        Fetch process data from MONEO for a specific device + datasource pair.

        WHY TWO IDS:
          Every MONEO node has a topology "id" (UUID). DataSource nodes also carry a
          separate reference.dataSource.id — a 128-char hex hash. These are different
          values. The /processdata endpoint requires:
            device_id     = reference.deviceId   (NOT the Device node's own "id")
            datasource_id = reference.dataSource.id  (NOT the DataSource node's own "id")
          Using the topology node ids returns 200 with totalCount=0 — a silent failure.
          Verified against the live sandbox (see tmp/moneo-samples/).

        TIMESTAMPS:
          fromTimestamp / toTimestamp are UTC int64 milliseconds since epoch.
          Response data[*].timestamp is also UTC int64 ms — parse with:
            datetime.fromtimestamp(ts / 1000, tz=timezone.utc)

        QUALITY FIELD:
          The API docs describe a per-reading "quality" field. The live API omits it
          entirely in observed responses. Do not rely on it being present.

        Returns the full envelope: {pageNumber, pageSize, totalPages, totalCount, data}.
        """
        params: dict[str, Any] = {
            "orderBy": order,
            "pageNumber": page,
            "pageSize": page_size,
        }
        if from_ms is not None:
            params["fromTimestamp"] = from_ms
        if to_ms is not None:
            params["toTimestamp"] = to_ms

        url = f"{self.base_url}/processdata/device/{device_id}/datasource/{datasource_id}"

        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = await self._client.get(url, params=params)
            except (httpx.ConnectError, httpx.ReadTimeout) as exc:
                if attempt == _MAX_ATTEMPTS - 1:
                    logger.error(
                        "MONEO get_processdata connection error after %d attempts "
                        "for device=%s datasource=%s: %s",
                        _MAX_ATTEMPTS, device_id, datasource_id, exc,
                    )
                    raise
                delay = random.uniform(0, _BASE_DELAY_S * (2 ** attempt))
                await asyncio.sleep(delay)
                continue

            if response.status_code in _NO_RETRY_STATUS:
                logger.error(
                    "MONEO get_processdata HTTP %s for device=%s datasource=%s (no retry)",
                    response.status_code, device_id, datasource_id,
                )
                response.raise_for_status()

            if response.status_code in _RETRY_ON_STATUS:
                if attempt == _MAX_ATTEMPTS - 1:
                    logger.error(
                        "MONEO get_processdata HTTP %s after %d attempts "
                        "for device=%s datasource=%s",
                        response.status_code, _MAX_ATTEMPTS, device_id, datasource_id,
                    )
                    response.raise_for_status()
                if response.status_code == 429:
                    try:
                        retry_after = float(response.headers.get("Retry-After", 0))
                    except (ValueError, TypeError):
                        retry_after = 0.0
                    delay = max(retry_after, random.uniform(0, _BASE_DELAY_S * (2 ** attempt)))
                else:
                    delay = random.uniform(0, _BASE_DELAY_S * (2 ** attempt))
                await asyncio.sleep(delay)
                continue

            response.raise_for_status()
            return response.json()

        # Unreachable: every branch on the final attempt raises or returns.
        raise RuntimeError("get_processdata exhausted retries without returning or raising")

    async def raw_get(self, path: str, params: dict[str, str] | None = None) -> Any:
        """Proxy a raw GET request to the MONEO API."""
        try:
            response = await self._client.get(
                f"{self.base_url}/{path.lstrip('/')}", params=params
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(
                "MONEO raw GET HTTP error %s for path %s: %s",
                e.response.status_code,
                path,
                e,
            )
            raise
        except Exception as e:
            logger.error("MONEO raw GET error for path %s: %s", path, e)
            raise

    async def raw_get_response(
        self, path: str, params: dict[str, str] | None = None
    ) -> dict[str, Any]:
        """Proxy a raw GET request and return HTTP response diagnostics."""
        response = await self._client.get(
            f"{self.base_url}/{path.lstrip('/')}", params=params
        )
        try:
            body = response.json()
        except ValueError:
            body = response.text
        return {
            "status_code": response.status_code,
            "url": str(response.url),
            "headers": dict(response.headers),
            "body": body,
        }

    async def verify_auth(self) -> dict:
        """
        One-shot probe that confirms the MONEO PAT is valid.

        Issues GET /nodes?pageSize=1 with a 5-second timeout cap.
        Does NOT retry on 401 (same policy as get_processdata for _NO_RETRY_STATUS).
        Returns a dict with keys: ok (bool), status_code (int|None), message (str).
        """
        url = f"{self.base_url}/nodes"
        try:
            response = await self._client.get(url, params={"pageSize": 1}, timeout=5.0)
        except Exception as exc:
            return {
                "ok": False,
                "status_code": None,
                "message": f"MONEO probe transport error: {type(exc).__name__}: {exc}",
            }

        if response.status_code == 200:
            return {"ok": True, "status_code": 200, "message": "MONEO auth OK"}

        if response.status_code == 401:
            return {
                "ok": False,
                "status_code": 401,
                "message": (
                    "MONEO auth FAILED (401) — token expired or revoked. "
                    "See backend/CLAUDE.md → MONEO Token Rotation."
                ),
            }

        body = response.text[:200]
        return {
            "ok": False,
            "status_code": response.status_code,
            "message": f"MONEO probe got unexpected HTTP {response.status_code}: {body}",
        }

    async def close(self):
        await self._client.aclose()
