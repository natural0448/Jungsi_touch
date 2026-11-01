"""Check new report-list stage fields through the real closed JSON registry."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.application.public_response import PublicResponseProjection
from jungsi_touch.application.platform_ports import PlatformError


class OwnReportStageProjectionTest(unittest.TestCase):
    def setUp(self):
        spec = json.loads((ROOT / "docs/current/service_spec.json").read_bytes())
        self.projection = PublicResponseProjection(operations=spec["operations"])
        self.actor = SimpleNamespace(paid_active=False)
        self.item = {
            "report_id": "SYNTHETIC-report", "exam_id": "SYNTHETIC-exam",
            "report_version": 1, "updated_at": "2026-01-01T00:00:00Z",
            "stage": "provisional", "is_current": True,
        }

    def project(self, item):
        body = {"format": "jungsi.own-report-list/v1", "items": [item],
                "next_cursor": None, "has_more": False}
        return self.projection.project("report.list-own", self.actor, body)["items"][0]

    def test_valid_unknown_and_extra_private_fields(self):
        self.assertEqual(self.project(self.item)["stage"], "provisional")
        self.assertTrue(self.project(self.item)["is_current"])
        unknown = self.project({**self.item, "stage": None, "is_current": None,
                                "private_secret": "SYNTHETIC-hidden"})
        self.assertIsNone(unknown["stage"])
        self.assertIsNone(unknown["is_current"])
        self.assertNotIn("private_secret", unknown)

    def test_invalid_stage_or_current_type_rejected(self):
        for field, value in (("stage", "unknown"), ("is_current", "true")):
            with self.subTest(field=field), self.assertRaises(PlatformError):
                self.project({**self.item, field: value})


    def project_many(self, items, paid):
        body = {"format": "jungsi.own-report-list/v1", "items": items,
                "next_cursor": None, "has_more": False}
        actor = SimpleNamespace(paid_active=paid)
        return self.projection.project("report.list-own", actor, body)["items"]

    def test_all_null_fields_survive_actual_registry_for_both_tiers(self):
        items = [
            {**self.item, "report_id": "SYNTHETIC-b", "stage": "final", "is_current": None},
            {**self.item, "report_id": "SYNTHETIC-a", "exam_id": None,
             "stage": None, "is_current": None},
        ]
        for paid in (False, True):
            with self.subTest(paid=paid):
                actual = self.project_many(items, paid)
                self.assertEqual(len(actual), 2)
                self.assertEqual([x["stage"] for x in actual], ["final", None])
                for item in actual:
                    self.assertIn("stage", item)
                    self.assertIn("is_current", item)
                    self.assertIsNone(item["is_current"])

    def test_mixed_flags_stay_bound_to_each_exam_and_stage(self):
        items = [
            {**self.item, "report_id": "SYNTHETIC-e", "exam_id": "SYNTHETIC-exam-A",
             "stage": "final", "is_current": True},
            {**self.item, "report_id": "SYNTHETIC-d", "exam_id": "SYNTHETIC-exam-A",
             "stage": "provisional", "is_current": True},
            {**self.item, "report_id": "SYNTHETIC-c", "exam_id": "SYNTHETIC-exam-A",
             "stage": "final", "is_current": False},
            {**self.item, "report_id": "SYNTHETIC-b", "exam_id": "SYNTHETIC-exam-B",
             "stage": "provisional", "is_current": None},
            {**self.item, "report_id": "SYNTHETIC-a", "exam_id": "SYNTHETIC-exam-C",
             "stage": None, "is_current": None},
        ]
        expected = [
            ("SYNTHETIC-e", "SYNTHETIC-exam-A", "final", True),
            ("SYNTHETIC-d", "SYNTHETIC-exam-A", "provisional", True),
            ("SYNTHETIC-c", "SYNTHETIC-exam-A", "final", False),
            ("SYNTHETIC-b", "SYNTHETIC-exam-B", "provisional", None),
            ("SYNTHETIC-a", "SYNTHETIC-exam-C", None, None),
        ]
        for paid in (False, True):
            with self.subTest(paid=paid):
                actual = self.project_many(items, paid)
                self.assertEqual(
                    [(x["report_id"], x["exam_id"], x["stage"], x["is_current"])
                     for x in actual], expected,
                )
                for item, (_, _, _, current) in zip(actual, expected):
                    self.assertIn("stage", item)
                    self.assertIn("is_current", item)
                    self.assertIs(item["is_current"], current)

    def test_missing_new_fields_are_rejected_by_current_registry_for_both_tiers(self):
        for paid in (False, True):
            for missing in (("stage",), ("is_current",), ("stage", "is_current")):
                with self.subTest(paid=paid, missing=missing):
                    item = dict(self.item)
                    for field in missing:
                        del item[field]
                    with self.assertRaises(PlatformError):
                        self.project_many([item], paid)


if __name__ == "__main__":
    unittest.main()
