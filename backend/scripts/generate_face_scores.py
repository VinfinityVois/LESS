"""Generate labeled SFace similarity scores from a local image-pair manifest.

Input CSV columns: label (genuine|impostor), image_a, image_b.
Optional columns: condition, camera.
All image paths are relative to --dataset-root and must remain inside it.
Images and embeddings are processed locally and are never copied to output.
"""
from __future__ import annotations

import argparse
import base64
import csv
import mimetypes
import sys
from pathlib import Path

from app.services.face_recognition_service import face_recognition_service


def _safe_image_path(root: Path, value: str, line_number: int) -> Path:
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Строка {line_number}: путь изображения выходит за пределы dataset-root.") from exc
    if not candidate.is_file():
        raise ValueError(f"Строка {line_number}: файл изображения не найден.")
    if candidate.stat().st_size <= 0 or candidate.stat().st_size > face_recognition_service.MAX_IMAGE_BYTES:
        raise ValueError(f"Строка {line_number}: размер изображения недопустим.")
    mime, _ = mimetypes.guess_type(candidate.name)
    if mime not in {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"}:
        raise ValueError(f"Строка {line_number}: поддерживаются только JPEG, PNG, WEBP, BMP и TIFF.")
    return candidate


def _embedding(path: Path) -> list[float]:
    raw = path.read_bytes()
    data_url = f"data:image/{mimetypes.guess_type(path.name)[0].split('/', 1)[1]};base64," + base64.b64encode(raw).decode("ascii")
    result = face_recognition_service.embedding_from_image(data_url)
    return result["embedding"]


def generate_scores(manifest: Path, dataset_root: Path):
    root = dataset_root.resolve()
    if not root.is_dir():
        raise ValueError("dataset-root должен быть существующей папкой.")
    cache: dict[Path, list[float]] = {}
    with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"label", "image_a", "image_b"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("Manifest CSV должен содержать label, image_a, image_b.")
        for line_number, row in enumerate(reader, start=2):
            label = (row.get("label") or "").strip().lower()
            if label not in {"genuine", "impostor"}:
                raise ValueError(f"Строка {line_number}: label должен быть genuine или impostor.")
            left_path = _safe_image_path(root, row.get("image_a") or "", line_number)
            right_path = _safe_image_path(root, row.get("image_b") or "", line_number)
            try:
                if left_path not in cache:
                    cache[left_path] = _embedding(left_path)
                if right_path not in cache:
                    cache[right_path] = _embedding(right_path)
                score = face_recognition_service.cosine_similarity(cache[left_path], cache[right_path])
            except Exception as exc:
                raise ValueError(f"Строка {line_number}: не удалось получить embedding ({type(exc).__name__}).") from exc
            yield {
                "label": label,
                "similarity": f"{score:.8f}",
                "condition": (row.get("condition") or "").strip(),
                "camera": (row.get("camera") or "").strip(),
            }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate local SFace genuine/impostor scores")
    parser.add_argument("manifest", type=Path, help="CSV with label,image_a,image_b")
    parser.add_argument("--dataset-root", required=True, type=Path)
    parser.add_argument("--output", type=Path, required=True, help="Output score CSV; keep it outside Git")
    args = parser.parse_args()

    repository_root = Path(__file__).resolve().parents[2]
    dataset_root = args.dataset_root.resolve()
    output_path = args.output.resolve()
    manifest_path = args.manifest.resolve()
    if output_path == manifest_path:
        parser.error("Файл результатов не может перезаписывать manifest.")
    try:
        manifest_path.relative_to(repository_root)
        parser.error("Manifest с путями биометрического датасета должен храниться вне репозитория LESS.")
    except ValueError:
        pass
    try:
        dataset_root.relative_to(repository_root)
        parser.error("Биометрический датасет должен храниться вне репозитория LESS.")
    except ValueError:
        pass
    try:
        output_path.relative_to(repository_root)
        parser.error("Файл similarity scores должен храниться вне репозитория LESS.")
    except ValueError:
        pass

    if not face_recognition_service.ready:
        parser.error("YuNet/SFace models are missing. Run python scripts/download_face_models.py first.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    counts = {"genuine": 0, "impostor": 0}
    try:
        with output_path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=["label", "similarity", "condition", "camera"])
            writer.writeheader()
            for result in generate_scores(args.manifest, args.dataset_root):
                writer.writerow(result)
                counts[result["label"]] += 1
        if not counts["genuine"] or not counts["impostor"]:
            raise ValueError("Для калибровки нужны и genuine, и impostor пары.")
    except (OSError, ValueError) as exc:
        output_path.unlink(missing_ok=True)
        print(str(exc), file=sys.stderr)
        return 2
    print(f"Similarity scores written: {output_path} (images and embeddings were not copied)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
