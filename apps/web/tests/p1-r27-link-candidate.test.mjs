import test from 'node:test';
import assert from 'node:assert/strict';
import { linkR27, unitKey } from '../src/lib/p1-shape.ts';

const school = 'synthetic-school';
const past = (year, pk, campus = 'campus-a') => ({ y: year, pk, ob: null, c: campus, t: 'track-a', g: 'ga' });
const next = (pk, scope, links = [], campus = 'campus-a') => ({ y: 2027, pk, ob: null, c: campus, t: 'track-a', g: 'ga', scope27: scope, hl: links });
const link = (year, pk, campus = 'campus-a') => ({ academic_year: year, school_id: school, original_pk: pk, campus, admission_track: 'track-a', group: 'ga' });

test('same unapproved PK is separate', () => {
  const out = linkR27([past(2026, 'same'), next('same', 'scope-a')], school);
  assert.notEqual(unitKey(out[0]), unitKey(out[1]));
});
test('one matching historical row follows its approved scope', () => {
  const out = linkR27([past(2026, 'old'), next('new', 'scope-a', [link(2026, 'old')])], school);
  assert.equal(unitKey(out[0]), unitKey(out[1]));
});
test('duplicate matching historical rows are not linked', () => {
  const out = linkR27([past(2026, 'old'), past(2026, 'old'), next('new', 'scope-a', [link(2026, 'old')])], school);
  assert.notEqual(unitKey(out[0]), unitKey(out[2]));
  assert.notEqual(unitKey(out[1]), unitKey(out[2]));
});
test('same PK with a different campus is not linked', () => {
  const out = linkR27([past(2026, 'old'), past(2026, 'old', 'campus-b'), next('new', 'scope-a', [link(2026, 'old')])], school);
  assert.equal(unitKey(out[0]), unitKey(out[2]));
  assert.notEqual(unitKey(out[1]), unitKey(out[2]));
});
test('two 2027 scopes claiming the same row do not acquire it', () => {
  const out = linkR27([past(2026, 'old'), next('new-a', 'scope-a', [link(2026, 'old')]), next('new-b', 'scope-b', [link(2026, 'old')])], school);
  assert.notEqual(unitKey(out[0]), unitKey(out[1]));
  assert.notEqual(unitKey(out[0]), unitKey(out[2]));
  assert.notEqual(unitKey(out[1]), unitKey(out[2]));
});
test('old v1 rows keep their existing grouping', () => {
  const out = linkR27([past(2024, 'old'), past(2026, 'old')], school);
  assert.equal(unitKey(out[0]), unitKey(out[1]));
});
test('missing scope cannot create a new historical link', () => {
  const out = linkR27([past(2026, 'same'), next('same', undefined, [link(2026, 'same')])], school);
  assert.notEqual(unitKey(out[0]), unitKey(out[1]));
});
test('a scope used by two 2027 rows links neither and keeps them apart', () => {
  const out = linkR27([past(2026, 'old'), next('a', 'scope-a', [link(2026, 'old')]), next('b', 'scope-a', [link(2026, 'old')])], school);
  assert.equal(new Set(out.map(unitKey)).size, 3);
});
test('rows without campus or track link when the server sends null for them', () => {
  const bare = { y: 2026, pk: 'old', ob: null, c: null, t: null, g: 'ga' };
  const out = linkR27([bare, { y: 2027, pk: 'new', ob: null, c: null, t: null, g: 'ga', scope27: 'scope-a',
    hl: [{ academic_year: 2026, school_id: school, original_pk: 'old', campus: null, admission_track: null, group: 'ga' }] }], school);
  assert.equal(unitKey(out[0]), unitKey(out[1]));
});
test('a reviewed link to a year whose track or group name differed still links', () => {
  const older = { y: 2025, pk: 'old', ob: null, c: 'campus-a', t: 'track-old', g: 'na' };
  const out = linkR27([older, next('new', 'scope-a', [{ academic_year: 2025, school_id: school, original_pk: 'old', campus: 'campus-a', admission_track: 'track-old', group: 'na' }])], school);
  assert.equal(unitKey(out[0]), unitKey(out[1]));
});
test('a link naming another school is ignored', () => {
  const out = linkR27([past(2026, 'old'), next('new', 'scope-a', [{ ...link(2026, 'old'), school_id: 'other' }])], school);
  assert.notEqual(unitKey(out[0]), unitKey(out[1]));
});
test('generated keys fit the action contract and do not mutate input', () => {
  const rows = [past(2026, 'old'), next('new', 'scope-a', [link(2026, 'old')])], original = structuredClone(rows);
  const out = linkR27(rows, school);
  assert.match(unitKey(out[1]), /^r27:(?:0|[1-9][0-9]{0,9})$/);
  assert.deepEqual(rows, original);
});
