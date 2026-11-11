"""Evaluate SFace score CSV and generate a reproducible ROC report.

Required CSV columns: label (genuine|impostor), similarity (-1..1).
Optional columns: condition and camera for separate subgroup reports.
Do not include names, NFC UIDs, face images or embeddings.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from html import escape
from pathlib import Path

from app.services.biometric_metrics import calibrate_threshold


def load_scores(path: Path):
    genuine: list[float] = []
    impostor: list[float] = []
    groups: dict[str, dict[str, list[float]]] = {
        "condition": defaultdict(lambda: {"genuine": [], "impostor": []}),
        "camera": defaultdict(lambda: {"genuine": [], "impostor": []}),
    }
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
            if label not in {"genuine", "impostor"}:
                raise ValueError(f"Неизвестная метка в строке {line_number}: {label!r}.")
            (genuine if label == "genuine" else impostor).append(score)
            for field in groups:
                group_name = (row.get(field) or "").strip()
                if group_name:
                    groups[field][group_name][label].append(score)
    return genuine, impostor, groups


def render_roc_svg(report: dict) -> str:
    width, height = 820, 620
    left, top, plot_w, plot_h = 90, 55, 650, 450
    right, bottom = left + plot_w, top + plot_h
    points = report.get("roc_curve", [])
    coords = [
        (left + float(point["false_accept_rate"]) * plot_w,
         bottom - float(point["true_accept_rate"]) * plot_h)
        for point in points
    ]
    polyline = " ".join(f"{x:.2f},{y:.2f}" for x, y in coords)
    grid = []
    for tick in range(5):
        fraction = tick / 4
        x = left + fraction * plot_w
        y = bottom - fraction * plot_h
        grid.append(f'<line x1="{x}" y1="{top}" x2="{x}" y2="{bottom}" stroke="#d9e1e7" stroke-dasharray="3 5"/>')
        grid.append(f'<line x1="{left}" y1="{y}" x2="{right}" y2="{y}" stroke="#d9e1e7" stroke-dasharray="3 5"/>')
        grid.append(f'<text x="{x}" y="{bottom + 24}" text-anchor="middle" font-size="12" fill="#40515c">{fraction:.2f}</text>')
        grid.append(f'<text x="{left - 14}" y="{y + 4}" text-anchor="end" font-size="12" fill="#40515c">{fraction:.2f}</text>')
    recommended = report.get("recommended") or {}
    threshold = recommended.get("threshold")
    threshold_label = "нет порога при заданном FAR" if threshold is None else f"рекомендованный порог: {threshold:.4f}"
    title = f"ROC · AUC {float(report.get('roc_auc', 0.0)):.4f}"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="{left}" y="30" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#17232b">{escape(title)}</text>
{''.join(grid)}
<line x1="{left}" y1="{bottom}" x2="{right}" y2="{top}" stroke="#9aa8b1" stroke-dasharray="7 6" stroke-width="2"/>
<polyline points="{polyline}" fill="none" stroke="#087f8c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
<line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" stroke="#40515c" stroke-width="1.5"/>
<line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="#40515c" stroke-width="1.5"/>
<text x="{left + plot_w/2}" y="{height - 38}" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#263943">False Accept Rate (FAR)</text>
<text x="24" y="{top + plot_h/2}" transform="rotate(-90 24 {top + plot_h/2})" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#263943">True Accept Rate (TAR)</text>
<text x="{left}" y="{height - 12}" font-family="Arial,sans-serif" font-size="11" fill="#52636b">{escape(threshold_label)}</text>
</svg>"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline SFace ROC/FAR/FRR evaluation")
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--target-far", type=float, default=0.001)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--plot", type=Path, help="Путь к ROC SVG; по умолчанию рядом с JSON-отчётом")
    args = parser.parse_args()

    genuine, impostor, groups = load_scores(args.csv_file)
    report = calibrate_threshold(genuine, impostor, args.target_far)
    for dimension, buckets in groups.items():
        subgroup_reports = {}
        for label, scores in buckets.items():
            if scores["genuine"] and scores["impostor"]:
                subgroup_reports[label] = calibrate_threshold(scores["genuine"], scores["impostor"], args.target_far)
            else:
                subgroup_reports[label] = {
                    "status": "insufficient_data",
                    "genuine_count": len(scores["genuine"]),
                    "impostor_count": len(scores["impostor"]),
                }
        if subgroup_reports:
            report[f"by_{dimension}"] = subgroup_reports

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)

    plot_path = args.plot or (args.output.with_suffix(".roc.svg") if args.output else None)
    if plot_path:
        plot_path.write_text(render_roc_svg(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
