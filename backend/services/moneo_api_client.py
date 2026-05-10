import logging
from datetime import datetime
from typing import Any, Optional

import httpx

from config import settings

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
        """Fetch all devices/assets registered in MONEO."""
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

    async def get_sensor_readings(
        self,
        sensor_id: str,
        from_timestamp: datetime,
        to_timestamp: datetime,
    ) -> list[dict]:
        """Fetch sensor readings within a time range."""
        try:
            params = {
                "from": from_timestamp.isoformat(),
                "to": to_timestamp.isoformat(),
            }
            response = await self._client.get(
                f"{self.base_url}/sensors/{sensor_id}/readings",
                params=params,
            )
            response.raise_for_status()
            return response.json().get("readings", [])
        except httpx.HTTPStatusError as e:
            logger.error("MONEO get_sensor_readings HTTP error %s: %s", e.response.status_code, e)
            raise
        except Exception as e:
            logger.error("MONEO get_sensor_readings error: %s", e)
            raise

    async def get_latest_sensor_reading(self, sensor_id: str) -> Optional[dict]:
        """Fetch the most recent reading for a sensor. Returns None on failure."""
        try:
            response = await self._client.get(f"{self.base_url}/sensors/{sensor_id}/latest")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.warning(
                "MONEO latest reading HTTP error %s for sensor %s",
                e.response.status_code,
                sensor_id,
            )
            return None
        except Exception as e:
            logger.warning("MONEO latest reading error for sensor %s: %s", sensor_id, e)
            return None

    async def raw_get(self, path: str, params: dict[str, str] | None = None) -> Any:
        """Proxy a raw GET request to the MONEO API."""
        try:
            response = await self._client.get(f"{self.base_url}/{path.lstrip('/')}", params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error("MONEO raw GET HTTP error %s for path %s: %s", e.response.status_code, path, e)
            raise
        except Exception as e:
            logger.error("MONEO raw GET error for path %s: %s", path, e)
            raise

    async def raw_get_response(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        """Proxy a raw GET request and return HTTP response diagnostics."""
        response = await self._client.get(f"{self.base_url}/{path.lstrip('/')}", params=params)
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

    async def close(self):
        await self._client.aclose()
