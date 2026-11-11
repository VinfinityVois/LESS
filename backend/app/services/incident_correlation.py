"""Correlate security signals into explainable operator incidents.

This engine is advisory. Risk values are heuristic, not probabilities or
access-policy decisions.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
from typing import Any

from app.config import settings


def _parse_time(value: Any) -> datetime | None:
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if result.tzinfo is None:
            result = result.replace(tzinfo=timezone.utc)
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _subject_ref(row: dict) -> str | None:
    if row.get("user_id") is not None:
        return f"user-ref:{int(row['user_id'])}"
    uid = str(row.get("nfc_uid") or "").strip()
    if uid:
        return "card:" + hashlib.sha256(uid.encode("utf-8")).hexdigest()[:12]
    return None


class IncidentCorrelationEngine:
    def build_incidents(self, logs: list[dict], ml_result: dict | None = None) -> list[dict]:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=settings.AI_ANOMALY_WINDOW_MINUTES)
        grouped: dict[str, list[tuple[dict, datetime]]] = defaultdict(list)
        for row in logs:
            timestamp = _parse_time(row.get("created_at"))
            subject = _subject_ref(row)
            if timestamp and timestamp >= cutoff and subject:
                grouped[subject].append((row, timestamp))

        ml_by_subject = {
            item.get("subject_ref"): item
            for item in (ml_result or {}).get("anomalies", [])
            if item.get("subject_ref")
        }
        incidents = []
        for subject, entries in grouped.items():
            entries.sort(key=lambda pair: pair[1])
            rows = [pair[0] for pair in entries]
            times = [pair[1] for pair in entries]
            denied = [row for row in rows if row.get("event_type") == "denied"]
            night = [
                row for row, timestamp in entries
                if row.get("event_type") == "granted" and 0 <= timestamp.hour < 5
            ]
            liveness_failures = [
                row for row in denied
                if "liveness" in str(row.get("reason") or "").lower()
                or "liveness" in str(row.get("factor_used") or "").lower()
                or "spoof" in str(row.get("reason") or "").lower()
            ]
            controller_events = [
                row for row in rows
                if any(token in str(row.get("reason") or "").lower()
                       for token in ("forced_open", "held_open", "controller_alarm", "invalid_ack", "replay"))
            ]
            doors = sorted({str(row.get("door_id")) for row in rows if row.get("door_id")})
            rapid_multi_door = False
            if len(doors) > 1:
                door_times: dict[str, list[datetime]] = defaultdict(list)
                for row, timestamp in entries:
                    if row.get("door_id"):
                        door_times[str(row["door_id"])].append(timestamp)
                first_by_door = [min(values) for values in door_times.values() if values]
                rapid_multi_door = len(first_by_door) > 1 and (max(first_by_door) - min(first_by_door)).total_seconds() <= 300

            ml_item = ml_by_subject.get(subject)
            factors = []
            risk = 0
            if len(denied) >= 3:
                points = 25 + (10 if len(denied) >= 5 else 0)
                risk += points
                factors.append({"code": "repeated_denials", "points": points, "count": len(denied)})
            if night:
                risk += 10
                factors.append({"code": "night_access", "points": 10, "count": len(night)})
            if liveness_failures:
                points = 20 + (10 if len(liveness_failures) >= 3 else 0)
                risk += points
                factors.append({"code": "liveness_failures", "points": points, "count": len(liveness_failures)})
            if controller_events:
                points = 60 if any("forced_open" in str(row.get("reason") or "").lower() for row in controller_events) else 45
                risk += points
                factors.append({"code": "controller_security_event", "points": points, "count": len(controller_events)})
            if rapid_multi_door:
                risk += 20
                factors.append({"code": "rapid_multi_door", "points": 20, "doors": doors})
            if ml_item:
                points = min(20, max(0, round(float(ml_item.get("relative_anomaly_score", 0)) * 0.2)))
                if points:
                    risk += points
                    factors.append({"code": "ml_anomaly", "points": points, "model": ml_item.get("model")})
            risk = min(100, risk)
            if risk < 20:
                continue

            severity = "critical" if risk >= 80 else "high" if risk >= 60 else "medium" if risk >= 35 else "low"
            event_ids = sorted({int(row["id"]) for row in rows if row.get("id") is not None})
            latest = times[-1]
            bucket = int(latest.timestamp() // 900)
            dedupe = hashlib.sha256(f"{subject}:{bucket}".encode("utf-8")).hexdigest()
            summary = "Обнаружены связанные сигналы: " + ", ".join(item["code"] for item in factors)
            incidents.append({
                "dedupe_key": dedupe,
                "subject_ref": subject,
                "title": "Коррелированная активность доступа",
                "summary": summary,
                "severity": severity,
                "risk_score": risk,
                "first_seen": times[0].isoformat(),
                "last_seen": latest.isoformat(),
                "evidence": {
                    "event_ids": event_ids,
                    "doors": doors,
                    "factors": factors,
                    "ml_model": ml_item.get("model") if ml_item else None,
                    "risk_scale": "heuristic_0_100_not_probability",
                },
            })

        incidents.sort(key=lambda item: item["risk_score"], reverse=True)
        return incidents


incident_correlation_engine = IncidentCorrelationEngine()
