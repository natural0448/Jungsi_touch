"""Closed, recursively typed projections. Only explicitly secured composition uses them."""
from __future__ import annotations
import json
import math
from pathlib import Path
import re

from .platform import PlatformService
from .platform_ports import PlatformError


def _unavailable():
    return PlatformError('security_policy_unavailable', 503)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise _unavailable()
        result[key] = value
    return result


class PublicResponseProjection:
    """Immutable-in-use catalog: no dynamic fields, fallback schemas or imports."""
    def __init__(self, registry=None, operations=None):
        path = Path(__file__).with_name('public_response_schemas.json')
        self.registry = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object) if registry is None else registry
        if operations is None:
            operations = json.loads(path.with_name('route_catalog.json').read_text(encoding='utf-8'))['operations']
        self.schemas = self.registry.get('schemas', {})
        self.operations = {}
        self._validate_catalog(operations)

    def _validate_catalog(self, operations):
        if self.registry.get('format') != 'jungsi.public-response-schemas/v1' or not isinstance(self.schemas, dict) or not self.schemas:
            raise _unavailable()
        expected = {row['id']: row['contract_ref'] for row in operations}
        rows = self.registry.get('operations')
        if not isinstance(rows, list):
            raise _unavailable()
        for row in rows:
            if not isinstance(row, dict) or set(row) != {'id', 'contract_ref', 'roots'}:
                raise _unavailable()
            if row['id'] in self.operations or expected.get(row['id']) != row['contract_ref'] or set(row['roots']) != {'standard', 'paid'}:
                raise _unavailable()
            if any(not isinstance(root,dict) or root.get('ref') not in self.schemas for root in row['roots'].values()):
                raise _unavailable()
            for root in row['roots'].values():self._validate_node(root,set())
            self.operations[row['id']] = row
        if set(self.operations) != set(expected) or set(self.registry.get('auxiliary_roots',{})) != {'error', 'readiness'}:
            raise _unavailable()
        for root in self.registry['auxiliary_roots'].values():
            self._validate_node(root,set())
        for name, node in self.schemas.items():
            self._validate_node(node, {name})

    def _validate_node(self, node, stack):
        if not isinstance(node, dict) or type(node.get('nullable')) is not bool:
            raise _unavailable()
        if 'ref' in node:
            if set(node) != {'ref', 'nullable'} or node['ref'] not in self.schemas or node['ref'] in stack:
                raise _unavailable()
            self._validate_node(self.schemas[node['ref']], stack | {node['ref']})
            return
        kind = node.get('type')
        common = {'type', 'nullable'}
        if kind == 'object':
            if set(node) != common | {'properties', 'required', 'optional'} or not isinstance(node['properties'], dict):
                raise _unavailable()
            required, optional = node['required'], node['optional']
            if (not isinstance(required, list) or not isinstance(optional, list) or
                len(set(required + optional)) != len(required + optional) or
                set(required + optional) != set(node['properties'])):
                raise _unavailable()
            for child in node['properties'].values():
                self._validate_node(child, stack)
        elif kind == 'array':
            if set(node) != common | {'items'}:
                raise _unavailable()
            self._validate_node(node['items'], stack)
        elif kind == 'map':
            if set(node) != common | {'keys', 'values'}:
                raise _unavailable()
            self._validate_node(node['keys'], stack)
            self._validate_node(node['values'], stack)
            key = node['keys']
            while 'ref' in key:
                key = self.schemas[key['ref']]
            if key.get('type') != 'string' or key['nullable']:
                raise _unavailable()
        elif kind == 'union':
            if set(node) != common | {'options'} or not isinstance(node['options'], list) or len(node['options']) < 2:
                raise _unavailable()
            for child in node['options']:
                self._validate_node(child, stack)
        elif kind in ('string', 'integer', 'number', 'boolean'):
            if set(node) - (common | {'enum', 'pattern'}):
                raise _unavailable()
            if 'enum' in node and (not isinstance(node['enum'], list) or not node['enum']):
                raise _unavailable()
            if 'pattern' in node:
                if kind != 'string':
                    raise _unavailable()
                re.compile(node['pattern'])
        else:
            raise _unavailable()

    def _project(self, node, value):
        if value is None:
            if node['nullable']:
                return None
            raise _unavailable()
        if 'ref' in node:
            return self._project(self.schemas[node['ref']], value)
        kind = node['type']
        if kind == 'object':
            if type(value) is not dict or not set(node['required']) <= set(value):
                raise _unavailable()
            return {name: self._project(child, value[name]) for name, child in node['properties'].items() if name in value}
        if kind == 'array':
            if type(value) is not list:
                raise _unavailable()
            return [self._project(node['items'], item) for item in value]
        if kind == 'map':
            if type(value) is not dict:
                raise _unavailable()
            return {self._project(node['keys'], key): self._project(node['values'], item) for key, item in value.items()}
        if kind == 'union':
            for child in node['options']:
                try:
                    return self._project(child, value)
                except PlatformError:
                    pass
            raise _unavailable()
        valid = {'string': type(value) is str, 'integer': type(value) is int,
                 'number': type(value) in (int, float), 'boolean': type(value) is bool}[kind]
        if not valid or (kind == 'number' and not math.isfinite(value)):
            raise _unavailable()
        if 'enum' in node and not any(type(value) is type(item) and value == item for item in node['enum']):
            raise _unavailable()
        if 'pattern' in node and re.fullmatch(node['pattern'], value) is None:
            raise _unavailable()
        return value

    def auxiliary(self, root, value):
        try:
            return self._project(self.registry['auxiliary_roots'][root], value)
        except (KeyError, TypeError, ValueError, RecursionError):
            raise _unavailable() from None

    def project(self, operation, actor, value):
        try:
            tier = 'paid' if actor.paid_active else 'standard'
            root = self.operations[operation]['roots'][tier]
            return self._project(root, value)
        except (KeyError, TypeError, ValueError, AttributeError, RecursionError):
            raise _unavailable() from None


class ProjectedPlatformService(PlatformService):
    """Covers HTTP and the existing private print-publication caller alike."""
    def __init__(self, *args, projection, **kwargs):
        super().__init__(*args, **kwargs)
        self.projection = projection

    def execute(self, operation, actor, **kwargs):
        result = super().execute(operation, actor, **kwargs)
        return self.projection.project(operation, actor, result)
