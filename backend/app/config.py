from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = False

    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    DB_PATH: Path = DATA_DIR / "skud.db"

    # Security
    SECRET_KEY: str = ""
    ARGON2_TIME_COST: int = 3
    ARGON2_MEMORY_COST: int = 65536

    # Camera
    CAMERA_INDEX: int = 0
    CAMERA_WIDTH: int = 640
    CAMERA_HEIGHT: int = 480
    CAMERA_FPS: int = 15
    JPEG_QUALITY: int = 75

    # Serial / Arduino
    SERIAL_PORT: str = "COM3"          # Windows: COM3, Linux: /dev/ttyUSB0
    SERIAL_BAUDRATE: int = 115200
    SERIAL_TIMEOUT: float = 1.0

    # Authenticated door-controller protocol (separate key from SECRET_KEY)
    CONTROLLER_HMAC_KEY: str = ""
    CONTROLLER_ID: str = ""
    CONTROLLER_ACK_TIMEOUT: float = 4.0

    # AI
    AI_ANOMALY_WINDOW_MINUTES: int = 60
    AI_FAILED_ATTEMPTS_THRESHOLD: int = 5


settings = Settings()

# Создаём папки при старте
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
