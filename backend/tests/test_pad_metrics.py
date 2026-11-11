import unittest

from app.services.pad_metrics import evaluate_pad_trials


class PadMetricsTests(unittest.TestCase):
    def test_apcer_bpcer_and_attack_species_breakdown(self):
        report = evaluate_pad_trials([
            {"class": "bona_fide", "accepted": True},
            {"class": "bona_fide", "accepted": False},
            {"class": "attack", "attack_type": "printed_photo", "accepted": True},
            {"class": "attack", "attack_type": "printed_photo", "accepted": False},
            {"class": "attack", "attack_type": "screen_video", "accepted": False},
        ])
        self.assertAlmostEqual(report["apcer"], 1 / 3)
        self.assertAlmostEqual(report["bpcer"], 1 / 2)
        self.assertGreater(report["apcer_wilson_95"][1], report["apcer"])
        self.assertEqual(len(report["bpcer_wilson_95"]), 2)
        self.assertEqual(report["attack_species"]["printed_photo"]["presentations"], 2)
        self.assertEqual(report["attack_species"]["screen_video"]["apcer"], 0.0)


    def test_report_breaks_down_results_by_camera_and_conditions(self):
        report = evaluate_pad_trials([
            {"class": "bona_fide", "accepted": True, "camera_label": "cam-a", "test_condition": "bright"},
            {"class": "bona_fide", "accepted": False, "camera_label": "cam-a", "test_condition": "bright"},
            {"class": "attack", "attack_type": "screen_video", "accepted": True, "camera_label": "cam-b", "test_condition": "low-light"},
        ])
        self.assertEqual(report["by_camera"]["cam-a"]["bona_fide"], 2)
        self.assertEqual(report["by_condition"]["low-light"]["apcer"], 1.0)

    def test_rejects_missing_classes_and_invalid_labels(self):
        with self.assertRaises(ValueError):
            evaluate_pad_trials([{"class": "attack", "attack_type": "photo", "accepted": False}])
        with self.assertRaises(ValueError):
            evaluate_pad_trials([
                {"class": "bona_fide", "accepted": "maybe"},
                {"class": "attack", "attack_type": "photo", "accepted": False},
            ])


if __name__ == "__main__":
    unittest.main()
