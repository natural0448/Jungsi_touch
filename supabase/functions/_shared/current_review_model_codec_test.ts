/** Explicit synthetic fixtures only. Native tests do not open a DB, network, env or source files. */
import {
  arrayOf, bytesHex, compactProof, compareUtf8, CURRENT35, decodeNode,
  decodeRecord, digestRecord, DISPLAY17, encodeNode, encodeRecord, expandProof,
  hexBytes, MEMBER32, merkleTree, nullable, POP7, ReadModelError, recordOf,
  sha256Bytes, sortedWire, TAG, typedNode, verifyMerkleProof, wireContentDigests,
} from "./current_review_model_codec.ts";
import type { CodecBudget, RecordShape, TlvNode } from "./current_review_model_codec.ts";

export const SYNTHETIC_BUDGET: CodecBudget = { maxBytes: 2_000_000, maxElements: 100_000, maxDepth: 32 };
export const SYNTHETIC_HASH = "11".repeat(32);
export const SYNTHETIC_BATCH = "00000000-0000-4000-8000-000000000001";
export type SyntheticObject = Record<string, unknown>;
export function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
export function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  const normalize = (x: unknown): string => JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v);
  assert(normalize(actual) === normalize(expected), message);
}
export function rejectsSync(fn: () => unknown, code?: string): void {
  let error: unknown;
  try { fn(); } catch (caught) { error = caught; }
  assert(error instanceof Error, "expected synchronous denial");
  if (code) assert(error instanceof ReadModelError && error.code === code, "wrong denial code");
}
export async function rejects(fn: () => Promise<unknown>, code?: string): Promise<void> {
  let error: unknown;
  try { await fn(); } catch (caught) { error = caught; }
  assert(error instanceof Error, "expected asynchronous denial");
  if (code) assert(error instanceof ReadModelError && error.code === code, "wrong denial code");
}
export function syntheticWireInput(id = "synthetic-canonical-001", school: string | null = "synthetic-school"): {
  current: SyntheticObject; members: SyntheticObject[]; population: SyntheticObject[];
} {
  const sourceId = `synthetic-source-${id}`;
  const base = {
    release_id: "synthetic-release-001", result_id: sourceId, academic_year: 2027,
    school_id: school, university_code: "synthetic-code", university: "합성대학교",
    recruit_group: "가", recruit_group_raw: null, department: "합성학과", track: null,
    offering_pk: "synthetic-private-pk-marker", anchor_2027_pks: null,
    metric_kind: "synthetic_metric", metric_value_literal: "0", metric_value_numeric: "0",
    metric_value_json_type: "number", cohort: null, statistic_label: "synthetic_average",
    active_service: true, source_path: "synthetic://private/forbidden-marker",
    source_sha256: SYNTHETIC_HASH, source_location: null, source_review_status: "synthetic_only",
    original_record_locator: null, field_presence_types: null, row_fingerprint: "22".repeat(32),
    curation_release_id: null, curation_fields: null, curation_evidence: null,
  };
  return {
    current: { ...base, result_id: id, source_result_id: sourceId, canonical_result_id: id,
      source_member_count: 1, management_status: "synthetic_review", overlap_review_key: null,
      source_row_fingerprint: base.row_fingerprint },
    members: [{ ...base, canonical_result_id: id, source_all29_sha256: "33".repeat(32), is_representative: true }],
    population: [{ result_id: id, academic_year: 2027, population_reference_year: 2027,
      reference_offering_pk: "synthetic-private-reference-marker", link_kind: "synthetic_aggregate",
      active_service: true, individual_offering_metric_inference_allowed: false }],
  };
}

