/** In-memory synthetic fixtures only. Hashes and test authorities do not issue real approval. */
import { nativeJsonSha256, nativeJsonText } from "../domain/json_value.ts";
import {
  type ApprovedScopePin,
  CurrentGuideReviewedScopeIssuer,
  type ScopeClaim,
  type ScopeRequest,
} from "./current_guide_scope_issuer.campus.review-only.ts";

const SOURCE = "a".repeat(64),
  SOURCE_HEAD = "b".repeat(64),
  GUIDE_HEAD = "c".repeat(64),
  PUBLICATION = "d".repeat(64),
  EVIDENCE = "e".repeat(64);
const encode = (v: unknown) => new TextEncoder().encode(nativeJsonText(v));
const sha = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>))].map((
    x,
  ) => x.toString(16).padStart(2, "0")).join("");
function assert(x: unknown, why = "assertion_failed"): asserts x {
  if (!x) throw new Error(why);
}
type Obj = Record<string, unknown>;
const ident = (r: Obj) =>
  Object.fromEntries(
    ["academic_year", "school_id", "original_pk", "campus", "admission_track", "group"].map((
      k,
    ) => [k, r[k]]),
  );
function row(i: number): Obj {
  return {
    academic_year: 2027,
    school_id: "SYN-SCHOOL",
    original_pk: `SYN-${String(i).padStart(3, "0")}`,
    campus: "SYN-CAMPUS",
    admission_track: "SYN-TRACK",
    group: "A",
    university_name: "SYN-UNIVERSITY",
    department: "SYN-DEPARTMENT",
    scope: { state: "eligible_non_practical", evidence_sha256: EVIDENCE },
    source_ref: "SYN-PRIVATE",
    quota_value: i,
    quota_stage: "initial",
  };
}
export function request(): ScopeRequest {
  return {
    execution: { operation: "history.current-page", session: { user: { subjectId: "SYN-USER" } } },
    boundary: {
      signal: new AbortController().signal,
      admission: Object.freeze({ synthetic: true }),
    },
    pins: {
      subject: "SYN-USER",
      guide_head_sha256: GUIDE_HEAD,
      guide_publication_sha256: PUBLICATION,
    },
  };
}
export async function fixture(
  n: number,
  batch = 64,
  rowChanges: Record<number, Partial<Obj>> = {},
) {
  const rows = Array.from({ length: n }, (_, i) => ({ ...row(i), ...rowChanges[i] }));
  const claims: ScopeClaim[] = [],
    entries: Obj[] = [],
    pages: Uint8Array[] = [],
    receipts: Uint8Array[] = [];
  const pageHashes: string[] = [], receiptHashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    claims.push({
      target: {
        release_id: i % 2 ? "SYN-RELEASE-1" : "SYN-RELEASE-0",
        academic_year: 2027,
        school_id: r.school_id as string,
        offering_pk: r.original_pk as string,
      },
      rowFingerprint: await sha(encode(`SYN-GUIDE-${i}`)),
      offering: {
        campus: r.campus as string | null,
        admission_track: r.admission_track as string | null,
        group: r.group as string | null,
      },
    });
  }
  for (let i = 0; i < n; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const page = encode({
      format: "jungsi.r27-source-page/v1",
      source_sha256: SOURCE,
      source_head_sha256: SOURCE_HEAD,
      index: pages.length,
      rows: chunk,
    });
    const grants = chunk.filter((r) => (r.scope as Obj).state !== "review_pending").map((r) => ({
      source: ident(r),
      state: (r.scope as Obj).state,
      evidence_sha256: (r.scope as Obj).evidence_sha256,
    }));
    const receipt = encode({
      format: "jungsi.r27-reviewed-scope/v1",
      status: "approved_scope_mappings",
      source_sha256: SOURCE,
      grants,
    });
    pages.push(page);
    receipts.push(receipt);
    pageHashes.push(await sha(page));
    receiptHashes.push(await sha(receipt));
  }
  for (let i = 0; i < n; i++) {
    const r = rows[i], c = claims[i];
    entries.push({
      target: c.target,
      guide_head_sha256: GUIDE_HEAD,
      guide_row_sha256: c.rowFingerprint,
      source_page_sha256: pageHashes[Math.floor(i / batch)],
      source_row_sha256: await nativeJsonSha256(r),
      scope_receipt_sha256: receiptHashes[Math.floor(i / batch)],
      enrollment: "CONFIRMED",
      enrollment_evidence_sha256: EVIDENCE,
      user_hold: false,
      identity_states: Object.fromEntries(
        ["campus", "admission_track", "group"].map((
          k,
        ) => [k, r[k] === null ? "confirmed_null" : "confirmed_value"]),
      ),
    });
  }
  let manifest = new Uint8Array(),
    approved: ApprovedScopePin | null = null,
    readerCalls = 0,
    currentCalls = 0,
    falseCurrent = false;
  const seal = async () => {
    manifest = encode({
      format: "jungsi.reviewed-current-guide-scope/v1",
      status: "approved",
      source_sha256: SOURCE,
      source_head_sha256: SOURCE_HEAD,
      guide_head_sha256: GUIDE_HEAD,
      guide_publication_sha256: PUBLICATION,
      entries,
    });
    approved = {
      manifest_sha256: await sha(manifest),
      source_sha256: SOURCE,
      source_head_sha256: SOURCE_HEAD,
      guide_head_sha256: GUIDE_HEAD,
      guide_publication_sha256: PUBLICATION,
    };
  };
  await seal();
  const authority = {
    authorize: (_ctx: ScopeRequest) => Promise.resolve(approved),
    assertCurrent: (_ctx: ScopeRequest, _pin: ApprovedScopePin) => {
      currentCalls++;
      return Promise.resolve(falseCurrent ? false : undefined) as Promise<void>;
    },
  };
  const reader = {
    read: (_ctx: ScopeRequest, _pin: ApprovedScopePin, selected: readonly ScopeClaim[]) => {
      readerCalls++;
      assert(selected.length <= 101);
      return Promise.resolve({ manifest, sourcePages: pages, receipts });
    },
  };
  return {
    rows,
    claims,
    entries,
    pages,
    receipts,
    pageHashes,
    receiptHashes,
    authority,
    reader,
    seal,
    setUnapproved: () => {
      approved = null;
    },
    setPin: (p: ApprovedScopePin) => {
      approved = p;
    },
    getPin: () => approved!,
    setFalseCurrent: () => {
      falseCurrent = true;
    },
    counts: () => ({ readerCalls, currentCalls }),
    run: (ctx = request(), selected = claims) =>
      new CurrentGuideReviewedScopeIssuer(authority, reader, { assertActive() {} })
        .verifyGuideScope(ctx, selected),
  };
}
