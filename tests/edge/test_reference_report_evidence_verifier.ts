// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic immutable revisions; production grants and head are not implied. */
import { ImmutableReferenceReportVerifier } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_report_evidence_verifier.ts";
import {
  nativeJsonSha256,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";
import type { IssuedTailPin } from "../../supabase/functions/_shared/jungsi/infrastructure/published_reference_tail_issuer.ts";
import { assert, equal } from "./fixture.ts";
const H = (s: string) => s.repeat(64);
async function fixture() {
  const context: NativeObject = {
    academic_year: 2027,
    exam_id: "exam",
    exam_type: "september_mock",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
  };
  const provenance: NativeObject = {
    release_sha256: H("1"),
    selection_sha256: H("2"),
    tail_sha256: H("3"),
    compatibility_sha256: H("4"),
    academic_year: 2027,
    exam_id: "exam",
    source_pack_version: "pack",
    rule_version: "rule",
    score_scale_id: "axis",
    offering_id: "offering",
  };
  const pin: IssuedTailPin = {
    key: "tail",
    sha256: H("3"),
    bytes: 1,
    maxBytes: 1,
    releaseSha256: H("1"),
    selectionSha256: H("2"),
    compatibilitySha256: H("4"),
    binding: { offering_id: "offering" },
    context,
    evidence: {},
  };
  const ref: NativeObject = {
    status: "reference",
    estimated_upper_cumulative_percent_all_examinees: "20",
    metric: "upper",
    calculation_review_scope: "same_exam_mathematical_reference",
    production_allowed: false,
    actual_admission_full_total_approved: false,
    denominator_kind: "all_examinees",
  };
  const { denominator_kind: _, ...groupRef } = ref;
  const assessment: NativeObject = { offering_id: "offering", reference_percentile: ref };
  const item: NativeObject = {
    issued_revision: 1,
    value_sha256: await nativeJsonSha256(ref),
    provenance,
  };
  const groups: NativeObject[] = [{
    offerings: [{ offering: { offering_id: "offering" }, reference_percentile: groupRef }],
  }];
  const candidate: NativeObject = {
    issued_revision: 2,
    value_sha256: await nativeJsonSha256(groups),
    selection_sha256: H("2"),
    offering_ids: ["offering"],
  };
  const body: NativeObject = {
    analyses: { offering: assessment },
    candidates: { reference_university_groups: groups },
    _reference_evidence: {
      format: "jungsi.reference-result-provenance/v1",
      owner_id: "owner",
      report_id: "report",
      profile_id: "profile",
      assessments: { offering: item },
      candidates: candidate,
    },
  };
  const mk = (n: number): StoredReport => ({
    report_id: "report",
    owner_id: "owner",
    profile_id: "profile",
    revision: n,
    body: JSON.parse(JSON.stringify(body)),
    updated_at: "2026-11-09T00:00:00Z",
  });
  const first = mk(1),
    second = mk(2),
    current = mk(3),
    state = { reads: 0, revoked: false, wrongOwner: false };
  const verifier = new ImmutableReferenceReportVerifier(10, async (owner, id, n) => {
    state.reads++;
    if (owner !== "owner" || id !== "report") throw Error("wrong owner");
    const v = n === 1 ? first : n === 2 ? second : null;
    if (v && state.wrongOwner) return { ...v, owner_id: "other" };
    return v;
  }, {
    async select(id, s) {
      if (s.aborted || state.revoked) throw Error("revoked");
      return id === "offering" ? pin : null;
    },
    async verifiedProvenance(_p, _i, s) {
      if (s.aborted || state.revoked) throw Error("revoked");
      return provenance;
    },
  }, async (record, s) => {
    if (s.aborted || state.revoked || record.owner_id !== "owner") throw Error("unavailable");
  });
  return { current, first, second, verifier, state, item, candidate, pin, provenance };
}
Deno.test("reference assessment and candidate require exact owner revision and currently selected source", async () => {
  const f = await fixture(), s = new AbortController().signal;
  equal(await f.verifier.verifyAssessment(f.current, "offering", f.item, s), true);
  equal(await f.verifier.verifyCandidates(f.current, f.candidate, s), true);
  equal(f.state.reads, 2);
  await f.verifier.assertCurrent(f.current, s);
});
Deno.test("tampered current value or issued proof is withheld", async () => {
  for (const mode of ["value", "proof", "revision"]) {
    const f = await fixture(), s = new AbortController().signal;
    if (mode === "value") {
      ((f.current.body.analyses as NativeObject).offering as NativeObject).reference_percentile = {
        status: "forged",
      };
    }
    if (mode === "proof") {
      ((f.first.body._reference_evidence as NativeObject).assessments as NativeObject).offering = {
        issued_revision: 1,
        value_sha256: H("f"),
        provenance: {},
      };
    }
    if (mode === "revision") f.item.issued_revision = 9;
    equal(await f.verifier.verifyAssessment(f.current, "offering", f.item, s), false);
  }
});
Deno.test("candidate group cannot substitute another offering or reference value", async () => {
  const f = await fixture(), s = new AbortController().signal;
  const groups = (f.current.body.candidates as NativeObject)
    .reference_university_groups as NativeObject[];
  ((groups[0].offerings as NativeObject[])[0].offering as NativeObject).offering_id = "other";
  equal(await f.verifier.verifyCandidates(f.current, f.candidate, s), false);
});
Deno.test("revocation, other owner and request cancellation cannot validate evidence", async () => {
  const f = await fixture(), c = new AbortController();
  f.state.wrongOwner = true;
  let threw = false;
  try {
    await f.verifier.verifyAssessment(f.current, "offering", f.item, c.signal);
  } catch {
    threw = true;
  }
  assert(threw);
  f.state.revoked = true;
  threw = false;
  try {
    await f.verifier.assertCurrent(f.current, c.signal);
  } catch {
    threw = true;
  }
  assert(threw);
  c.abort();
  threw = false;
  try {
    await f.verifier.verifyCandidates(f.current, f.candidate, c.signal);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("report proof accepts only the matching currently verified DB or storage source", async () => {
  const f = await fixture(), s = new AbortController().signal;
  const wrong = {
    async select() {
      return f.pin;
    },
    async verifiedProvenance() {
      return { ...f.provenance, release_sha256: H("f") };
    },
  };
  const correct = {
    async select() {
      return f.pin;
    },
    async verifiedProvenance() {
      return f.provenance;
    },
  };
  const verifier = new ImmutableReferenceReportVerifier(
    10,
    async () => f.first,
    [wrong, correct],
    async () => {},
  );
  equal(await verifier.verifyAssessment(f.current, "offering", f.item, s), true);
  const denied = new ImmutableReferenceReportVerifier(
    10,
    async () => f.first,
    [wrong],
    async () => {},
  );
  equal(await denied.verifyAssessment(f.current, "offering", f.item, s), false);
});
