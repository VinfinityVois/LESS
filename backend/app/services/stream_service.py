"""Video stream over WebSocket with YuNet detection and SFace gallery match."""

from loguru import logger
from typing import Set, Optional
from fastapi import WebSocket
import asyncio
import time
from app.services.camera_service import camera_service
from app.services.face_recognition_service import face_recognition_service
from app.services.db_service import db_service
from app.config import settings


class StreamService:
    # Match at most ~2 times/sec when a face is present
    MATCH_INTERVAL_SEC = 0.55
    GALLERY_REFRESH_SEC = 8.0

    def __init__(self):
        self.clients: Set[WebSocket] = set()
        self._streaming_task: asyncio.Task | None = None
        self.is_streaming = False
        self._stop_requested = False
        self.last_faces: list = []
        self.last_match: Optional[dict] = None
        self._gallery: list = []
        self._gallery_loaded_at = 0.0
        self._last_match_at = 0.0
        self._user_name_cache: dict[int, str] = {}

    def request_start(self):
        self._stop_requested = False
        if self._streaming_task and not self._streaming_task.done():
            return
        self._streaming_task = asyncio.create_task(self.start_camera_stream())

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.clients.add(websocket)
        logger.info(f"Клиент видеопотока подключён. Всего: {len(self.clients)}")

    def disconnect(self, websocket: WebSocket):
        self.clients.discard(websocket)
        logger.info(f"Клиент видеопотока отключён. Осталось: {len(self.clients)}")
        if not self.clients and self._streaming_task and not self._streaming_task.done():
            self.is_streaming = False
            self._stop_requested = True
            self._streaming_task.cancel()

    async def broadcast_bytes(self, data: bytes):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_json(self, data: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def _refresh_gallery_if_needed(self):
        now = time.monotonic()
        if now - self._gallery_loaded_at < self.GALLERY_REFRESH_SEC:
            return
        try:
            self._gallery = db_service.get_face_gallery()
            self._gallery_loaded_at = now
            # Prefetch names
            for uid, _ in self._gallery:
                if uid not in self._user_name_cache:
                    user = db_service.get_user(uid, include_logs=False)
                    if user:
                        self._user_name_cache[uid] = user.get("name") or user.get("nfc_uid") or str(uid)
        except Exception as exc:
            logger.warning(f"Gallery refresh failed: {exc}")

    def _run_match(self, frame) -> Optional[dict]:
        """Blocking: embedding + gallery match. Runs in thread."""
        self._refresh_gallery_if_needed()
        emb_result = face_recognition_service.embedding_from_bgr(frame)
        if emb_result is None:
            return {
                "type": "face_match",
                "state": "no_face",
                "matched": False,
                "user_id": None,
                "name": None,
                "score": None,
                "faces": self.last_faces,
            }
        if not self._gallery:
            return {
                "type": "face_match",
                "state": "no_gallery",
                "matched": False,
                "user_id": None,
                "name": None,
                "score": None,
                "face_area": emb_result.get("face_area"),
                "faces": self.last_faces,
            }
        result = face_recognition_service.match(emb_result["embedding"], self._gallery)
        name = None
        if result["matched"] and result["user_id"] is not None:
            name = self._user_name_cache.get(result["user_id"])
            if not name:
                user = db_service.get_user(result["user_id"], include_logs=False)
                name = (user or {}).get("name") or (user or {}).get("nfc_uid") or str(result["user_id"])
                self._user_name_cache[result["user_id"]] = name
        payload = {
            "type": "face_match",
            "state": "matched" if result["matched"] else "unknown",
            "matched": result["matched"],
            "user_id": result["user_id"],
            "name": name,
            "score": result["score"],
            "margin": result.get("margin"),
            "threshold": result.get("threshold"),
            "face_area": emb_result.get("face_area"),
            "face_box": emb_result.get("face_box"),
            "faces": self.last_faces,
        }
        return payload

    async def start_camera_stream(self):
        if self.is_streaming:
            return
        if not camera_service.start():
            logger.error("Не удалось запустить камеру для стрима")
            await self.broadcast_json({"type": "error", "message": "camera_open_failed"})
            return

        self.is_streaming = True
        fps = max(5, min(30, settings.CAMERA_FPS or 15))
        logger.info(f"Видеострим запущен @ {fps} fps (match-on-stream enabled)")

        try:
            frame_index = 0
            model_notice_sent = False
            while self.is_streaming and self.clients:
                frame = camera_service.read_frame()
                if frame is not None:
                    jpeg = camera_service.encode_jpeg(frame)
                    if jpeg:
                        await self.broadcast_bytes(jpeg)
                    frame_index += 1

                    if frame_index % 5 == 0:
                        if not face_recognition_service.ready:
                            if not model_notice_sent:
                                await self.broadcast_json({
                                    "type": "face_detection",
                                    "available": False,
                                    "faces": [],
                                })
                                model_notice_sent = True
                        else:
                            try:
                                faces = await asyncio.to_thread(
                                    face_recognition_service.detect_faces, frame
                                )
                                self.last_faces = faces
                                await self.broadcast_json({
                                    "type": "face_detection",
                                    "available": True,
                                    "faces": faces,
                                })
                            except Exception as exc:
                                logger.warning(f"YuNet live detection unavailable: {exc}")
                                await self.broadcast_json({
                                    "type": "face_detection",
                                    "available": False,
                                    "faces": [],
                                })

                            # Match-on-stream (throttled)
                            now = time.monotonic()
                            if now - self._last_match_at >= self.MATCH_INTERVAL_SEC:
                                self._last_match_at = now
                                try:
                                    match_payload = await asyncio.to_thread(
                                        self._run_match, frame.copy()
                                    )
                                    if match_payload:
                                        self.last_match = match_payload
                                        await self.broadcast_json(match_payload)
                                except Exception as exc:
                                    logger.warning(f"Match-on-stream failed: {exc}")

                await asyncio.sleep(1 / fps)
        except asyncio.CancelledError:
            pass
        finally:
            self.is_streaming = False
            camera_service.stop()
            logger.info("Видеострим остановлен")
            if self._streaming_task is asyncio.current_task():
                self._streaming_task = None
            if self.clients and not self._stop_requested:
                self.request_start()

    def stop_stream(self):
        self.is_streaming = False
        self._stop_requested = True
        if self._streaming_task and not self._streaming_task.done():
            self._streaming_task.cancel()


stream_service = StreamService()
