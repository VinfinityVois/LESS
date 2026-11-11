"""Offline evaluation helpers for face-match threshold calibration.

Input consists only of labeled similarity scores. Raw face images and embeddings
must never be committed to the repository or included in evaluation reports.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
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


def evaluate_threshold(
    genuine_scores: Iterable[float],
    impostor_scores: Iterable[float],
    threshold: float,
) -> ThresholdMetrics:
    genuine = [float(score) for score in genuine_scores]
    impostor = [float(score) for score in impostor_scores]
    if not genuine or not impostor:
        raise ValueError("Нужны непустые genuine и impostor выборки.")
    if not -1.0 <= threshold <= 1.0:
        raise ValueError("Порог должен находиться в диапазоне [0, 1].")
    if any(not -1.0 <= score <= 1.0 for score in genuine + impostor):
        raise ValueError("Все cosine similarity должны находиться в диапазоне [0, 1].")

    false_accepts = sum(score >= threshold for score in impostor)
    false_rejects = sum(score < threshold for score in genuine)
    far = false_accepts / len(impostor)
    frr = false_rejects / len(genuine)
    return ThresholdMetrics(
        threshold=threshold,
        genuine_count=len(genuine),
        impostor_count=len(impostor),
        false_accepts=false_accepts,
        false_rejects=false_rejects,
        far=far,
        frr=frr,
        tar=1.0 - frr,
    )


def wilson_interval(errors: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval by default; meaningful even when errors == 0."""
    if total <= 0 or errors < 0 or errors > total:
        raise ValueError("Некорректные errors/total для доверительного интервала.")
    p = errors / total
    z2 = z * z
    denominator = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denominator
    margin = z * ((p * (1.0 - p) / total + z2 / (4.0 * total * total)) ** 0.5) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def calibrate_threshold(
    genuine_scores: Iterable[float],
    impostor_scores: Iterable[float],
    target_far: float,
) -> dict:
    """Choose the lowest threshold that satisfies target FAR, then report EER.

    This is an offline recommendation only. It never changes production settings.
    """
    genuine = [float(score) for score in genuine_scores]
    impostor = [float(score) for score in impostor_scores]
    if not genuine or not impostor:
        raise ValueError("Нужны непустые genuine и impostor выборки.")
    if not 0.0 <= target_far <= 1.0:
        raise ValueError("target_far должен находиться в диапазоне [0, 1].")
    all_scores = genuine + impostor
    if any(not -1.0 <= score <= 1.0 for score in all_scores):
        raise ValueError("Все cosine similarity должны находиться в диапазоне [0, 1].")

    candidates = sorted({-1.0, 1.0, *all_scores})
    curve = [evaluate_threshold(genuine, impostor, value) for value in candidates]
    eligible = [row for row in curve if row.far <= target_far]
    recommended = min(eligible, key=lambda row: (row.frr, -row.threshold)) if eligible else None
    eer_point = min(curve, key=lambda row: abs(row.far - row.frr))
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
        "curve": [asdict(row) for row in curve],
        "warning": (
            "Офлайн-оценка на переданных score; не является доказательством "
            "качества на другой камере/популяции и не меняет production threshold."
        ),
    }
