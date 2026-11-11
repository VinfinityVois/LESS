"""Offline biometric verification metrics and threshold calibration.

Only labeled similarity scores are accepted. Raw images/embeddings must never
be stored in this report or committed to the repository.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from math import nextafter
from typing import Iterable


@dataclass(frozen=True)
class ThresholdMetrics:
    threshold: float
    genuine_count: int
    impostor_count: int
    false_accepts: int
    false_rejects: int
    far: float
    frr: float
    tar: float


def _validated_scores(genuine_scores: Iterable[float], impostor_scores: Iterable[float]) -> tuple[list[float], list[float]]:
    genuine = [float(score) for score in genuine_scores]
    impostor = [float(score) for score in impostor_scores]
    if not genuine or not impostor:
        raise ValueError("Нужны непустые genuine и impostor выборки.")
    if any(not -1.0 <= score <= 1.0 for score in genuine + impostor):
        raise ValueError("Cosine similarity должна находиться в диапазоне [-1, 1].")
    return genuine, impostor


def evaluate_threshold(
    genuine_scores: Iterable[float],
    impostor_scores: Iterable[float],
    threshold: float,
) -> ThresholdMetrics:
    genuine, impostor = _validated_scores(genuine_scores, impostor_scores)
    if not -1.0 <= threshold <= 1.0:
        raise ValueError("Порог должен находиться в диапазоне [-1, 1].")
    false_accepts = sum(score >= threshold for score in impostor)
    false_rejects = sum(score < threshold for score in genuine)
    frr = false_rejects / len(genuine)
    return ThresholdMetrics(
        threshold=threshold,
        genuine_count=len(genuine),
        impostor_count=len(impostor),
        false_accepts=false_accepts,
        false_rejects=false_rejects,
        far=false_accepts / len(impostor),
        frr=frr,
        tar=1.0 - frr,
    )


def wilson_interval(errors: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score confidence interval (95% by default)."""
    if total <= 0 or errors < 0 or errors > total or z <= 0:
        raise ValueError("Некорректные errors/total/z для доверительного интервала.")
    p = errors / total
    z2 = z * z
    denominator = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denominator
    margin = z * ((p * (1.0 - p) / total + z2 / (4.0 * total * total)) ** 0.5) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def _roc_auc(curve: list[dict]) -> float:
    points = sorted((row["far"], row["tar"]) for row in curve)
    area = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        area += (x2 - x1) * (y1 + y2) / 2.0
    return area


def calibrate_threshold(
    genuine_scores: Iterable[float],
    impostor_scores: Iterable[float],
    target_far: float,
) -> dict:
    """Return a ROC curve and an offline threshold recommendation.

    The recommendation is the lowest threshold satisfying target FAR, which
    maximizes acceptance of genuine samples under that empirical constraint.
    It never changes production configuration.
    """
    genuine, impostor = _validated_scores(genuine_scores, impostor_scores)
    if not 0.0 <= target_far <= 1.0:
        raise ValueError("target_far должен находиться в диапазоне [0, 1].")

    candidates = sorted({-1.0, 1.0, *genuine, *impostor})
    rows = [evaluate_threshold(genuine, impostor, value) for value in candidates]
    curve = [
        {
            "threshold": row.threshold,
            "far": row.far,
            "frr": row.frr,
            "tar": row.tar,
            "false_accepts": row.false_accepts,
            "false_rejects": row.false_rejects,
        }
        for row in rows
    ]
    # Add the mathematical ROC origin. A threshold strictly above 1.0 is
    # needed to reject even samples whose cosine similarity is exactly 1.0.
    roc_curve_rows = [
        {"far": 0.0, "tar": 0.0, "threshold": nextafter(1.0, float("inf"))},
        *curve,
    ]
    eligible = [row for row in rows if row.far <= target_far]
    recommended = min(eligible, key=lambda row: row.threshold) if eligible else None
    eer_point = min(rows, key=lambda row: abs(row.far - row.frr))
    far_ci = wilson_interval(recommended.false_accepts, recommended.impostor_count) if recommended else None
    frr_ci = wilson_interval(recommended.false_rejects, recommended.genuine_count) if recommended else None

    return {
        "sample_counts": {"genuine": len(genuine), "impostor": len(impostor)},
        "target_far": target_far,
        "recommended": asdict(recommended) if recommended else None,
        "recommended_far_wilson_95": far_ci,
        "recommended_frr_wilson_95": frr_ci,
        "eer_approximation": {
            "threshold": eer_point.threshold,
            "far": eer_point.far,
            "frr": eer_point.frr,
            "mean_error": (eer_point.far + eer_point.frr) / 2.0,
        },
        "roc_auc": _roc_auc(roc_curve_rows),
        "roc_curve": sorted(
            [{"false_accept_rate": row["far"], "true_accept_rate": row["tar"], "threshold": row["threshold"]} for row in roc_curve_rows],
            key=lambda point: (point["false_accept_rate"], point["true_accept_rate"]),
        ),
        "curve": curve,
        "warning": (
            "Офлайн-оценка только на переданных score. Доверительные интервалы "
            "не устраняют смещение выборки. Результат не меняет production threshold."
        ),
    }
