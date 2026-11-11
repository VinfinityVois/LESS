import ast
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


class FaceMatchingWiringTests(unittest.TestCase):
    def test_access_route_uses_the_imported_face_recognition_service(self):
        source = (BACKEND_ROOT / "app" / "main.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        attributes = {
            node.attr for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
        }
        self.assertNotIn("face_engine", names)
        self.assertIn("cosine_similarity", attributes)
        self.assertIn("face_recognition_service", names)

    def test_cosine_similarity_is_declared_as_a_static_method(self):
        source = (BACKEND_ROOT / "app" / "services" / "face_recognition_service.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        service = next(
            node for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "FaceRecognitionService"
        )
        method = next(
            node for node in service.body
            if isinstance(node, ast.FunctionDef) and node.name == "cosine_similarity"
        )
        decorators = {
            item.id for item in method.decorator_list if isinstance(item, ast.Name)
        }
        self.assertIn("staticmethod", decorators)


if __name__ == "__main__":
    unittest.main()
