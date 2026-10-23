"""Keep the executable Edge rank projection fixture bound to the actual public registry."""
import ast
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HistoryQualificationSchemaTest(unittest.TestCase):
    def test_source_registry_matches_edge_rank_projection_fixture(self):
        registry = json.loads(
            (ROOT / 'src/jungsi_touch/application/public_response_schemas.json').read_bytes()
        )
        operations = [o for o in registry['operations'] if o['id'] == 'history.snapshot.read']
        self.assertEqual(len(operations), 1)

        def references(value):
            if isinstance(value, list):
                for item in value:
                    yield from references(item)
            elif isinstance(value, dict):
                if isinstance(value.get('ref'), str):
                    yield value['ref']
                for item in value.values():
                    yield from references(item)

        pending = list(references(operations)) + list(references(registry['auxiliary_roots']))
        closure = set()
        while pending:
            name = pending.pop()
            if name in closure:
                continue
            closure.add(name)
            pending.extend(references(registry['schemas'][name]))
        self.assertIn('history_snapshot_rank_cell', closure)
        self.assertIn('history_snapshot_service_qualification', closure)
        expected = {**registry, 'operations': operations,
                    'schemas': {k: v for k, v in registry['schemas'].items() if k in closure}}
        source = (ROOT / 'tests/edge/synthetic_history_qualification.ts').read_text(encoding='utf-8')
        matches = re.findall(
            r'export const SYNTHETIC_QUALIFICATION_SCHEMA_JSON\s*=\s*([^\n]+);', source
        )
        self.assertEqual(len(matches), 1)
        actual = json.loads(ast.literal_eval(matches[0]))
        # Canonical JSON also distinguishes bool from int and int from decimal.
        self.assertEqual(json.dumps(actual, sort_keys=True, ensure_ascii=False),
                         json.dumps(expected, sort_keys=True, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
