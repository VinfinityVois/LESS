"""
Сервис связи с Arduino (NFC, PIN, fingerprint stub).
"""

from loguru import logger
from typing import Optional, Callable
import serial
import serial.tools.list_ports
from app.config import settings


class SerialService:
    def __init__(self):
        self.ser: Optional[serial.Serial] = None
        self.is_connected = False
        self.on_card_read: Optional[Callable[[str], None]] = None

    def list_ports(self) -> list[str]:
        ports = serial.tools.list_ports.comports()
        return [p.device for p in ports]

    def connect(self, port: str = None, baudrate: int = None) -> bool:
        port = port or settings.SERIAL_PORT
        baudrate = baudrate or settings.SERIAL_BAUDRATE
        try:
            self.ser = serial.Serial(
                port=port,
                baudrate=baudrate,
                timeout=settings.SERIAL_TIMEOUT,
            )
            self.is_connected = True
            logger.info(f"Подключено к Arduino на {port}")
            return True
        except Exception as e:
            logger.error(f"Ошибка подключения к {port}: {e}")
            self.is_connected = False
            return False

    def disconnect(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
        self.ser = None
        self.is_connected = False
        logger.info("Serial отключён")

    def read_line(self) -> Optional[str]:
        if not self.ser or not self.is_connected:
            return None
        try:
            if self.ser.in_waiting:
                line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                return line if line else None
        except Exception as e:
            logger.error(f"Ошибка чтения Serial: {e}")
        return None


serial_service = SerialService()
