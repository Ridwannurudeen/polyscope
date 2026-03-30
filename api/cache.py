"""In-memory cache with TTL for API responses."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CacheEntry:
    data: Any
    expires_at: float


class MemoryCache:
    """Simple TTL cache — no Redis needed for single-process."""

    def __init__(self):
        self._store: dict[str, CacheEntry] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if time.time() > entry.expires_at:
            del self._store[key]
            return None
        return entry.data

    def set(self, key: str, data: Any, ttl_seconds: int = 120):
        self._store[key] = CacheEntry(
            data=data,
            expires_at=time.time() + ttl_seconds,
        )

    def invalidate(self, key: str):
        self._store.pop(key, None)

    def clear(self):
        self._store.clear()

    def cleanup(self):
        """Remove expired entries."""
        now = time.time()
        expired = [k for k, v in self._store.items() if now > v.expires_at]
        for k in expired:
            del self._store[k]


# Global cache instance
cache = MemoryCache()
