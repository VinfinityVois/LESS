import unittest
from unittest.mock import patch

from app.services.local_ai_assistant import LocalAIAssistant


class LocalAIAssistantTests(unittest.TestCase):
    def test_disabled_by_default(self):
        service = LocalAIAssistant()
        with patch("app.services.local_ai_assistant.settings.LOCAL_LLM_ENABLED", False):
            self.assertFalse(service.status()["available"])

    def test_rejects_non_loopback_runtime(self):
        service = LocalAIAssistant()
        with patch("app.services.local_ai_assistant.settings.LOCAL_LLM_ENABLED", True), patch(
            "app.services.local_ai_assistant.settings.LOCAL_LLM_BASE_URL", "https://example.com"
        ):
            self.assertFalse(service.status()["available"])


if __name__ == "__main__":
    unittest.main()
