import {
  type CatalogDescriptorReviewClaims,
  catalogRootReviewEndKey,
  makeCatalogRootOnlyMemoryReader,
  prepareCatalogDescriptorReview as prepareWithVerifier,
} from "./current_public_catalog_descriptor_review.ts";
import {
  CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS,
  CURRENT_PUBLIC_SOURCE_VIEWS,
  verifyPublicCatalogDescriptor,
} from "./current_public_catalog_sql.ts";
import {
  comparePublicCatalogKeys,
  CURRENT_PUBLIC_OPERATIONS,
  type PublicCatalogKey,
} from "./current_public_catalog.ts";
import {
  prepareCurrentPublicKeyIndexV3,
  type PublicKeyIndexEntry,
  publicKeyRawHash,
} from "./current_public_key_index.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import { utcInstant } from "./jungsi/domain/time.ts";

const prepareCatalogDescriptorReview = (
  previous: Uint8Array,
  root: Uint8Array,
  claims: CatalogDescriptorReviewClaims,
) => prepareWithVerifier(previous, root, claims, verifyPublicCatalogDescriptor);

const enc = new TextEncoder();
const H = (c: string) => c.repeat(64);
const assert = (condition: unknown, label = "assertion") => {
  if (!condition) throw new Error(label);
};
async function rejects(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (e) {
    assert(
      e instanceof Error && e.message === "CATALOG_DESCRIPTOR_REVIEW_REJECTED",
      "unsafe_error",
    );
    return;
  }
  throw new Error("expected_rejection");
}

async function fixture() {
  const metadata = H("a"),
    guideState = Object.fromEntries(
      CURRENT_PUBLIC_GUIDE_COMMAND_RELATIONS.map((x) => [x, { count: 0, sha256: H("b") }]),
    );
  const guideHash = await nativeJsonSha256(guideState);
  const head = { command_id: "synthetic-head-new", payload_sha256: H("c") };
  const history: PublicKeyIndexEntry[] = [{
    key: [2026, "school-example", "unit-example", "metric-example", "example-result"],
    sourceKind: "admission",
    guide: null,
    nativeOfferingId: "2026:unit-example",
    expectedFingerprint: H("d"),
    search: { university: "example", department: "example", region: "", group: "" },
  }];
  const snapshotSha = await nativeJsonSha256({ history, offerings: [], lookups: [] });
  const root = await prepareCurrentPublicKeyIndexV3({
    history,
    offerings: [],
    lookups: [],
    metadataSha256: metadata,
    guideCommandStateSha256: guideHash,
    admissionHead: head,
    coverage: {
      scope: "all_eligible_current_db_observations_at_head",
      review_receipt_sha256: H("e"),
      snapshot_sha256: snapshotSha,
      history_rows: 1,
    },
    objectPrefix: "synthetic/catalog/rebind/",
  });
  const rootBytes = root.objects.get(root.root.object_key);
  if (!rootBytes) throw new Error("synthetic_root_absent");
  const previous = {
    format: "jungsi.current-public-catalog-publication/v2",
    version: "synthetic-old",
    issued_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-12-01T00:00:00Z",
    approval_reference_sha256: H("1"),
    consumer_binding_sha256: H("2"),
    metadata_sha256: metadata,
    operations: [...CURRENT_PUBLIC_OPERATIONS],
    source_views: { ...CURRENT_PUBLIC_SOURCE_VIEWS },
    general_publication_allowed: true,
    nationwide_current: true,
    active_service_only: true,
    incomplete_metadata: "hold_per_observation",
    order: "academic_year_school_offering_metric_canonical_C",
    counts: "unknown",
    engine_activation: false,
    max_page_rows: 101,
    guide_command_state: guideState,
    key_index: { object_key: "synthetic/old/root." + H("3") + ".json", bytes: 10, sha256: H("3") },
    coverage_receipt_sha256: H("4"),
    admission_head: { command_id: "synthetic-old-head", payload_sha256: H("5") },
  };
  const previousBytes = enc.encode(nativeJsonText(previous, true));
  const claims: CatalogDescriptorReviewClaims = {
    previousDescriptorSha256: await publicKeyRawHash(previousBytes),
    consumerBindingSha256: H("2"),
    metadataSha256: metadata,
    guideCommandStateSha256: guideHash,
    admissionHead: head,
    coverageReceiptNativeSha256: H("e"),
    projectionNativeSha256: snapshotSha,
    approvalReferenceSha256: H("6"),
    candidateVersion: "synthetic-new",
    nowUtc: utcInstant("2026-06-01T00:00:00Z"),
    bucket: "synthetic-private",
    expectedBucket: "synthetic-private",
    objectPrefix: "synthetic/catalog/rebind/",
    rootReference: { ...root.root },
  };
  return { previous, previousBytes, rootBytes: new Uint8Array(rootBytes), claims };
}

