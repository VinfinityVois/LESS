"""Experimental, explainable-by-features access anomaly baseline.

Isolation Forest is advisory only. It never participates in access decisions.
The model is fitted in-memory on the current cohort and is not persisted.
"""
from __future__ import annotations

from collections import defaultdict
import hashlib
from datetime import datetime, timezone
from statistics import median
from typing import Any

MIN_SUBJECTS = 12
MIN_EVENTS_PER_SUBJECT = 3
FEATURE_NAMES = (
    "event_count",
    "denied_ratio",
    "night_ratio",
    "distinct_doors",
    "distinct_factors",
    "interval_cv",
    "weekend_ratio",
)


def _parse_time(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _subject_key(row: dict) -> str | None:
    if row.get("user_id") is not None:
        return f"user-ref:{int(row['user_id'])}"
    uid = str(row.get("nfc_uid") or "").strip()
    return "card:" + hashlib.sha256(uid.encode("utf-8")).hexdigest()[:12] if uid else None


def _features(rows: list[dict]) -> list[float]:
    timestamps = sorted(ts.timestamp() for row in rows if (ts := _parse_time(row.get("created_at"))))
    intervals = [right - left for left, right in zip(timestamps, timestamps[1:])]
    interval_cv = 0.0
    if len(intervals) >= 2 and median(intervals) > 0:
        avg = sum(intervals) / len(intervals)
        variance = sum((value - avg) ** 2 for value in intervals) / len(intervals)
        interval_cv = min(10.0, (variance ** 0.5) / max(avg, 1.0))
    parsed = [_parse_time(row.get("created_at")) for row in rows]
    valid_times = [ts for ts in parsed if ts]
    count = len(rows)
    return [
        float(count),
        sum(row.get("event_type") == "denied" for row in rows) / count,
        sum(0 <= ts.hour < 5 for ts in valid_times) / max(len(valid_times), 1),
        float(len({str(row.get("door_id") or "unknown") for row in rows})),
        float(len({str(row.get("factor_used") or "unknown") for row in rows})),
        interval_cv,
        sum(ts.weekday() >= 5 for ts in valid_times) / max(len(valid_times), 1),
    ]


class MLAnomalyDetector:
    def __init__(self, min_subjects: int = MIN_SUBJECTS, min_events: int = MIN_EVENTS_PER_SUBJECT):
        self.min_subjects = min_subjects
        self.min_events = min_events

    def analyze(self, logs: list[dict]) -> dict:
        grouped: dict[str, list[dict]] = defaultdict(list)
        for row in logs:
            key = _subject_key(row)
            if key:
                grouped[key].append(row)

        cohorts = [(key, rows) for key, rows in grouped.items() if len(rows) >= self.min_events]
        if len(cohorts) < self.min_subjects:
            return {
                "status": "insufficient_data",
                "subjects_observed": len(cohorts),
                "minimum_subjects": self.min_subjects,
                "minimum_events_per_subject": self.min_events,
                "anomalies": [],
                "message": "Недостаточно истории для устойчивого ML-сравнения. Анализ не выполнялся.",
            }

        try:
            from sklearn.ensemble import IsolationForest
        except ImportError:
            return {
                "status": "unavailable",
                "anomalies": [],
                "message": "scikit-learn не установлен; ML-анализ недоступен.",
            }

        vectors = [_features(rows) for _, rows in cohorts]
        model = IsolationForest(
            n_estimators=200,
            contamination="auto",
            random_state=42,
            n_jobs=1,
        )
        model.fit(vectors)
        labels = model.predict(vectors)
        raw_scores = model.decision_function(vectors)
        low, high = min(raw_scores), max(raw_scores)
        anomalies = []

        for index, ((key, rows), vector, label, raw_score) in enumerate(zip(cohorts, vectors, labels, raw_scores)):
            if int(label) != -1:
                continue
            if high - low < 1e-12:
                relative_risk = 50
            else:
                relative_risk = round((high - float(raw_score)) / (high - low) * 100)
            peers = [_features(other_rows) for j, (_, other_rows) in enumerate(cohorts) if j != index]
            deviations = []
            for feature_index, name in enumerate(FEATURE_NAMES):
                peer_median = median(row[feature_index] for row in peers)
                deviation = abs(vector[feature_index] - peer_median)
                if deviation > 0:
                    deviations.append({
                        "feature": name,
                        "observed": round(vector[feature_index], 4),
                        "cohort_median": round(peer_median, 4),
                        "absolute_deviation": round(deviation, 4),
                    })
            deviations.sort(key=lambda item: item["absolute_deviation"], reverse=True)
            anomalies.append({
                "subject_ref": key,
                "relative_anomaly_score": relative_risk,
                "model": "IsolationForest",
                "model_version": "sklearn-runtime",
                "event_ids": [int(row["id"]) for row in rows if row.get("id") is not None],
                "signals": deviations[:3],
                "sample_size": len(rows),
            })

        anomalies.sort(key=lambda item: item["relative_anomaly_score"], reverse=True)
        return {
            "status": "ok",
            "model": "IsolationForest",
            "model_version": "sklearn-runtime",
            "subjects_observed": len(cohorts),
            "anomaly_count": len(anomalies),
            "anomalies": anomalies,
            "score_note": "Относительная оценка внутри текущей выборки, не вероятность нарушения.",
            "message": "Результаты являются аналитическими сигналами для оператора, не решением о доступе.",
        }


ml_anomaly_detector = MLAnomalyDetector()