Deno.test("RM codec: independent scalar byte vectors distinguish missing/null/empty/0/string0/bools", () => {
  const vectors: [TlvNode, string][] = [
    [{ tag: TAG.M, value: null }, "0000000000"],
    [{ tag: TAG.N, value: null }, "0100000000"],
    [{ tag: TAG.F, value: false }, "0200000000"],
    [{ tag: TAG.B, value: true }, "0300000000"],
    [{ tag: TAG.I, value: "0" }, "040000000130"],
    [{ tag: TAG.T, value: "0" }, "050000000130"],
    [{ tag: TAG.T, value: "" }, "0500000000"],
    [{ tag: TAG.T, value: "\uFEFF" }, "0500000003efbbbf"],
    [{ tag: TAG.T, value: "한" }, "0500000003ed959c"],
  ];
  for (const [node, expected] of vectors) {
    equal(bytesHex(encodeNode(node, SYNTHETIC_BUDGET)), expected);
    equal(decodeNode(hexBytes(expected), SYNTHETIC_BUDGET), node);
  }
  equal(new Set(vectors.map(([, wire]) => wire)).size, vectors.length);
  equal(bytesHex(encodeNode(typedNode("I", 0), SYNTHETIC_BUDGET)), vectors[4][1]);
  equal(bytesHex(encodeNode(typedNode("I", 0n), SYNTHETIC_BUDGET)), vectors[4][1]);
});

Deno.test("RM codec: closed fields, exact record order and scalar tags cannot be substituted", () => {
  const shape: RecordShape = [["label", nullable("T")], ["count", "I"], ["enabled", "B"]];
  const value = { label: null, count: 0, enabled: false };
  const encoded = encodeRecord(shape, value, SYNTHETIC_BUDGET);
  equal(bytesHex(encodeRecord(shape, { enabled: false, count: 0, label: null }, SYNTHETIC_BUDGET)), bytesHex(encoded));
  equal(decodeRecord(shape, encoded, SYNTHETIC_BUDGET), { label: null, count: "0", enabled: false });
  for (const invalid of [{ count: 0, enabled: false }, { ...value, unknown: null },
    { ...value, label: undefined }, { ...value, count: false }, { ...value, enabled: "false" },
    { ...value, count: -0 }, { ...value, count: 1.5 }, { ...value, count: Number.MAX_SAFE_INTEGER + 1 },
    { ...value, count: "00" }, { ...value, count: "+1" }, { ...value, count: "1e0" }]) {
    rejectsSync(() => encodeRecord(shape, invalid, SYNTHETIC_BUDGET));
  }
  const pairs = (decodeNode(encoded, SYNTHETIC_BUDGET).value as [string, TlvNode][]).slice().reverse();
  rejectsSync(() => decodeRecord(shape, encodeNode({ tag: TAG.R, value: pairs }, SYNTHETIC_BUDGET), SYNTHETIC_BUDGET));
  rejectsSync(() => encodeNode({ tag: TAG.R, value: [["a", typedNode("T", "x")], ["a", typedNode("T", "y")]] }, SYNTHETIC_BUDGET));
  rejectsSync(() => decodeRecord([["value", "I"]], encodeRecord([["value", "T"]], { value: "0" }, SYNTHETIC_BUDGET), SYNTHETIC_BUDGET));
});

Deno.test("RM codec: malformed UTF8, unpaired surrogates, length/trailing bytes and budgets fail closed", () => {
  for (const value of ["\uD800", "\uDC00", "x\uD800x"]) rejectsSync(() => typedNode("T", value));
  for (const wire of ["0500000001ff", "0500000002c080", "0500000003eda080", "050000000261", "ff00000000", "010000000100", "050000000000"]) {
    rejectsSync(() => decodeNode(hexBytes(wire), SYNTHETIC_BUDGET), "current_review_model_codec_invalid");
  }
  const values = typedNode(arrayOf(recordOf([["s", "T"]])), [{ s: "😀" }]);
  const wire = encodeNode(values, SYNTHETIC_BUDGET);
  for (const budget of [ { ...SYNTHETIC_BUDGET, maxBytes: wire.length - 1 },
    { ...SYNTHETIC_BUDGET, maxElements: 3 }, { ...SYNTHETIC_BUDGET, maxDepth: 1 } ]) {
    rejectsSync(() => encodeNode(values, budget)); rejectsSync(() => decodeNode(wire, budget));
  }
  for (const budget of [{ maxBytes: 0, maxElements: 1, maxDepth: 1 }, { ...SYNTHETIC_BUDGET, maxElements: Infinity }]) {
    rejectsSync(() => encodeNode(typedNode("T", ""), budget));
  }
  assert(compareUtf8("\uE000", "😀") < 0, "ordering must use UTF8 bytes, not UTF16 code units");
});