interface SyntheticRoot {
  format: string;
  history: Array<{
    first: PublicCatalogKey;
    last: PublicCatalogKey;
    reference: { object_key: string; sha256: string };
  }>;
}

async function updateRoot(
  f: Awaited<ReturnType<typeof fixture>>,
  mutate: (r: SyntheticRoot) => void,
) {
  const value = JSON.parse(new TextDecoder().decode(f.rootBytes)) as SyntheticRoot;
  mutate(value);
  f.rootBytes = enc.encode(JSON.stringify(value));
  const sha256 = await publicKeyRawHash(f.rootBytes);
  f.claims.rootReference = {
    object_key: f.claims.objectPrefix + "root." + sha256 + ".json",
    bytes: f.rootBytes.length,
    sha256,
  };
}

Deno.test("synthetic normal produces review-only with original validity window", async () => {
  const f = await fixture();
  const result = await prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims);
  const d = JSON.parse(result.candidateDescriptorJson);
  assert(result.status === "HOLD_REVIEW_ONLY");
  assert(result.descriptorVerifierAuthorityVerified === false);
  assert(result.independentApprovalVerified === false && result.currentHeadVerified === false);
  assert(result.currentTimeVerified === false && result.consumerBindingVerified === false);
  assert(
    result.coverageReceiptVerified === false && result.previousDescriptorCurrentVerified === false,
  );
  assert(result.bucketAuthorizationVerified === false);
  assert(result.remoteStorageVerified === false && result.shardContentsVerified === false);
  assert(result.expirationExtended === false);
  assert(d.issued_at === f.previous.issued_at && d.expires_at === f.previous.expires_at);
  assert(d.consumer_binding_sha256 === f.previous.consumer_binding_sha256);
  assert(d.admission_head.command_id === f.claims.admissionHead.command_id);
  assert(d.coverage_receipt_sha256 === f.claims.coverageReceiptNativeSha256);
  assert(
    await publicKeyRawHash(enc.encode(result.candidateDescriptorJson)) ===
      result.candidateDescriptorSha256,
  );
});

Deno.test("synthetic all caller-created claims remain HOLD", async () => {
  const f = await fixture();
  const result = await prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims);
  assert(result.status === "HOLD_REVIEW_ONLY" && result.independentApprovalVerified === false);
});

Deno.test("prior descriptor digest and unchanged version are checked", async () => {
  const f = await fixture();
  f.claims.previousDescriptorSha256 = H("0");
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  const g = await fixture();
  g.claims.candidateVersion = g.previous.version;
  await rejects(() => prepareCatalogDescriptorReview(g.previousBytes, g.rootBytes, g.claims));
});

Deno.test("consumer, metadata and guide claims must match previous descriptor", async () => {
  for (
    const key of ["consumerBindingSha256", "metadataSha256", "guideCommandStateSha256"] as const
  ) {
    const f = await fixture();
    f.claims[key] = H("0");
    await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  }
});

Deno.test("head, coverage and snapshot claims must match root", async () => {
  for (const key of ["coverageReceiptNativeSha256", "projectionNativeSha256"] as const) {
    const f = await fixture();
    f.claims[key] = H("0");
    await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  }
  const f = await fixture();
  f.claims.admissionHead.command_id = "other-synthetic-head";
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
});

Deno.test("root hash, byte count and V3 format are required", async () => {
  const f = await fixture();
  f.rootBytes[0] ^= 1;
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  const g = await fixture();
  g.claims.rootReference.bytes += 1;
  await rejects(() => prepareCatalogDescriptorReview(g.previousBytes, g.rootBytes, g.claims));
  const h = await fixture();
  await updateRoot(h, (r) => {
    r.format = "jungsi.current-public-key-index/v2";
  });
  await rejects(() => prepareCatalogDescriptorReview(h.previousBytes, h.rootBytes, h.claims));
});

Deno.test("bucket, root object path and child prefix must match", async () => {
  const f = await fixture();
  f.claims.bucket = "different-synthetic-bucket";
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  const g = await fixture();
  g.claims.rootReference.object_key = "other/root." + g.claims.rootReference.sha256 + ".json";
  await rejects(() => prepareCatalogDescriptorReview(g.previousBytes, g.rootBytes, g.claims));
  const h = await fixture();
  await updateRoot(h, (r) => {
    r.history[0].reference.object_key = "other-prefix/object." + r.history[0].reference.sha256 +
      ".json";
  });
  await rejects(() => prepareCatalogDescriptorReview(h.previousBytes, h.rootBytes, h.claims));
});

