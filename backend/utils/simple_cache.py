"""Tiny in-memory TTL cache, suitable for analytics responses."""
import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_TTL_SECONDS: int = 60


def cache_get(key: str) -> Any | None:
    """Return cached value if still within TTL, else None."""
    entry = _store.get(key)
    if entry is None:
        return None
    ts, value = entry
    if time.time() - ts > _TTL_SECONDS:
        del _store[key]
        return None
    return value


def cache_set(key: str, value: Any) -> None:
    """Store value under key, timestamped now."""
    _store[key] = (time.time(), value)


def make_key(*parts: Any) -> str:
    """Stable string key from arbitrary positional parts."""
    return "|".join(str(p) for p in parts)
