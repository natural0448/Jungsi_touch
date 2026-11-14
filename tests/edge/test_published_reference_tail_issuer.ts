// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic authority tests; actual operating head and receipt are separate. */
import { PublishedReferenceTailIssuer } from "../../supabase/functions/_shared/jungsi/infrastructure/published_reference_tail_issuer.ts";
import {
  nativeJsonSha256,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64), signal = () => new AbortController().signal;
async function rejected(f: () => Promise<unknown>) {
  let bad = false;
  try {
    await f();
  } catch {
    bad = true;
  }
  assert(bad);
}
async function fixture() {
  const ctx: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
  };
  const evidence: NativeObject = { independent_sha256: H("8") };
  const binding: NativeObject = {
    offering_id: "offering",
    physical_offering_pk: "physical",
    academic_year: 2027,
    rule_version: "rule",
  };
  const tail: NativeObject = {
    kind: "reference_tail",
    key: "tail",
    sha256: H("1"),
    bytes: 3,
    compatibility_key: "compat",
    reference_context: ctx,
    reference_evidence: evidence,
    reference_bindings: [binding],
    model_exam_pack_sha256: H("6"),
    source_review_sha256: H("2"),
    independent_review_sha256: H("3"),
  };
  const compat: NativeObject = {
    kind: "reference_compatibility",
    key: "compat",
    sha256: H("4"),
    version: "v1",
  };
  const receipt: NativeObject = {
    format: "jungsi.reference-model-compatibility/v1",
    version: "v1",
    status: "verified_reference",
    scope: "same_exam_mathematical_reference",
    tail_sha256: H("1"),
    exam_pack_sha256: H("5"),
    model_exam_pack_sha256: H("6"),
    ...ctx,
    context_sha256: await nativeJsonSha256(ctx),
    evidence_sha256: await nativeJsonSha256(evidence),
    source_review_sha256: H("2"),
    independent_review_sha256: H("3"),
  };
  const state = {
    selectionSha: H("a"),
    registrySha: H("b"),
    approvalSha: H("c"),
    examSha: H("5"),
    approved: true,
    reads: 0,
  };
  const provider = {
    async referenceSelection(s: AbortSignal) {
      if (s.aborted || !state.approved) throw Error("revoked");
      return {
        registrySha256: state.registrySha,
        selectionSha256: state.selectionSha,
        approvalReferenceSha256: state.approvalSha,
        tails: [{ key: "tail", entry: tail }],
        compatibilities: [{ key: "compat", entry: compat }],
      };
    },
    async referenceExamPin(_id: string, s: AbortSignal) {
      if (s.aborted) throw Error("aborted");
      return { key: "exam", sha256: state.examSha, version: "v1" };
    },
    async loadReferenceTail(_k: string, s: AbortSignal) {
      if (s.aborted) throw Error("aborted");
      state.reads++;
      return { entry: tail, bytes: new Uint8Array([1, 2, 3]) };
    },
    async loadReferenceCompatibility(_k: string, s: AbortSignal) {
      if (s.aborted) throw Error("aborted");
      state.reads++;
      return { entry: compat, payload: receipt };
    },
  };
  const issuer = new PublishedReferenceTailIssuer(provider, async (s) => {
    if (s.aborted) throw Error("aborted");
  });
  return { issuer, provider, ctx, evidence, binding, tail, compat, receipt, state };
}
Deno.test("issuer binds current selected tail, report offering and exact exam compatibility", async () => {
  const f = await fixture(), s = signal(), pin = await f.issuer.select("offering", s);
  assert(pin !== null);
  equal([...await f.issuer.read("tail", 3, s)], [1, 2, 3]);
  const identity: NativeObject = { ...f.ctx, offering_id: "offering" };
  await f.issuer.assertCompatible(pin, identity, s);
  const proof = await f.issuer.verifiedProvenance(pin, identity, s);
  equal(proof.tail_sha256, H("1"));
  equal(proof.selection_sha256, H("a"));
  equal(proof.offering_id, "offering");
});
Deno.test("issuer refuses missing, duplicate or unselected offering", async () => {
  const f = await fixture(), s = signal();
  equal(await f.issuer.select("missing", s), null);
  (f.tail.reference_bindings as NativeObject[]).push({ ...f.binding });
  await rejected(() => f.issuer.select("offering", s));
});
Deno.test("issuer rejects changed head or approval before reading", async () => {
  const f = await fixture(), s = signal(), pin = await f.issuer.select("offering", s);
  assert(pin !== null);
  f.state.selectionSha = H("d");
  await rejected(() => f.issuer.read("tail", 3, s));
  equal(f.state.reads, 0);
  f.state.selectionSha = H("a");
  f.state.approved = false;
  await rejected(() => f.issuer.assertCurrent(pin, s));
});
Deno.test("issuer rejects pack, context, score axis, proof and recipient mismatches", async () => {
  for (const which of ["exam", "model", "context", "axis", "evidence", "owner"]) {
    const f = await fixture(), s = signal(), pin = await f.issuer.select("offering", s);
    assert(pin !== null);
    const identity: NativeObject = { ...f.ctx, offering_id: "offering" };
    if (which === "exam") f.state.examSha = H("f");
    if (which === "model") f.receipt.model_exam_pack_sha256 = H("f");
    if (which === "context") f.receipt.context_sha256 = H("f");
    if (which === "axis") identity.score_scale_id = "other";
    if (which === "evidence") f.receipt.independent_review_sha256 = H("f");
    if (which === "owner") identity.offering_id = "other";
    await rejected(() => f.issuer.verifiedProvenance(pin, identity, s));
  }
});
Deno.test("issuer refuses forged pins, mismatched object sizes and cancelled operations", async () => {
  const f = await fixture(),
    c = new AbortController(),
    pin = await f.issuer.select("offering", c.signal);
  assert(pin !== null);
  await rejected(() => f.issuer.assertCurrent({ ...pin, sha256: H("f") }, c.signal));
  await rejected(() => f.issuer.read("tail", 4, c.signal));
  c.abort();
  await rejected(() => f.issuer.read("tail", 3, c.signal));
});
Deno.test("same signal reuses receipt while separate scopes recheck it", async () => {
  const f = await fixture(), a = signal(), b = signal(), pin = await f.issuer.select("offering", a);
  assert(pin !== null);
  const identity: NativeObject = { ...f.ctx, offering_id: "offering" };
  await f.issuer.assertCompatible(pin, identity, a);
  await f.issuer.assertCompatible(pin, identity, a);
  equal(f.state.reads, 1);
  await f.issuer.assertCompatible(pin, identity, b);
  equal(f.state.reads, 2);
});