Deno.test("time validity and expiry are fail closed", async () => {
  const f = await fixture();
  f.claims.nowUtc = utcInstant("2026-12-01T00:00:00Z");
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  const g = await fixture();
  g.claims.nowUtc = -1n;
  await rejects(() => prepareCatalogDescriptorReview(g.previousBytes, g.rootBytes, g.claims));
  const h = await fixture();
  h.claims.nowUtc = utcInstant("2025-12-31T23:59:59Z");
  await rejects(() => prepareCatalogDescriptorReview(h.previousBytes, h.rootBytes, h.claims));
});

Deno.test("mutable bytes and head are captured before async work", async () => {
  const f = await fixture();
  const expectedHead = f.claims.admissionHead.command_id;
  const pending = prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims);
  f.previousBytes.fill(0);
  f.rootBytes.fill(0);
  f.claims.admissionHead.command_id = "changed-after-call";
  const out = await pending;
  assert(out.status === "HOLD_REVIEW_ONLY");
  assert(JSON.parse(out.candidateDescriptorJson).admission_head.command_id === expectedHead);
});

Deno.test("shared buffers and accessor claims do not enter validation", async () => {
  const f = await fixture();
  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(f.rootBytes.length));
    shared.set(f.rootBytes);
    await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, shared, f.claims));
  }
  const g = await fixture();
  Object.defineProperty(g.claims, "metadataSha256", { enumerable: true, get: () => H("a") });
  await rejects(() => prepareCatalogDescriptorReview(g.previousBytes, g.rootBytes, g.claims));
});

Deno.test("maximum key equals itself and exceeds every tested valid previous boundary", () => {
  const end = catalogRootReviewEndKey();
  assert((end[1] as string).length === 256);
  assert(comparePublicCatalogKeys(end, end) === 0);
  const justBefore: PublicCatalogKey = [...end];
  justBefore[4] = String.fromCodePoint(0x10ffff).repeat(127);
  assert(comparePublicCatalogKeys(justBefore, end) < 0);
  const priorYear: PublicCatalogKey = [2026, end[1], end[2], end[3], end[4]];
  assert(comparePublicCatalogKeys(priorYear, end) < 0);
});

Deno.test("root-only reader returns copies and refuses shard reads", async () => {
  const f = await fixture();
  const read = makeCatalogRootOnlyMemoryReader(f.claims.rootReference, f.rootBytes);
  const first = await read(f.claims.rootReference);
  first.fill(0);
  const second = await read(f.claims.rootReference);
  assert(await publicKeyRawHash(second) === f.claims.rootReference.sha256);
  await rejects(() =>
    read({ ...f.claims.rootReference, object_key: "synthetic/catalog/rebind/shard.json" })
  );
});

Deno.test("equal and immediately previous root boundaries skip shards and remain HOLD", async () => {
  for (const equal of [true, false]) {
    const f = await fixture();
    const end = catalogRootReviewEndKey();
    const boundary: PublicCatalogKey = [...end];
    if (!equal) boundary[4] = String.fromCodePoint(0x10ffff).repeat(127);
    await updateRoot(f, (r) => {
      r.history[0].first = boundary;
      r.history[0].last = boundary;
    });
    const result = await prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims);
    assert(result.status === "HOLD_REVIEW_ONLY" && result.shardContentsVerified === false);
  }
});

Deno.test("prototype-altered SharedArrayBuffer remains rejected", async () => {
  if (typeof SharedArrayBuffer === "undefined") return;
  const f = await fixture();
  const backing = new SharedArrayBuffer(f.rootBytes.length);
  const shared = new Uint8Array(backing);
  shared.set(f.rootBytes);
  Object.setPrototypeOf(backing, null);
  assert(!(backing instanceof SharedArrayBuffer));
  await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, shared, f.claims));
});

Deno.test("review envelope is immune to inherited toJSON pollution", async () => {
  const f = await fixture();
  let invoked = false;
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() {
      invoked = true;
      throw new Error("synthetic_prototype_leak");
    },
  });
  try {
    const out = await prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims);
    assert(Object.getPrototypeOf(out) === null);
    const serialized = JSON.stringify(out);
    assert(serialized.includes("HOLD_REVIEW_ONLY") && !invoked);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "toJSON", original);
    else delete (Object.prototype as Record<string, unknown>).toJSON;
  }
});

