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


class LivenessService:
    TTL_SECONDS = 600
    PROOF_TTL_SECONDS = 600
    MAX_FRAME_BYTES = 1_500_000
    ACTIONS = ("blink", "turn_head", "open_mouth")

    def __init__(self) -> None:
        self._challenges: dict[str, dict[str, Any]] = {}
        self._proofs: dict[str, dict[str, Any]] = {}

    def create(self, admin_id: int, subject_id: int) -> dict[str, Any]:
        challenge_id = secrets.token_urlsafe(32)
        actions = list(secrets.SystemRandom().sample(self.ACTIONS, 2))
        expires = datetime.now(timezone.utc) + timedelta(seconds=self.TTL_SECONDS)
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

    def _landmarks(self, frame_data: str, mesh: Any) -> list[Any]:
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
        result = mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        faces = result.multi_face_landmarks or []
        if len(faces) != 1:
            raise ValueError("В каждом кадре должно быть ровно одно обнаруженное лицо.")
        return faces[0].landmark

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
            with mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True, max_num_faces=2, refine_landmarks=True,
                min_detection_confidence=0.65,
            ) as mesh:
                for action, item in zip(challenge["actions"], evidence):
                    frames = item.get("frames", [])
                    if not isinstance(frames, list) or len(frames) < 4 or len(frames) > 8:
                        return {"verified": False, "reason": "insufficient_frames", "action": action}
                    samples = [self._landmarks(frame, mesh) for frame in frames]
                    if action == "blink":
                        ears = [(self._ear(p, (33, 160, 158, 133, 153, 144)) + self._ear(p, (362, 385, 387, 263, 373, 380))) / 2.0 for p in samples]
                        passed = max(ears) > 0.21 and min(ears) < 0.17 and (max(ears) - min(ears)) > 0.055
                        metric = round(max(ears) - min(ears), 4)
                    elif action == "turn_head":
                        yaws = [self._yaw(p) for p in samples]
                        passed = max(yaws) - min(yaws) > 0.12
                        metric = round(max(yaws) - min(yaws), 4)
                    elif action == "open_mouth":
                        mouths = [self._mouth_open(p) for p in samples]
                        passed = max(mouths) > 0.22 and min(mouths) < 0.16 and (max(mouths) - min(mouths)) > 0.10
                        metric = round(max(mouths) - min(mouths), 4)
                    else:
                        passed, metric = False, 0.0
                    results.append({"action": action, "passed": bool(passed), "signal_delta": metric})
                    if not passed:
                        return {"verified": False, "reason": "challenge_action_failed", "results": results}
        except (ValueError, RuntimeError) as exc:
            return {"verified": False, "reason": str(exc), "results": results}
        except Exception:
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
