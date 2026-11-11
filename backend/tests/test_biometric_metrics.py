import unittest

from app.services.biometric_metrics import (
    calibrate_threshold,
    evaluate_threshold,
    wilson_interval,
)


class BiometricMetricsTests(unittest.TestCase):
    def test_far_frr_and_tar_are_computed_from_labeled_scores(self):
        result = evaluate_threshold(
            genuine_scores=[0.9, 0.8, 0.4],
            impostor_scores=[0.7, 0.2, 0.1],
            threshold=0.6,
        )
        self.assertEqual(result.false_accepts, 1)
        self.assertEqual(result.false_rejects, 1)
        self.assertAlmostEqual(result.far, 1 / 3)
        self.assertAlmostEqual(result.frr, 1 / 3)
        self.assertAlmostEqual(result.tar, 2 / 3)

    def test_calibration_respects_target_far_without_touching_runtime_config(self):
        report = calibrate_threshold(
            genuine_scores=[0.91, 0.88, 0.86, 0.82],
            impostor_scores=[0.31, 0.42, 0.55, 0.61],
            target_far=0.0,
        )
        self.assertIsNotNone(report["recommended"])
        self.assertEqual(report["recommended"]["far"], 0.0)
        self.assertGreater(report["recommended"]["threshold"], 0.61)
        self.assertIn("warning", report)

    def test_insufficient_or_invalid_data_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_threshold([], [0.1], 0.5)
        with self.assertRaises(ValueError):
            evaluate_threshold([0.9], [1.2], 0.5)
        with self.assertRaises(ValueError):
            calibrate_threshold([0.9], [0.1], -0.1)

    def test_wilson_interval_is_nonzero_for_zero_observed_errors(self):
        lower, upper = wilson_interval(0, 100)
        self.assertEqual(lower, 0.0)
        self.assertGreater(upper, 0.0)
        self.assertLess(upper, 0.1)


if __name__ == "__main__":
    unittest.main()
