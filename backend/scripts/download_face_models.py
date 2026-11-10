"""Fetch pinned YuNet/SFace model assets from OpenCV Zoo.

The source repository labels its model directories Apache-2.0; upstream model
training-data provenance has open clarification requests. Review model terms
before production/commercial deployment. We do not commit model weights.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import os

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
ASSETS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in ASSETS.items():
        target = MODELS / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
            print(f"OK: {name}")
            continue
        temp = target.with_suffix(target.suffix + ".part")
        request = Request(url, headers={"User-Agent": "LESS-face-model-setup/1.0"})
        digest = hashlib.sha256()
        total = 0
        try:
            with urlopen(request, timeout=90) as response, temp.open("wb") as out:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 100 * 1024 * 1024:
                        raise RuntimeError(f"Unexpectedly large model: {name}")
                    digest.update(chunk)
                    out.write(chunk)
            actual = digest.hexdigest()
            if actual != expected:
                raise RuntimeError(f"SHA-256 mismatch for {name}: {actual}")
            os.replace(temp, target)
            print(f"Installed {name} ({total:,} bytes)")
        finally:
            if temp.exists():
                temp.unlink()
    print("Models ready. Review upstream model license/training-data provenance before production use.")


if __name__ == "__main__":
    main()
