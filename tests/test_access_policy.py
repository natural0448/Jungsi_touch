"""Paid access and owner isolation using explicitly synthetic IDs."""
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"src"))
from jungsi_touch.application.authorization import Actor,AccessController
from jungsi_touch.application.ports import ReportAccessRecord
from jungsi_touch.infrastructure.memory_report_repository import SyntheticReportAccessRepository

class AccessPolicyTests(unittest.TestCase):
    def setUp(self):
        self.repository=SyntheticReportAccessRepository({
            "synthetic-confirmed":ReportAccessRecord("synthetic-owner",True),
            "synthetic-unconfirmed":ReportAccessRecord("synthetic-owner",False)})
        self.policy=AccessController(self.repository, operating_mode="legacy_synthetic")
        self.free=Actor("synthetic-owner")
        self.paid=Actor("synthetic-owner",True)
    def test_free_history_requires_no_scores(self):
        self.assertTrue(self.policy.operation_access("history.search",self.free).allowed)
    def test_free_cannot_search_paid_catalog(self):
        self.assertEqual(self.policy.operation_access("offerings.search",self.free).http_status,403)
    def test_expired_paid_is_standard(self):
        self.assertEqual(self.policy.operation_access("offerings.search",Actor("synthetic-owner",False)).status,"paid_required")
    def test_paid_search_and_detail_require_no_scores(self):
        self.assertTrue(self.policy.operation_access("offerings.search",self.paid).allowed)
        self.assertTrue(self.policy.operation_access("offering.read",self.paid).allowed)
    def test_free_page3_and_page4_blocked(self):
        for page in ["PAGE-03","PAGE-04"]:
            self.assertEqual(self.policy.page_access(page,self.free).http_status,403)
    def test_free_page1_and_page2_allowed(self):
        for page in ["PAGE-01","PAGE-02"]:
            self.assertTrue(self.policy.page_access(page,self.free).allowed)
    def test_other_owner_and_missing_report_are_indistinguishable(self):
        other=self.policy.operation_access("university.analyze",Actor("synthetic-other",True),report_id="synthetic-confirmed")
        missing=self.policy.operation_access("university.analyze",self.paid,report_id="synthetic-missing")
        self.assertEqual(other,missing)
        self.assertEqual(other.http_status,404)
    def test_own_unconfirmed_report_cannot_analyze_college(self):
        self.assertEqual(self.policy.operation_access("university.analyze",self.paid,report_id="synthetic-unconfirmed").status,"score_confirmation_required")
    def test_own_confirmed_report_can_analyze_college(self):
        self.assertTrue(self.policy.operation_access("university.analyze",self.paid,report_id="synthetic-confirmed").allowed)
    def test_free_cannot_export(self):
        self.assertEqual(self.policy.operation_access("report.export",self.free,report_id="synthetic-confirmed").http_status,403)
    def test_unpaid_denied_before_repository_lookup(self):
        class BrokenRepository:
            def lookup_access(self,report_id):
                raise AssertionError("Unpaid request must not reach repository")
        self.assertEqual(AccessController(BrokenRepository(), operating_mode="legacy_synthetic").operation_access("university.analyze",self.free,report_id="synthetic-confirmed").http_status,403)
    def test_anonymous_denied(self):
        self.assertEqual(self.policy.operation_access("history.search",Actor(None)).http_status,401)
    def test_client_dict_is_not_verified_actor(self):
        self.assertEqual(self.policy.operation_access("offerings.search",{"subject_id":"synthetic-owner","paid_active":True}).status,"invalid_server_context")
    def test_truthy_string_cannot_be_paid(self):
        with self.assertRaises(ValueError):Actor("synthetic-owner","false")
    def test_boolean_owner_is_invalid(self):
        with self.assertRaises(ValueError):Actor(True,True)
    def test_missing_report_reference_is_explicit(self):
        self.assertEqual(self.policy.operation_access("university.analyze",self.paid).http_status,400)
    def test_unknown_operation_denied(self):
        self.assertEqual(self.policy.operation_access("unlisted.admin",self.paid).http_status,404)
    def test_unknown_page_denied(self):
        self.assertEqual(self.policy.page_access("PAGE-99",self.paid).http_status,404)
    def test_invalid_repository_state_denied(self):
        class InvalidRepository:
            def lookup_access(self,report_id):
                return {"owner_id":"synthetic-owner","confirmed_score_profile":True}
        self.assertEqual(AccessController(InvalidRepository(), operating_mode="legacy_synthetic").operation_access("university.analyze",self.paid,report_id="synthetic-confirmed").http_status,503)
    def test_repository_copies_synthetic_input(self):
        source={"synthetic-confirmed":ReportAccessRecord("synthetic-owner",True)}
        repository=SyntheticReportAccessRepository(source)
        source["synthetic-confirmed"]=ReportAccessRecord("synthetic-other",True)
        self.assertEqual(repository.lookup_access("synthetic-confirmed").owner_id,"synthetic-owner")

if __name__=="__main__":unittest.main()
