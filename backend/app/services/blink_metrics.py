"""Dependency-light blink metrics for three short liveness capture bursts."""
from __future__ import annotations

from statistics import median
from typing import Any


def evaluate_blink_bursts(ears: list[float]) -> tuple[bool, dict[str, Any]]:
    """Accept one complete open-close-open blink in any 12-frame burst."""
    burst_results = []
    for burst_index in range(3):
        segment = ears[burst_index * 12:(burst_index + 1) * 12]
        if len(segment) < 8:
            continue
        smooth = [
            float(median(segment[max(0, i - 1):min(len(segment), i + 2)]))
            for i in range(len(segment))
        ]
        peak, trough = max(smooth), min(smooth)
        trough_index = smooth.index(trough)
        open_level = max(0.14, peak * 0.86)
        opened_before = any(value >= open_level for value in smooth[:trough_index])
        reopened_after = any(value >= open_level for value in smooth[trough_index + 1:])
        ratio = trough / max(peak, 1e-6)
        delta = peak - trough
        passed = peak > 0.14 and ratio < 0.86 and delta >= 0.07 and opened_before and reopened_after
        burst_results.append({
            "burst": burst_index + 1, "passed": bool(passed),
            "ear_min": round(trough, 4), "ear_max": round(peak, 4),
            "ratio": round(ratio, 4), "signal_delta": round(delta, 4),
            "opened_before": bool(opened_before), "reopened_after": bool(reopened_after),
        })
    successful = [item for item in burst_results if item["passed"]]
    best = max(burst_results, key=lambda item: (item["passed"], item["signal_delta"]), default={
        "ear_min": 0.0, "ear_max": 0.0, "ratio": 1.0, "signal_delta": 0.0,
        "opened_before": False, "reopened_after": False, "burst": 0, "passed": False,
    })
    score = min(100.0, (
        max(0.0, min(100.0, (0.86 - best["ratio"]) / 0.24 * 70.0))
        + min(30.0, best["signal_delta"] / 0.18 * 30.0)
    )) if best["reopened_after"] else min(60.0, max(0.0, best["signal_delta"] / 0.18 * 60.0))
    return bool(successful), {
        **best, "successful_bursts": len(successful),
        "burst_results": burst_results, "blink_score": round(score, 1),
    }
