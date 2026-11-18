"""Local YuNet + SFace 128-D face detection and embedding extraction.

Model files are downloaded separately by scripts/download_face_models.py.
No image or embedding is sent to an external service.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Optional
from threading import RLock

import cv2
import numpy as np


class FaceRecognitionService:
    DETECTOR_PATH = Path(__file__).resolve().parents[2] / "models" / "face_detection_yunet_2023mar.onnx"
    RECOGNIZER_PATH = Path(__file__).resolve().parents[2] / "models" / "face_recognition_sface_2021dec.onnx"
    MAX_IMAGE_BYTES = 5_000_000
    MATCH_THRESHOLD = 0.363
    AMBIGUITY_MARGIN = 0.08

    def __init__(self) -> None:
        self._detector = None
        self._recognizer = None
        self._lock = RLock()

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

    def detect_faces(self, image: np.ndarray) -> list[dict[str, float]]:
        with self._lock:
            self._load()
            height, width = image.shape[:2]
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
            if faces is None:
                return []
            output = []
            for face in faces:
                x, y, w, h, score = [float(v) for v in face[:5]]
                output.append({
                    "x": round(max(0.0, x / width), 5),
                    "y": round(max(0.0, y / height), 5),
                    "width": round(min(1.0, w / width), 5),
                    "height": round(min(1.0, h / height), 5),
                    "score": round(score, 4),
                })
            return output

    def _embedding_from_faces(self, image: np.ndarray, faces_raw) -> Optional[dict[str, Any]]:
        height, width = image.shape[:2]
        if faces_raw is None or len(faces_raw) != 1:
            return None
        face = faces_raw[0]
        x, y, w, h = [float(v) for v in face[:4]]
        if w < 90 or h < 90 or w * h / float(width * height) < 0.025:
            return None
        aligned = self._recognizer.alignCrop(image, face)
        vector = self._recognizer.feature(aligned).astype(np.float32).reshape(-1)
        if vector.size != 128 or not np.all(np.isfinite(vector)):
            return None
        norm = float(np.linalg.norm(vector))
        if norm < 1e-8:
            return None
        vector = vector / norm
        return {
            "embedding": vector,
            "face_box": [
                round(x / width, 5),
                round(y / height, 5),
                round(w / width, 5),
                round(h / height, 5),
            ],
            "face_area": round(w * h / float(width * height), 4),
            "score": round(float(face[4]), 4),
        }

    def embedding_from_bgr(self, image: np.ndarray) -> Optional[dict[str, Any]]:
        """Extract single-face embedding from BGR frame; None if unusable."""
        with self._lock:
            self._load()
            height, width = image.shape[:2]
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
            result = self._embedding_from_faces(image, faces)
            if result is None:
                return None
            out = dict(result)
            out["embedding"] = result["embedding"].tolist()
            return out

    def embedding_from_image(self, data_url: str) -> dict[str, Any]:
        with self._lock:
            self._load()
            image = self.decode_image(data_url)
            height, width = image.shape[:2]
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
            if faces is None or len(faces) != 1:
                raise ValueError("face_count_invalid")
            result = self._embedding_from_faces(image, faces)
            if result is None:
                raise ValueError("face_too_small")
            return {
                "embedding": result["embedding"].tolist(),
                "face_box": result["face_box"],
                "face_area": result["face_area"],
                "image_size": [width, height],
            }

    @staticmethod
    def cosine_similarity(left, right) -> float:
        a = np.asarray(left, dtype=np.float32).reshape(-1)
        b = np.asarray(right, dtype=np.float32).reshape(-1)
        if a.size != 128 or b.size != 128:
            return -1.0
        na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
        if na < 1e-8 or nb < 1e-8:
            return -1.0
        return float(np.dot(a, b) / (na * nb))

    def match(self, probe, gallery: list[tuple[int, list]]) -> dict[str, Any]:
        best_id, best_score, second = None, -1.0, -1.0
        for uid, emb in gallery:
            score = self.cosine_similarity(probe, emb)
            if score > best_score:
                second = best_score
                best_score = score
                best_id = uid
            elif score > second:
                second = score
        ok = (
            best_id is not None
            and best_score >= self.MATCH_THRESHOLD
            and (best_score - second) >= self.AMBIGUITY_MARGIN
        )
        return {
            "matched": ok,
            "user_id": best_id if ok else None,
            "score": round(best_score, 4),
            "margin": round(best_score - second, 4) if second >= 0 else None,
            "threshold": self.MATCH_THRESHOLD,
        }


face_recognition_service = FaceRecognitionService()
