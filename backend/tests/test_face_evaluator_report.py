import tempfile
import unittest
from pathlib import Path

from app.services.biometric_metrics import calibrate_threshold
from scripts.evaluate_face_threshold import load_scores, render_roc_svg


class FaceEvaluatorReportTests(unittest.TestCase):
    def test_loads_subgroups_and_renders_roc_svg(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "scores.csv"
            csv_path.write_text(
                "label,similarity,condition,camera\n"
                "genuine,0.91,bright,cam-a\n"
                "genuine,0.87,bright,cam-a\n"
                "impostor,0.22,bright,cam-a\n"
                "impostor,0.31,bright,cam-a\n"
                "genuine,0.82,low-light,cam-b\n"
                "impostor,0.42,low-light,cam-b\n",
                encoding="utf-8",
            )
            genuine, impostor, groups = load_scores(csv_path)
            report = calibrate_threshold(genuine, impostor, 0.001)
            report["by_condition"] = {
                key: calibrate_threshold(value["genuine"], value["impostor"], 0.001)
                for key, value in groups["condition"].items()
            }
            svg = render_roc_svg(report)
            self.assertIn("<svg", svg)
            self.assertIn("ROC", svg)
            self.assertIn("by_condition", str(report))
            self.assertEqual(len(groups["camera"]), 2)


if __name__ == "__main__":
    unittest.main()
