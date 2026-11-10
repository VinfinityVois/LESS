"""Download the official MediaPipe Face Landmarker model used by server liveness checks."""
from pathlib import Path
from urllib.request import Request, urlopen
import os

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BACKEND_DIR / "models"
MODEL_PATH = MODEL_DIR / "face_landmarker.task"
TEMP_PATH = MODEL_PATH.with_suffix(".task.part")


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size > 1_000_000:
        print(f"Model already present: {MODEL_PATH}")
        return
    request = Request(MODEL_URL, headers={"User-Agent": "LESS-model-setup/1.0"})
    try:
        with urlopen(request, timeout=60) as response, TEMP_PATH.open("wb") as target:
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 100 * 1024 * 1024:
                    raise RuntimeError("Unexpectedly large model download.")
                target.write(chunk)
        if total < 1_000_000:
            raise RuntimeError("Downloaded model is incomplete.")
        os.replace(TEMP_PATH, MODEL_PATH)
        print(f"MediaPipe Face Landmarker model installed: {MODEL_PATH} ({total:,} bytes)")
    finally:
        if TEMP_PATH.exists():
            TEMP_PATH.unlink()


if __name__ == "__main__":
    main()
