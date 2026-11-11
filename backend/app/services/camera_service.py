"""
Сервис работы с камерой (OpenCV + mediapipe).
Позже: детекция лица, отправка кадров по WebSocket.
"""

from loguru import logger
import cv2
import numpy as np
from typing import Optional, Generator
from app.config import settings


class CameraService:
    def __init__(self):
        self.cap: Optional[cv2.VideoCapture] = None
        self.is_running = False

    def start(self, camera_index: int = None) -> bool:
        index = camera_index if camera_index is not None else settings.CAMERA_INDEX
        if self.cap:
            self.stop()
        capture = cv2.VideoCapture(index)
        if not capture.isOpened():
            capture.release()
            logger.error(f"Не удалось открыть камеру {index}")
            return False
        self.cap = capture

        # Prefer MJPEG on USB cameras: it often sustains 720p/1080p better than
        # uncompressed YUYV. Unsupported controls are safely ignored by OpenCV.
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, settings.CAMERA_WIDTH)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.CAMERA_HEIGHT)
        self.cap.set(cv2.CAP_PROP_FPS, settings.CAMERA_FPS)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        actual_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        actual_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        actual_fps = round(self.cap.get(cv2.CAP_PROP_FPS) or 0, 1)
        self.is_running = True
        logger.info(
            f"Камера {index} запущена: {actual_width}x{actual_height} @ {actual_fps} FPS "
            f"(запрошено {settings.CAMERA_WIDTH}x{settings.CAMERA_HEIGHT} @ {settings.CAMERA_FPS})"
        )
        return True

    def stop(self):
        if self.cap:
            self.cap.release()
            self.cap = None
        self.is_running = False
        logger.info("Камера остановлена")

    def read_frame(self) -> Optional[np.ndarray]:
        if not self.cap or not self.is_running:
            return None
        ret, frame = self.cap.read()
        if not ret:
            return None
        return frame

    def encode_jpeg(self, frame: np.ndarray, quality: int = None) -> bytes:
        q = quality or settings.JPEG_QUALITY
        success, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, q])
        if not success:
            return b""
        return buffer.tobytes()


# Глобальный экземпляр (позже заменим на dependency injection)
camera_service = CameraService()
