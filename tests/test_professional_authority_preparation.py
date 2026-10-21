"""Bind the separate prepared authority SQL without changing installed 007 evidence."""
from pathlib import Path
import hashlib
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProfessionalAuthorityPreparationTests(unittest.TestCase):
    def test_prepared_authority_bytes_are_bound_separately_from_installed_schema(self):
        spec = json.loads((ROOT / 'docs/current/service_spec.json').read_bytes())
        contract = spec['professional_service_contract']
        prepared = contract['implementation_support']['authority_source_preparation']
        path = 'database/migrations/008_professional_authority.prepared.sql'
        self.assertEqual(prepared['prepared_migration']['path'], path)
        self.assertEqual(prepared['prepared_migration']['sha256'], hashlib.sha256((ROOT / path).read_bytes()).hexdigest())
        self.assertEqual(prepared['status'], 'PREPARED_NOT_APPLIED')
        self.assertIsNone(prepared['function']['installed_definition_sha256'])
        self.assertEqual(prepared['function']['binding_status'], 'NOT_REGISTERED')
        migrations = contract['source_registration']['migrations']
        self.assertEqual([row['path'] for row in migrations], ['database/migrations/007_professional_platform.prepared.sql'])
        self.assertEqual(contract['schema_application_evidence']['migration_sha256'], migrations[0]['sha256'])
        self.assertEqual(prepared['closed_modes'], ['support', 'retention'])
        self.assertEqual(contract['runtime_activation'], 'NOT_RUN')


if __name__ == '__main__':
    unittest.main()
