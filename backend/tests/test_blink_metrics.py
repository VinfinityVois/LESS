import unittest

from app.services.blink_metrics import evaluate_blink_bursts


def burst_with_blink():
    values = [0.30] * 12
    values[5:7] = [0.08, 0.08]
    return values


class BlinkMetricsTests(unittest.TestCase):
    def test_accepts_one_complete_blink_in_any_of_three_bursts(self):
        frames = [0.30] * 24 + burst_with_blink()
        passed, details = evaluate_blink_bursts(frames)
        self.assertTrue(passed)
        self.assertEqual(details["successful_bursts"], 1)
        self.assertTrue(details["reopened_after"])
        self.assertGreaterEqual(details["blink_score"], 70)

    def test_rejects_closed_eyes_without_reopening(self):
        frames = [0.30] * 5 + [0.08] * 7 + [0.30] * 24
        passed, details = evaluate_blink_bursts(frames)
        self.assertFalse(passed)
        self.assertFalse(details["reopened_after"])
        self.assertLessEqual(details["blink_score"], 60)

    def test_rejects_constant_open_eyes(self):
        passed, details = evaluate_blink_bursts([0.30] * 36)
        self.assertFalse(passed)
        self.assertEqual(details["successful_bursts"], 0)

    def test_counts_multiple_valid_bursts(self):
        frames = burst_with_blink() * 3
        passed, details = evaluate_blink_bursts(frames)
        self.assertTrue(passed)
        self.assertEqual(details["successful_bursts"], 3)


if __name__ == "__main__":
    unittest.main()
