"""Local YuNet + SFace 128-D face detection and embedding extraction.

Model files are downloaded separately by scripts/download_face_models.py.
No image or embedding is sent to an external service.
"""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from loguru import logger


class FaceRecognitionService:
    DETECTOR_PATH = Path(__file__).resolve().parents[2] / "models" / "face_detection_yunet_2023mar.onnx"
    RECOGNIZER_PATH = Path(__file__).resolve().parents[2] / "models" / "face_recognition_sface_2021dec.onnx"
    MAX_IMAGE_BYTES = 5_000_000
    MATCH_THRESHOLD = 0.42
    AMBIGUITY_MARGIN = 0.08

    def __init__(self) -> None:
        self._detector = None
        self._recognizer = None

    @property
    def ready(self) -> bool:
        return self.DETECTOR_PATH.is_file() and self.RECOGNIZER_PATH.is_file()

    def _load(self) -> None:
        if not self.ready:
            raise RuntimeError("face_models_missing")
        if self._detector is None:
            self._detector = cv2.FaceDetectorYN_create(
                str(self.DETECTOR_PATH), "", (320, 320), 0.82, 0.3, 5000
            )
        if self._recognizer is None:
            self._recognizer = cv2.FaceRecognizerSF_create(str(self.RECOGNIZER_PATH), "")

    @classmethod
    def decode_image(cls, data_url: str) -> np.ndarray:
        if not isinstance(data_url, str) or "," not in data_url or not data_url.startswith("data:image/"):
            raise ValueError("Ожидается data URL кадра камеры.")
        try:
            raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        except Exception as exc:
            raise ValueError("Не удалось декодировать изображение лица.") from exc
        if not raw or len(raw) > cls.MAX_IMAGE_BYTES:
            raise ValueError("Кадр лица пуст или превышает 5 МБ.")
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise ValueError("Кадр лица не является корректным изображением.")
        return image

    def embedding_from_image(self, data_url: str) -> dict[str, Any]:
        self._load()
        image = self.decode_image(data_url)
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(image)
        if faces is None or len(faces) != 1:
            raise ValueError("face_count_invalid")
        face = faces[0]
        x, y, w, h = [float(v) for v in face[:4]]
        if w < 90 or h < 90 or w * h / float(width * height) < 0.025:
            raise ValueError("face_too_small")
        aligned = self._recognizer.alignCrop(image, face)
        vector = self._recognizer.feature(aligned).astype(np.float32).reshape(-1)
        if vector.size != 128 or not np.all(np.isfinite(vector)):
            raise RuntimeError("sface_embedding_invalid")
        norm = float(np.linalg.norm(vector))
        if norm < 1e-8:
            raise RuntimeError("sface_embedding_invalid")
        vector = vector / norm
        return {
            "embedding": vector.tolist(),
            "face_box": [round(x / width, 5), round(y / height, 5), round(w / width, 5), round(h / height, 5)],
            "face_area": round(w * h / float(width * height), 4),
            "image_size": [width, height],
        }

    @staticmethod
    def cosine_similarity(left: list[float], right: list[float]) -> float:
        a = np.asarray(left, dtype=np.float32).reshape(-1)
        b = np.asarray(right, dtype=np.float32).reshape(-1)
        if a.size != 128 or b.size != 128:
            return -1.0
        na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
        if na < 1e-8 or nb < 1e-8:
            return -1.0
        return float(np.dot(a, b) / (na * nb))


face_recognition_service = FaceRecognitionService()
