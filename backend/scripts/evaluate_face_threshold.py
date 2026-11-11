"""Evaluate an SFace score CSV without loading or storing face images.

CSV columns: label (genuine|impostor), similarity (-1..1).
Example: python scripts/evaluate_face_threshold.py scores.csv --target-far 0.001
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from app.services.biometric_metrics import calibrate_threshold


def load_scores(path: Path) -> tuple[list[float], list[float]]:
    genuine: list[float] = []
    impostor: list[float] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not {"label", "similarity"}.issubset(reader.fieldnames):
            raise ValueError("CSV должен содержать колонки label и similarity.")
        for line_number, row in enumerate(reader, start=2):
            label = (row.get("label") or "").strip().lower()
            try:
                score = float(row["similarity"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Некорректный similarity в строке {line_number}.") from exc
            if label == "genuine":
                genuine.append(score)
            elif label == "impostor":
                impostor.append(score)
            else:
                raise ValueError(f"Неизвестная метка в строке {line_number}: {label!r}.")
    return genuine, impostor


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline SFace FAR/FRR threshold evaluation")
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--target-far", type=float, default=0.001)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    genuine, impostor = load_scores(args.csv_file)
    report = calibrate_threshold(genuine, impostor, args.target_far)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
