"""Server-side active challenge-response checks for face enrollment.

This is a basic presentation-attack heuristic, not a certified PAD system.
It intentionally fails closed when the server-side face detector is unavailable.
"""
from __future__ import annotations

import base64
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
from pathlib import Path
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


class LivenessService:
    TTL_SECONDS = 600
    PROOF_TTL_SECONDS = 600
    MAX_FRAME_BYTES = 1_500_000
    MIN_ACTION_FRAMES = 8
    MAX_ACTION_FRAMES = 12
    MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "face_landmarker.task"
    ACTIONS = ("blink", "turn_head", "open_mouth", "smile")

    def __init__(self) -> None:
        self._challenges: dict[str, dict[str, Any]] = {}
        self._proofs: dict[str, dict[str, Any]] = {}

    def create(self, admin_id: int, subject_id: int) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        self._challenges = {
            key: value for key, value in self._challenges.items()
            if not value["used"] and value["expires_at"] > now
        }
        self._proofs = {
            key: value for key, value in self._proofs.items()
            if value["expires_at"] > now
        }
        challenge_id = secrets.token_urlsafe(32)
        actions = list(secrets.SystemRandom().sample(self.ACTIONS, len(self.ACTIONS)))
        expires = now + timedelta(seconds=self.TTL_SECONDS)
        self._challenges[challenge_id] = {
            "admin_id": admin_id, "subject_id": subject_id,
            "actions": actions, "expires_at": expires, "used": False,
        }
        return {
            "challenge_id": challenge_id, "actions": actions,
            "expires_at": expires.isoformat(),
            "instructions": {
                "blink": "Моргните один раз, глядя в камеру",
                "turn_head": "Медленно поверните голову в сторону и верните прямо",
                "open_mouth": "Откройте рот и закройте его",
                "smile": "Улыбнитесь и верните нейтральное выражение",
            },
        }

    @staticmethod
    def _ear(points: list[Any], indexes: tuple[int, ...]) -> float:
        a, b, c, d, e, f = (points[i] for i in indexes)
        vertical = np.linalg.norm(np.array([b.x - f.x, b.y - f.y])) + np.linalg.norm(np.array([c.x - e.x, c.y - e.y]))
        horizontal = 2.0 * np.linalg.norm(np.array([a.x - d.x, a.y - d.y]))
        return float(vertical / max(horizontal, 1e-6))

    @staticmethod
    def _yaw(points: list[Any]) -> float:
        left_eye, right_eye, nose = points[33], points[263], points[1]
        return float((nose.x - left_eye.x) / max(abs(right_eye.x - left_eye.x), 1e-6))

    @staticmethod
    def _mouth_open(points: list[Any]) -> float:
        top, bottom, left, right = points[13], points[14], points[78], points[308]
        height = np.linalg.norm(np.array([top.x - bottom.x, top.y - bottom.y]))
        width = np.linalg.norm(np.array([left.x - right.x, left.y - right.y]))
        return float(height / max(width, 1e-6))

    def _landmarks(self, frame_data: str, landmarker: Any) -> dict[str, Any]:
        if not isinstance(frame_data, str) or "," not in frame_data:
            raise ValueError("Некорректный кадр проверки присутствия.")
        try:
            raw = base64.b64decode(frame_data.split(",", 1)[1], validate=True)
        except Exception as exc:
            raise ValueError("Не удалось декодировать кадр проверки.") from exc
        if not raw or len(raw) > self.MAX_FRAME_BYTES:
            raise ValueError("Кадр превышает допустимый размер.")
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Кадр не является корректным изображением.")
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_image)
        faces = result.face_landmarks or []
        if len(faces) != 1:
            raise ValueError("В каждом кадре должно быть ровно одно обнаруженное лицо.")
        blendshapes = result.face_blendshapes or []
        smile_score = 0.0
        if blendshapes:
            categories = blendshapes[0].categories
            scores = {item.category_name: item.score for item in categories}
            smile_score = (scores.get("mouthSmileLeft", 0.0) + scores.get("mouthSmileRight", 0.0)) / 2.0
        return {"landmarks": faces[0], "smile": float(smile_score)}

    def verify(self, challenge_id: str, admin_id: int, subject_id: int, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        challenge = self._challenges.get(challenge_id)
        now = datetime.now(timezone.utc)
        if not challenge or challenge["used"] or challenge["admin_id"] != admin_id or challenge["subject_id"] != subject_id:
            return {"verified": False, "reason": "challenge_invalid"}
        if challenge["expires_at"] <= now:
            challenge["used"] = True
            return {"verified": False, "reason": "challenge_expired"}
        challenge["used"] = True
        if not isinstance(evidence, list) or len(evidence) != len(challenge["actions"]):
            return {"verified": False, "reason": "challenge_sequence_mismatch"}
        if [item.get("action") for item in evidence if isinstance(item, dict)] != challenge["actions"]:
            return {"verified": False, "reason": "challenge_sequence_mismatch"}

        results: list[dict[str, Any]] = []
        try:
            if not self.MODEL_PATH.is_file():
                return {"verified": False, "reason": "liveness_model_missing"}
            options = vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=str(self.MODEL_PATH)),
                running_mode=vision.RunningMode.IMAGE,
                num_faces=2,
                min_face_detection_confidence=0.65,
                min_face_presence_confidence=0.65,
                min_tracking_confidence=0.5,
                output_face_blendshapes=True,
            )
            landmarker = vision.FaceLandmarker.create_from_options(options)
            try:
                for action, item in zip(challenge["actions"], evidence):
                    frames = item.get("frames", [])
                    if not isinstance(frames, list) or len(frames) < self.MIN_ACTION_FRAMES or len(frames) > self.MAX_ACTION_FRAMES:
                        return {"verified": False, "reason": "insufficient_frames", "action": action, "received_frames": len(frames), "required_frames": self.MIN_ACTION_FRAMES}
                    samples = [self._landmarks(frame, landmarker) for frame in frames]
                    if action == "blink":
                        ears = [(self._ear(p["landmarks"], (33, 160, 158, 133, 153, 144)) + self._ear(p["landmarks"], (362, 385, 387, 263, 373, 380))) / 2.0 for p in samples]
                        # Twelve samples across ~1.5s make a short blink less likely to
                        # fall between frames. Keep both an open-eye and closed-eye
                        # observation; a small noisy landmark fluctuation is not enough.
                        peak, trough = max(ears), min(ears)
                        passed = peak > 0.20 and trough < 0.18 and (peak - trough) > 0.045
                        metric = round(peak - trough, 4)
                    elif action == "turn_head":
                        yaws = [self._yaw(p["landmarks"]) for p in samples]
                        passed = max(yaws) - min(yaws) > 0.09
                        metric = round(max(yaws) - min(yaws), 4)
                    elif action == "open_mouth":
                        mouths = [self._mouth_open(p["landmarks"]) for p in samples]
                        passed = max(mouths) > 0.20 and min(mouths) < 0.18 and (max(mouths) - min(mouths)) > 0.075
                        metric = round(max(mouths) - min(mouths), 4)
                    elif action == "smile":
                        smiles = [p["smile"] for p in samples]
                        passed = max(smiles) > 0.42 and min(smiles) < 0.34 and (max(smiles) - min(smiles)) > 0.16
                        metric = round(max(smiles) - min(smiles), 4)
                    else:
                        passed, metric = False, 0.0
                    results.append({"action": action, "passed": bool(passed), "signal_delta": metric})
                    if not passed:
                        return {
                            "verified": False,
                            "reason": "challenge_action_failed",
                            "failed_action": action,
                            "signal_delta": metric,
                            "results": results,
                        }
            finally:
                landmarker.close()
        except (ValueError, RuntimeError) as exc:
            return {"verified": False, "reason": str(exc), "results": results}
        except Exception:
            from loguru import logger
            logger.exception("Liveness verification engine failed")
            return {"verified": False, "reason": "liveness_engine_unavailable", "results": results}

        proof = secrets.token_urlsafe(32)
        self._proofs[proof] = {
            "admin_id": admin_id, "subject_id": subject_id,
            "expires_at": now + timedelta(seconds=self.PROOF_TTL_SECONDS),
        }
        return {
            "verified": True, "proof_token": proof,
            "assurance": "basic_active_challenge", "results": results,
            "warning": "Эвристическая проверка действий перед камерой; не является сертифицированной защитой от deepfake или подмены видеопотока.",
        }

    def consume_proof(self, proof: str, admin_id: int, subject_id: int) -> bool:
        item = self._proofs.pop(proof, None)
        return bool(item and item["admin_id"] == admin_id and item["subject_id"] == subject_id
                    and item["expires_at"] > datetime.now(timezone.utc))


liveness_service = LivenessService()