Deno.test("RM codec: UUID/hash and UTC microsecond wire values retain exact types", () => {
  for (const [shape, value] of [["U", SYNTHETIC_BATCH], ["H", SYNTHETIC_HASH], ["Z", "2026-10-10T03:17:00.000001Z"]] as const) {
    equal(decodeNode(encodeNode(typedNode(shape, value), SYNTHETIC_BUDGET), SYNTHETIC_BUDGET).value, value);
  }
  for (const value of ["2026-02-29T00:00:00.000000Z", "2026-10-10T03:17:00.000Z", "2026-10-10T12:17:00.000000+09:00", "2026-10-10T03:17:60.000000Z"]) {
    rejectsSync(() => typedNode("Z", value));
  }
  rejectsSync(() => typedNode("H", "AA".repeat(32)));
  rejectsSync(() => typedNode("U", SYNTHETIC_BATCH.toUpperCase().replace("0001", "ZZZZ")));
});

Deno.test("RM codec: published CURRENT35/MEMBER32/POP7/DISPLAY17 key order is exact", () => {
  const base = "release_id,result_id,academic_year,school_id,university_code,university,recruit_group,recruit_group_raw,department,track,offering_pk,anchor_2027_pks,metric_kind,metric_value_literal,metric_value_numeric,metric_value_json_type,cohort,statistic_label,active_service,source_path,source_sha256,source_location,source_review_status,original_record_locator,field_presence_types,row_fingerprint,curation_release_id,curation_fields,curation_evidence";
  equal(CURRENT35.map(([key]) => key), (base + ",source_result_id,canonical_result_id,source_member_count,management_status,overlap_review_key,source_row_fingerprint").split(","));
  equal(MEMBER32.map(([key]) => key), (base + ",canonical_result_id,source_all29_sha256,is_representative").split(","));
  equal(POP7.map(([key]) => key), "result_id,academic_year,population_reference_year,reference_offering_pk,link_kind,active_service,individual_offering_metric_inference_allowed".split(","));
  equal(DISPLAY17.map(([key]) => key), "academic_year,university,department,track,recruit_group,metric_kind,metric_value_literal,metric_value_json_type,metric_value_numeric_text,cohort,statistic_label,source_member_count,link_scopes,official_metadata,review_status,value_availability,hold_reasons".split(","));
  const fixture = syntheticWireInput();
  const pairs = decodeNode(encodeRecord(CURRENT35, fixture.current, SYNTHETIC_BUDGET), SYNTHETIC_BUDGET).value as [string, TlvNode][];
  equal(pairs.map(([key]) => key), CURRENT35.map(([key]) => key));
});

