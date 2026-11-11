"""Bounded local-only load test for LESS API rate limiting.

This is a controlled stress test, not a DDoS tool. It only sends GET requests
to the local /api/status endpoint and refuses non-loopback targets.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from collections import Counter
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def validate_target(target: str) -> str:
    parsed = urlparse(target)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Безопасный режим разрешает только http://127.0.0.1, localhost или [::1].")
    if parsed.path != "/api/status" or parsed.query or parsed.fragment:
        raise SystemExit("Разрешён только GET /api/status; другие пути запрещены.")
    return target


def request_once(target: str, timeout: float = 3.0) -> tuple[int, float]:
    started = time.perf_counter()
    request = Request(target, headers={"User-Agent": "LESS-local-safe-load-test/1.0"}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            response.read(1024)
            status = response.status
    except HTTPError as exc:
        status = exc.code
        exc.read(1024)
    except (URLError, TimeoutError, OSError):
        status = 0
    return status, (time.perf_counter() - started) * 1000


async def run(target: str, duration: int, concurrency: int, max_requests: int) -> dict:
    deadline = time.monotonic() + duration
    counter = 0
    counter_lock = asyncio.Lock()
    results: list[tuple[int, float]] = []

    async def worker() -> None:
        nonlocal counter
        while time.monotonic() < deadline:
            async with counter_lock:
                if counter >= max_requests:
                    return
                counter += 1
            result = await asyncio.to_thread(request_once, target)
            results.append(result)

    await asyncio.gather(*(worker() for _ in range(concurrency)))
    statuses = Counter(status for status, _ in results)
    latencies = sorted(latency for _, latency in results)

    def percentile(values: list[float], fraction: float) -> float:
        if not values:
            return 0.0
        return round(values[min(len(values) - 1, int((len(values) - 1) * fraction))], 2)

    return {
        "target": target,
        "requests": len(results),
        "duration_seconds": duration,
        "concurrency": concurrency,
        "status_counts": dict(sorted(statuses.items())),
        "rate_limited_429": statuses.get(429, 0),
        "errors": statuses.get(0, 0),
        "latency_ms": {
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
            "max": round(max(latencies), 2) if latencies else 0.0,
            "mean": round(statistics.fmean(latencies), 2) if latencies else 0.0,
        },
        "note": "Только локальная ограниченная нагрузка; не является DDoS-атакой.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="LESS local safe load test")
    parser.add_argument("--target", default="http://127.0.0.1:8000/api/status")
    parser.add_argument("--duration", type=int, default=10, help="1..30 seconds")
    parser.add_argument("--concurrency", type=int, default=4, help="1..8 workers")
    parser.add_argument("--max-requests", type=int, default=120, help="1..300 requests")
    args = parser.parse_args()

    if not 1 <= args.duration <= 30:
        parser.error("--duration must be between 1 and 30")
    if not 1 <= args.concurrency <= 8:
        parser.error("--concurrency must be between 1 and 8")
    if not 1 <= args.max_requests <= 300:
        parser.error("--max-requests must be between 1 and 300")

    target = validate_target(args.target)
    report = asyncio.run(run(target, args.duration, args.concurrency, args.max_requests))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
