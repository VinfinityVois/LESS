"""Build an APCER/BPCER report from an adjudicated PAD trial CSV.

CSV: class,bona_fide|attack; accepted,true|false; attack_type,required for attacks.
Do not put images, biometric templates, names or raw personal data in this file.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from app.services.pad_metrics import evaluate_pad_trials


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline PAD APCER/BPCER evaluation")
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    with args.csv_file.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"class", "accepted", "attack_type"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("CSV должен содержать class, accepted, attack_type.")
        report = evaluate_pad_trials(reader)

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
