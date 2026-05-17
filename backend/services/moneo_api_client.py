import logging
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

        try:
            response = await self._client.get(
                f"{self.base_url}/processdata/device/{device_id}/datasource/{datasource_id}",
                params=params,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(
                "MONEO get_processdata HTTP error %s for device=%s datasource=%s: %s",
                e.response.status_code,
                device_id,
                datasource_id,
                e,
            )
            raise
        except Exception as e:
            logger.error(
                "MONEO get_processdata error for device=%s datasource=%s: %s",
                device_id,
                datasource_id,
                e,
            )
            raise

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

    async def close(self):
        await self._client.aclose()
