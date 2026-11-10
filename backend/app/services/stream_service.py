"""
Сервис подготовки и рассылки видеопотока по WebSocket.
"""

from loguru import logger
from typing import Set
from fastapi import WebSocket
import asyncio
from app.services.camera_service import camera_service


class StreamService:
    def __init__(self):
        self.clients: Set[WebSocket] = set()
        self._streaming_task: asyncio.Task | None = None
        self.is_streaming = False
        self._stop_requested = False

    def request_start(self):
        # Keep one camera capture task for all authenticated WebSocket clients.
        self._stop_requested = False
        if self._streaming_task and not self._streaming_task.done():
            return
        self._streaming_task = asyncio.create_task(self.start_camera_stream())

    async def connect(self, websocket: WebSocket):
        # Accept first so the client can send its bearer token; do not register
        # it as a stream consumer until authentication has succeeded.
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

    async def start_camera_stream(self):
        if self.is_streaming:
            return
        if not camera_service.start():
            logger.error("Не удалось запустить камеру для стрима")
            return

        self.is_streaming = True
        logger.info("Видеострим запущен")

        try:
            while self.is_streaming and self.clients:
                frame = camera_service.read_frame()
                if frame is not None:
                    jpeg = camera_service.encode_jpeg(frame)
                    if jpeg:
                        await self.broadcast_bytes(jpeg)
                await asyncio.sleep(1 / 15)
        except asyncio.CancelledError:
            pass
        finally:
            self.is_streaming = False
            camera_service.stop()
            logger.info("Видеострим остановлен")
            if self._streaming_task is asyncio.current_task():
                self._streaming_task = None
            # A display may reconnect while the previous task is releasing
            # the device. Start a fresh capture only after that release finished.
            if self.clients and not self._stop_requested:
                self.request_start()

    def stop_stream(self):
        self.is_streaming = False
        self._stop_requested = True
        if self._streaming_task and not self._streaming_task.done():
            self._streaming_task.cancel()


stream_service = StreamService()
