"""Video stream over WebSocket with YuNet detection and optional SFace match."""

from loguru import logger
from typing import Set, Optional
from fastapi import WebSocket
import asyncio
import time
from app.services.camera_service import camera_service
from app.services.face_recognition_service import face_recognition_service
from app.config import settings


class StreamService:
    MATCH_INTERVAL_SEC = 0.6
    GALLERY_REFRESH_SEC = 10.0

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
        self._name_cache: dict[int, str] = {}

    def request_start(self):
        self._stop_requested = False
        if self._streaming_task and not self._streaming_task.done():
            return
        self._streaming_task = asyncio.create_task(self.start_camera_stream())

    async def connect(self, websocket: WebSocket):
        await websocket.accept()

    def register(self, websocket: WebSocket):
        self.clients.add(websocket)
        logger.info(f"Авторизованный клиент видеопотока подключён. Всего: {len(self.clients)}")

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

    def _refresh_gallery(self):
        now = time.monotonic()
        if now - self._gallery_loaded_at < self.GALLERY_REFRESH_SEC:
            return
        try:
            from app.services.db_service import db_service

            gallery_fn = getattr(db_service, "get_face_match_gallery", None)
            if callable(gallery_fn):
                self._gallery = gallery_fn() or []
            else:
                # Fallback: active users with face_vector present via list + private load
                self._gallery = []
                users = db_service.list_users(include_inactive=False, include_deleted=False)
                for user in users:
                    if not user.get("face_enrolled"):
                        continue
                    # Prefer dedicated decrypt helper if present
                    loader = getattr(db_service, "get_user_face_embedding", None)
                    if callable(loader):
                        emb = loader(user["id"])
                        if emb and len(emb) == 128:
                            self._gallery.append((user["id"], emb))
                            self._name_cache[user["id"]] = user.get("name") or user.get("nfc_uid") or str(user["id"])
            self._gallery_loaded_at = now
        except Exception as exc:
            logger.warning(f"Gallery refresh failed: {exc}")

    def _run_match(self, frame) -> dict:
        self._refresh_gallery()
        emb = face_recognition_service.embedding_from_bgr(frame)
        if emb is None:
            return {
                "type": "face_match",
                "state": "no_face",
                "matched": False,
                "user_id": None,
                "name": None,
                "score": None,
            }
        if not self._gallery:
            return {
                "type": "face_match",
                "state": "no_gallery",
                "matched": False,
                "user_id": None,
                "name": None,
                "score": None,
                "face_area": emb.get("face_area"),
            }
        result = face_recognition_service.match(emb["embedding"], self._gallery)
        name = None
        if result["matched"] and result["user_id"] is not None:
            name = self._name_cache.get(result["user_id"])
            if not name:
                try:
                    from app.services.db_service import db_service

                    user = db_service.get_user(result["user_id"], include_logs=False)
                    name = (user or {}).get("name") or (user or {}).get("nfc_uid") or str(result["user_id"])
                    self._name_cache[result["user_id"]] = name
                except Exception:
                    name = str(result["user_id"])
        return {
            "type": "face_match",
            "state": "matched" if result["matched"] else "unknown",
            "matched": result["matched"],
            "user_id": result["user_id"],
            "name": name,
            "score": result["score"],
            "margin": result.get("margin"),
            "threshold": result.get("threshold"),
            "face_area": emb.get("face_area"),
            "face_box": emb.get("face_box"),
        }

    async def start_camera_stream(self):
        if self.is_streaming:
            return
        if not camera_service.start():
            logger.error("Не удалось запустить камеру для стрима")
            await self.broadcast_json({"type": "error", "message": "camera_open_failed"})
            return

        self.is_streaming = True
        fps = max(5, min(30, getattr(settings, "CAMERA_FPS", 15) or 15))
        logger.info(f"Видеострим запущен @ {fps} fps")

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

                            now = time.monotonic()
                            if now - self._last_match_at >= self.MATCH_INTERVAL_SEC:
                                self._last_match_at = now
                                try:
                                    payload = await asyncio.to_thread(self._run_match, frame.copy())
                                    self.last_match = payload
                                    await self.broadcast_json(payload)
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