Deno.test("RM codec: multiset order invariance, member identity collision denial and population duplicate multiplicity", async () => {
  const fixture = syntheticWireInput();
  const second = { ...fixture.members[0], result_id: "synthetic-second-source", is_representative: false };
  const population2 = { ...fixture.population[0], population_reference_year: 2026 };
  const current = { ...fixture.current, source_member_count: 2 };
  const first = await wireContentDigests(SYNTHETIC_HASH, current, [fixture.members[0], second], [fixture.population[0], population2], SYNTHETIC_BUDGET);
  equal(await wireContentDigests(SYNTHETIC_HASH, current, [second, fixture.members[0]], [population2, fixture.population[0]], SYNTHETIC_BUDGET), first);
  await rejects(() => sortedWire(MEMBER32, [fixture.members[0], { ...fixture.members[0], department: "다른합성학과" }], SYNTHETIC_BUDGET));
  const single = await wireContentDigests(SYNTHETIC_HASH, fixture.current, fixture.members, fixture.population, SYNTHETIC_BUDGET);
  const duplicate = await wireContentDigests(SYNTHETIC_HASH, fixture.current, fixture.members, [...fixture.population, ...fixture.population], SYNTHETIC_BUDGET);
  assert(single.population !== duplicate.population && single.content !== duplicate.content, "population duplicates must count twice");
  equal(single.members, duplicate.members);
  const text0 = await wireContentDigests(SYNTHETIC_HASH, { ...fixture.current, metric_value_json_type: "string", metric_value_literal: '"0"' }, fixture.members, fixture.population, SYNTHETIC_BUDGET);
  assert(single.content !== text0.content, "numeric literal and JSON type are evidence, not coercible display text");
});

Deno.test("RM codec: independent digest preimage vector and domain separation", async () => {
  equal(await sha256Bytes(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const preimage = hexBytes("4a542d524d0001050000001073796e7468657469632d646f6d61696e0a0000001400000001050000000576616c7565050000000130");
  equal(await digestRecord("synthetic-domain", [["value", "T"]], { value: "0" }, SYNTHETIC_BUDGET), await sha256Bytes(preimage));
  assert(await digestRecord("synthetic-other", [["value", "T"]], { value: "0" }, SYNTHETIC_BUDGET) !== await sha256Bytes(preimage));
});

Deno.test("RM codec: empty/single/odd Merkle trees and compact binary proofs reject tampering", async () => {
  const empty = await merkleTree([], "synthetic-tenant", SYNTHETIC_BATCH, SYNTHETIC_BUDGET);
  equal(empty.proofs, []);
  assert(empty.root !== (await merkleTree([], "synthetic-other", SYNTHETIC_BATCH, SYNTHETIC_BUDGET)).root);
  const leaves = ["41".repeat(32), "42".repeat(32), "43".repeat(32)];
  const single = await merkleTree(leaves.slice(0, 1), "synthetic-tenant", SYNTHETIC_BATCH, SYNTHETIC_BUDGET);
  equal(single.root, leaves[0]); equal(single.proofs, [[]]);
  await verifyMerkleProof(leaves[0], 0, 1, [], leaves[0], SYNTHETIC_BUDGET);
  const tree = await merkleTree(leaves, "synthetic-tenant", SYNTHETIC_BATCH, SYNTHETIC_BUDGET);
  equal(tree.proofs[2][0], leaves[2]);
  for (let index = 0; index < leaves.length; index++) {
    const binary = compactProof(tree.proofs[index]); equal(binary.byteLength, 64);
    equal(expandProof(binary), tree.proofs[index]);
    await verifyMerkleProof(leaves[index], index, leaves.length, expandProof(binary), tree.root, SYNTHETIC_BUDGET);
  }
  await rejects(() => verifyMerkleProof("44".repeat(32), 0, 3, tree.proofs[0], tree.root, SYNTHETIC_BUDGET));
  await rejects(() => verifyMerkleProof(leaves[2], 2, 3, [leaves[0], tree.proofs[2][1]], tree.root, SYNTHETIC_BUDGET));
  await rejects(() => verifyMerkleProof(leaves[0], 0, 3, [...tree.proofs[0], SYNTHETIC_HASH], tree.root, SYNTHETIC_BUDGET));
  await rejects(() => verifyMerkleProof(leaves[0], 3, 3, tree.proofs[0], tree.root, SYNTHETIC_BUDGET));
  rejectsSync(() => expandProof(new Uint8Array(33)));
});