Deno.test("bucket follows runtime underscore, dot, and 100-character contract", async () => {
  for (const name of ["synthetic_private", "a".repeat(100)]) {
    const f = await fixture();
    f.claims.bucket = name;
    f.claims.expectedBucket = name;
    assert(
      (await prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims)).status ===
        "HOLD_REVIEW_ONLY",
    );
  }
  for (const name of ["synthetic.private", "a".repeat(101), "Uppercase"]) {
    const f = await fixture();
    f.claims.bucket = name;
    f.claims.expectedBucket = name;
    await rejects(() => prepareCatalogDescriptorReview(f.previousBytes, f.rootBytes, f.claims));
  }
});

Deno.test("verifier cannot return a different descriptor or mutate passed bytes", async () => {
  const f = await fixture();
  await rejects(() =>
    prepareWithVerifier(f.previousBytes, f.rootBytes, f.claims, async (bytes, sha, clock) => {
      const out = await verifyPublicCatalogDescriptor(bytes, sha, clock);
      out.descriptor.version = "swapped-synthetic-version";
      return out;
    })
  );
  const g = await fixture();
  await rejects(() =>
    prepareWithVerifier(g.previousBytes, g.rootBytes, g.claims, async (bytes, sha, clock) => {
      const copy = new Uint8Array(bytes);
      bytes.fill(0);
      return await verifyPublicCatalogDescriptor(copy, sha, clock);
    })
  );
});

Deno.test("retained verifier object cannot mutate the captured previous descriptor", async () => {
  const f = await fixture();
  let first: { version: string } | null = null;
  const out = await prepareWithVerifier(
    f.previousBytes,
    f.rootBytes,
    f.claims,
    async (bytes, sha, clock) => {
      const value = await verifyPublicCatalogDescriptor(bytes, sha, clock);
      if (first === null) first = value.descriptor;
      else first.version = "changed-after-capture";
      return value;
    },
  );
  assert(out.status === "HOLD_REVIEW_ONLY");
  assert(JSON.parse(out.candidateDescriptorJson).version === f.claims.candidateVersion);
  assert(out.descriptorVerifierAuthorityVerified === false);
});

Deno.test("no-op verifier and getter-laden verification object are rejected", async () => {
  const f = await fixture();
  await rejects(() =>
    prepareWithVerifier(f.previousBytes, f.rootBytes, f.claims, () => Promise.resolve(undefined))
  );
  const g = await fixture();
  await rejects(() =>
    prepareWithVerifier(g.previousBytes, g.rootBytes, g.claims, async (bytes, sha, clock) => {
      const result = await verifyPublicCatalogDescriptor(bytes, sha, clock);
      Object.defineProperty(result.descriptor, "version", {
        enumerable: true,
        get: () => "synthetic-old",
      });
      return result;
    })
  );
});

Deno.test("untrusted verifier can never authenticate its own claims", async () => {
  const f = await fixture();
  let calls = 0;
  const forgedVerifier = (bytes: Uint8Array, sha: string) => {
    calls++;
    const descriptor = JSON.parse(new TextDecoder().decode(bytes));
    return Promise.resolve({
      descriptor,
      publication: {
        version: descriptor.version,
        sha256: sha,
        expiresAtUtc: utcInstant(descriptor.expires_at),
      },
    });
  };
  const out = await prepareWithVerifier(f.previousBytes, f.rootBytes, f.claims, forgedVerifier);
  assert(calls === 2 && out.status === "HOLD_REVIEW_ONLY");
  assert(
    out.descriptorVerifierAuthorityVerified === false && out.independentApprovalVerified === false,
  );
  assert(out.descriptorRuntimeContractVerified === false);
});

Deno.test("forged verifier cannot bypass old approval hash format", async () => {
  const f = await fixture();
  const old = JSON.parse(new TextDecoder().decode(f.previousBytes));
  old.approval_reference_sha256 = "not-a-hash";
  f.previousBytes = enc.encode(JSON.stringify(old));
  f.claims.previousDescriptorSha256 = await publicKeyRawHash(f.previousBytes);
  const forgedVerifier = (bytes: Uint8Array, sha: string) => {
    const descriptor = JSON.parse(new TextDecoder().decode(bytes));
    return Promise.resolve({
      descriptor,
      publication: {
        version: descriptor.version,
        sha256: sha,
        expiresAtUtc: utcInstant(descriptor.expires_at),
      },
    });
  };
  await rejects(() => prepareWithVerifier(f.previousBytes, f.rootBytes, f.claims, forgedVerifier));
});
