"""Offline PAD evaluation from labeled presentation-attack test outcomes.

No camera frames are loaded or stored here. Each row represents one completed
presentation attempt and its adjudicated outcome.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable


def evaluate_pad_trials(trials: Iterable[dict]) -> dict:
    rows = list(trials)
    if not rows:
        raise ValueError("Нужна хотя бы одна испытательная запись.")

    bona_fide = [row for row in rows if row.get("class") == "bona_fide"]
    attacks = [row for row in rows if row.get("class") == "attack"]
    unknown = [row for row in rows if row.get("class") not in {"bona_fide", "attack"}]
    if unknown:
        raise ValueError("class должен быть bona_fide или attack.")
    if not bona_fide or not attacks:
        raise ValueError("Нужны и bona_fide, и attack испытания.")

    def accepted(row: dict) -> bool:
        value = row.get("accepted")
        if isinstance(value, bool):
            return value
        if str(value).strip().lower() in {"true", "1", "yes", "accepted"}:
            return True
        if str(value).strip().lower() in {"false", "0", "no", "rejected"}:
            return False
        raise ValueError("accepted должен быть булевым значением.")

    bona_rejected = sum(not accepted(row) for row in bona_fide)
    attack_groups: dict[str, list[dict]] = defaultdict(list)
    for row in attacks:
        attack_type = str(row.get("attack_type") or "").strip()
        if not attack_type:
            raise ValueError("Для каждой attack-записи требуется attack_type.")
        attack_groups[attack_type].append(row)

    attack_breakdown = {}
    accepted_attacks = 0
    for attack_type, group in sorted(attack_groups.items()):
        false_accepts = sum(accepted(row) for row in group)
        accepted_attacks += false_accepts
        attack_breakdown[attack_type] = {
            "presentations": len(group),
            "false_accepts": false_accepts,
            "apcer": false_accepts / len(group),
        }

    apcer = accepted_attacks / len(attacks)
    bpcer = bona_rejected / len(bona_fide)
    return {
        "counts": {"total": len(rows), "bona_fide": len(bona_fide), "attacks": len(attacks)},
        "apcer": apcer,
        "bpcer": bpcer,
        "acer": (apcer + bpcer) / 2.0,
        "attack_species": attack_breakdown,
        "warning": (
            "Метрики описывают только переданные испытания. Они не подтверждают "
            "сертификацию PAD и не гарантируют устойчивость к неиспытанным атакам."
        ),
    }
