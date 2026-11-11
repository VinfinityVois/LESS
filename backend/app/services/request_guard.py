"""Small in-process token bucket for protecting the local control API."""
from __future__ import annotations

import time
from collections import OrderedDict
from threading import Lock


class TokenBucketLimiter:
    def __init__(self, capacity: int = 40, refill_per_second: float = 2.0, max_keys: int = 4096):
        if capacity < 1 or refill_per_second <= 0 or max_keys < 1:
            raise ValueError("Invalid token bucket configuration")
        self.capacity = float(capacity)
        self.refill_per_second = float(refill_per_second)
        self.max_keys = max_keys
        self._buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        with self._lock:
            previous = self._buckets.pop(key, None)
            if previous is None:
                tokens = self.capacity
                updated_at = moment
            else:
                old_tokens, old_time = previous
                updated_at = max(old_time, moment)
                tokens = min(self.capacity, old_tokens + (updated_at - old_time) * self.refill_per_second)
            allowed = tokens >= 1.0
            if allowed:
                tokens -= 1.0
            self._buckets[key] = (tokens, updated_at)
            while len(self._buckets) > self.max_keys:
                self._buckets.popitem(last=False)
            return allowed

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()