Deno.test("existing selection without a physical PK stays unavailable without inventing a link", async () => {
  const f = await fixture(), s = signal();
  delete f.tail.reference_bindings;
  f.tail.reference_context = { ...f.ctx, offering_ids: ["2027:123"] };
  equal(await f.issuer.select("2027:123", s), null);
});
Deno.test("selected offering list is removed from the exact saved scoring context", async () => {
  const f = await fixture(), s = signal();
  f.tail.reference_context = { ...f.ctx, offering_ids: ["offering"] };
  const pin = await f.issuer.select("offering", s);
  assert(pin !== null);
  await f.issuer.assertCompatible(pin, { ...f.ctx, offering_id: "offering" }, s);
});

Deno.test("existing year:PK selection can reuse the already verified reference binding", async () => {
  const f = await fixture(), s = signal();
  delete f.tail.reference_bindings;
  f.tail.reference_context = { ...f.ctx, offering_ids: ["2027:123"] };
  const provider = f.provider as typeof f.provider & {
    getReference: (id: string) => Promise<unknown>;
  };
  provider.getReference = async (id) =>
    id === "2027:123"
      ? {
        binding: { academic_year: 2027, rule_version: "rule" },
        academicYear: 2027,
        examId: "exam",
        packVersion: "pack",
        examType: "september_mock",
        scoreScaleId: "axis",
      }
      : null;
  const pin = await f.issuer.select("2027:123", s);
  assert(pin !== null);
  equal(pin.binding.physical_offering_pk, "123");
  await f.issuer.assertCompatible(pin, { ...f.ctx, offering_id: "2027:123" }, s);
});

Deno.test("native DB exact-pack fallback uses existing selected proof without a new compatibility receipt", async () => {
  const f = await fixture(), s = signal();
  delete f.tail.compatibility_key;
  delete f.tail.model_exam_pack_sha256;
  f.ctx.source_pack_version = "v1";
  f.evidence.source_cdf_sha256 = H("9");
  const exact = new PublishedReferenceTailIssuer(f.provider, async (t) => {
    if (t.aborted) throw Error("aborted");
  }, true);
  equal(await f.issuer.select("offering", s), null);
  const pin = await exact.select("offering", s);
  assert(pin !== null);
  equal(exact.modelExamPackSha256(pin), f.state.examSha);
  const identity: NativeObject = { ...f.ctx, offering_id: "offering" };
  await exact.assertCompatible(pin, identity, s);
  const proof = await exact.verifiedProvenance(pin, identity, s);
  assert(typeof proof.compatibility_sha256 === "string");
  await rejected(() => exact.read("tail", 3, s));
  equal(f.state.reads, 0);
});
Deno.test("native DB exact-pack fallback rejects changed exam and partial compatibility metadata", async () => {
  const f = await fixture(), s = signal();
  delete f.tail.compatibility_key;
  delete f.tail.model_exam_pack_sha256;
  f.ctx.source_pack_version = "v1";
  f.evidence.source_cdf_sha256 = H("9");
  const exact = new PublishedReferenceTailIssuer(f.provider, async () => {}, true);
  const pin = await exact.select("offering", s);
  assert(pin !== null);
  f.state.examSha = H("f");
  await rejected(() => exact.assertCompatible(pin, { ...f.ctx, offering_id: "offering" }, s));
  f.tail.compatibility_key = "incomplete";
  await rejected(() => exact.select("offering", s));
});

Deno.test("selected calculator binds original rule independently from calculator version", async () => {
  const f = await fixture(), s = signal();
  const ref = {
    binding: { offering_pk: "offering", rule_version: "rule" },
    academicYear: 2027,
    examId: "exam",
    packVersion: "pack",
    examType: "september_mock",
    scoreScaleId: "axis",
    rule: { data: { rule_id: "source-rule", rule_version: "rule" } as NativeObject },
  };
  const provider = {
    ...f.provider,
    async getReference(id: string) {
      return id === "offering" ? ref : null;
    },
  };
  const issuer = new PublishedReferenceTailIssuer(provider, async (t) => {
    if (t.aborted) throw Error("abort");
  });
  const pin = await issuer.select("offering", s);
  assert(pin !== null);
  equal(await issuer.sourceRuleId(pin, s), "source-rule");
  ref.rule.data.rule_version = "wrong";
  await rejected(() => issuer.sourceRuleId(pin, s));
  ref.rule.data.rule_version = "rule";
  ref.binding.offering_pk = "other";
  await rejected(() => issuer.sourceRuleId(pin, s));
  ref.binding.offering_pk = "offering";
  ref.examType = "wrong";
  await rejected(() => issuer.sourceRuleId(pin, s));
});
