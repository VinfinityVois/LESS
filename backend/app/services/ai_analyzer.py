"""
ИИ-анализатор логов доступа.
Ищет аномалии, частые ошибки, подозрительную активность.
"""

from loguru import logger
from typing import List, Dict, Any
from datetime import datetime, timezone, timedelta
from collections import Counter
from app.config import settings
from app.services.db_service import db_service


class AIAnalyzer:
    def __init__(self):
        self.window_minutes = settings.AI_ANOMALY_WINDOW_MINUTES
        self.failed_threshold = settings.AI_FAILED_ATTEMPTS_THRESHOLD

    def analyze_recent(self) -> List[Dict[str, Any]]:
        logs = db_service.get_recent_logs(limit=200)
        if not logs:
            return []

        alerts = []
        now = datetime.now(timezone.utc)

        recent_failed = []
        for log in logs:
            if log["event_type"] != "denied":
                continue
            try:
                ts = datetime.fromisoformat(log["created_at"].replace("Z", "+00:00"))
                if (now - ts) <= timedelta(minutes=self.window_minutes):
                    recent_failed.append(log)
            except Exception:
                continue

        if len(recent_failed) >= self.failed_threshold:
            msg = f"Обнаружено {len(recent_failed)} неудачных попыток за последние {self.window_minutes} мин"
            alert_id = db_service.add_ai_alert(alert_type="high_failed_attempts", message=msg, severity="high")
            alerts.append({"id": alert_id, "type": "high_failed_attempts", "message": msg})
            logger.warning(msg)

        uid_counter = Counter(log["nfc_uid"] for log in recent_failed if log.get("nfc_uid"))
        for uid, count in uid_counter.items():
            if count >= 3:
                msg = f"Карта {uid}: {count} отказов подряд"
                alert_id = db_service.add_ai_alert(alert_type="repeated_denials", message=msg, severity="medium")
                alerts.append({"id": alert_id, "type": "repeated_denials", "message": msg})

        night_access = []
        for log in logs:
            if log["event_type"] != "granted":
                continue
            try:
                ts = datetime.fromisoformat(log["created_at"].replace("Z", "+00:00"))
                if 0 <= ts.hour < 5:
                    night_access.append(log)
            except Exception:
                continue

        if night_access:
            msg = f"Доступ в ночное время: {len(night_access)} событий"
            alert_id = db_service.add_ai_alert(alert_type="night_access", message=msg, severity="low")
            alerts.append({"id": alert_id, "type": "night_access", "message": msg})

        return alerts

    def run_periodic_check(self) -> List[Dict[str, Any]]:
        logger.debug("Запуск периодического ИИ-анализа...")
        return self.analyze_recent()


ai_analyzer = AIAnalyzer()
