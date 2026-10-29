/** Credential and SQL strings are synthetic; network and database ports are explicit fakes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { PublicResponseProjection } from "../../supabase/functions/_shared/jungsi/application/public_response.ts";
import {
  HistorySnapshotSource,
  parseBoundedSnapshotJson,
  readBoundedSnapshotStream,
  SNAPSHOT_HEAD_SQL,
  snapshotBytesSha256,
  type SnapshotHeadRow,
  type SnapshotTrustBinding,
  SupabaseSnapshotHead,
} from "../../supabase/functions/_shared/jungsi/infrastructure/history_snapshot_source.ts";
import {
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { JsonFloat } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
import {
  syntheticSnapshotBody,
  syntheticSnapshotStatisticsBody,
} from "./synthetic_history_snapshot.ts";
import {
  SYNTHETIC_QUALIFICATION_SCHEMA_JSON,
  syntheticQualifiableBody,
  syntheticQualificationArtifacts,
} from "./synthetic_history_qualification.ts";
import { assert, equal } from "./fixture.ts";
const encode = (raw: unknown) => new TextEncoder().encode(nativeJsonText(raw));
const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co",
  PREFIX = "SYNTHETIC/snapshot/";
function addHistoricalSourceReference(body: NativeObject) {
  const row = (body.rows as NativeObject[])[0];
  row.historical_cutoff_references = [{
    format: "jungsi.historical-cutoff-reference/v1",
    observation_id: "observation:" + "1".repeat(64),
    academic_year: row.academic_year,
    school_id: row.university_id,
    offering_pk: row.original_pk,
    value: "1.2500",
    unit: "%",
    status: "model_estimated",
    label: "추정상위누백(전체응시자)",
    scope: "historical_admission_cutoff",
    method_id: "estimated-whole-cohort-percentile:" + "2".repeat(64),
    release_id: "reference-percentile:" + "3".repeat(64),
    display_role: "independent_observation",
    statistic_label: null,
    reference_status: "CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",
    engine_approved: false,
    production_allowed: false,
  }];
}
function addHistoricalSourceReview(review: NativeObject) {
  review.historical_references = {
    format: "jungsi.history-reference-estimates/v1",
    release_id: "reference-percentile:" + "3".repeat(64),
    source_export_sha256: "4".repeat(64),
    head_readback_receipt_sha256: "5".repeat(64),
    metric: "estimated_upper_cumulative_percent_all_examinees",
    observation_count: 1,
    school_count: 1,
    engine_approved: false,
    production_allowed: false,
    display_scope: "historical_admission_only",
  };
}
for (const qualification of [false, true]) {
  Deno.test(
    "snapshot source binds historical reference review and preserves rank q=" +
      qualification,
    async () => {
      const f = await fixture({
        qualification,
        body: addHistoricalSourceReference,
        review: addHistoricalSourceReview,
      });
      const p = await f.source.current();
      assert(p.historicalReferences !== undefined);
      equal(p.fieldQualification !== undefined, qualification);
      const body = await f.source.read(p, p.full!);
      const row = (body.rows as NativeObject[])[0];
      equal(
        (row.historical_cutoff_references as NativeObject[])[0].value,
        "1.2500",
      );
      const wire = await f.source.representation(body);
      equal(await snapshotBytesSha256(wire.bytes), p.full!.gzipSha256);
      equal(
        Object.hasOwn(
          row.final_additional_admission_rank as NativeObject,
          "service_qualification",
        ),
        qualification,
      );
    },
  );
}
Deno.test("snapshot source rejects missing reference review changed release and promoted approval", async () => {
  for (
    const mode of [
      "missing-review",
      "wrong-release",
      "engine-approved",
      "production-allowed",
    ]
  ) {
    const f = await fixture({
      body: addHistoricalSourceReference,
      review: (review) => {
        if (mode === "missing-review") return;
        addHistoricalSourceReview(review);
        const d = review.historical_references as NativeObject;
        if (mode === "wrong-release") {
          d.release_id = "reference-percentile:" + "6".repeat(64);
        }
        if (mode === "engine-approved") d.engine_approved = true;
        if (mode === "production-allowed") d.production_allowed = true;
      },
    });
    await denied(async () => {
      const p = await f.source.current();
      await f.source.read(p, p.full!);
    }, "snapshot_invalid");
  }
});
Deno.test("snapshot qualified review loads exact grants without adding manifest keys and reuses original gzip", async () => {
  const f = await fixture({ qualification: true }),
    p = await f.source.current();
  assert(p.fieldQualification !== undefined);
  assert(!Object.hasOwn(f.manifest, "field_qualification"));
  const body = await f.source.read(p, p.full!),
    row = (body.rows as NativeObject[])[0],
    rank = row.final_additional_admission_rank as NativeObject;
  equal([
    rank.value,
    rank.unit,
    rank.status,
    (row.identity_review as NativeObject).status,
  ], [
    "17",
    null,
    "pending_metadata",
    "review_pending",
  ]);
  equal(
    ((rank.service_qualification as NativeObject)
      .normalized_service_fields as NativeObject).unit,
    "번",
  );
  const wire = await f.source.representation(body);
  const text = await new Response(
    new Blob([wire.bytes]).stream().pipeThrough(
      new DecompressionStream("gzip"),
    ),
  ).text();
  assert(text.includes("1.2300e+04") && text.includes('"unit":null'));
  equal(f.requests.filter((u) => u.endsWith("/qualification.json")).length, 1);
});
Deno.test("snapshot review grants leave a non-target legacy part pending", async () => {
  const f = await fixture({
      qualification: true,
      body: (body) => {
        const row = (body.rows as NativeObject[])[0],
          rank = row.final_additional_admission_rank as NativeObject;
        delete rank.service_qualification;
        row.original_pk = "SYNTHETIC-other";
        row.offering_id = "2026:SYNTHETIC-other";
        (rank.source_context as NativeObject).observation_id = "observation:" +
          "c".repeat(64);
      },
    }),
    p = await f.source.current(),
    body = await f.source.read(p, p.full!);
  const rank = (body.rows as NativeObject[])[0]
    .final_additional_admission_rank as NativeObject;
  equal(rank.status, "pending_metadata");
  assert(!Object.hasOwn(rank, "service_qualification"));
});
for (
  const mode of [
    "missing-review-grants",
    "missing-rank-q",
    "wrong-authority",
    "extra-subject",
    "changed-raw-cell",
  ]
) {
  Deno.test(
    "snapshot qualified source rejects independently pinned but inconsistent content " +
      mode,
    async () => {
      const f = await fixture({
        qualification: true,
        review: mode === "missing-review-grants"
          ? (r) => {
            delete r.field_qualification;
          }
          : undefined,
        body: (b) => {
          const rank = (b.rows as NativeObject[])[0]
            .final_additional_admission_rank as NativeObject;
          if (mode === "missing-rank-q") delete rank.service_qualification;
          if (mode === "changed-raw-cell") rank.value = "18";
        },
        qualificationDescriptor: (d) => {
          if (mode === "wrong-authority") d.authority_sha256 = "c".repeat(64);
          if (mode === "extra-subject") {
            const approvals = d.approvals as NativeObject[];
            approvals.push({
              ...approvals[0],
              subject: {
                ...approvals[0].subject as NativeObject,
                offering_pk: "SYNTHETIC-extra",
              },
            });
            d.subject_count = 2;
          }
        },
      });
      await denied(async () => {
        const p = await f.source.current();
        await f.source.read(p, p.full!);
      }, "snapshot_invalid");
    },
  );
}
for (
  const mode of [
    "manifest-extra-key",
    "review-extra-key",
    "receipt-private-locator",
    "receipt-overflow",
  ]
) {
  Deno.test(
    "snapshot qualification retains closed metadata and existing bounds " +
      mode,
    async () => {
      const f = await fixture({
        qualification: true,
        manifest: mode === "manifest-extra-key"
          ? (m) => {
            m.field_qualification = {};
          }
          : undefined,
        review: mode === "review-extra-key"
          ? (r) => {
            r.unregistered_qualification = {};
          }
          : undefined,
        qualificationDescriptor: (d) => {
          if (mode === "receipt-private-locator") {
            (d.receipt as NativeObject).object_key = "OTHER/private.json";
          }
          if (mode === "receipt-overflow") {
            (d.receipt as NativeObject).bytes = 24577;
          }
        },
      });
      await denied(() => f.source.current());
    },
  );
}
Deno.test("snapshot qualification cannot bypass the current head revocation check", async () => {
  const f = await fixture({ qualification: true }),
    p = await f.source.current();
  f.setRow((r) => ({ ...r, contentSha256: "0".repeat(64) }));
  await denied(() => f.source.read(p, p.full!), "publication_changed", 409);
});
Deno.test("snapshot qualification sidecar must retain its exact bytes", async () => {
  const f = await fixture({ qualification: true });
  f.objects.set(PREFIX + "qualification.json", new TextEncoder().encode("{}"));
  await denied(() => f.source.current());
});
Deno.test("snapshot compressed public body preserves original LF in human text and rejects other controls", async () => {
  const f = await fixture({
      body: (b) => {
        const r = (b.rows as NativeObject[])[0];
        r.department = "SYNTHETIC 모집\n단위";
        r.admission_track = "SYNTHETIC\n전형";
        (r.competition_ratio as NativeObject).statistic_label = "SYNTHETIC\n원문";
      },
    }),
    p = await f.source.current(),
    body = await f.source.read(p, p.full!),
    wire = await f.source.representation(body);
  equal((body.rows as NativeObject[])[0].department, "SYNTHETIC 모집\n단위");
  assert(wire.bytes.length === p.full!.gzipBytes);
  for (const forbidden of ["\r", "\u0000"]) {
    const bad = await fixture({
        body: (b) => {
          (b.rows as NativeObject[])[0].department = "SYNTHETIC" + forbidden +
            "이름";
        },
      }),
      publication = await bad.source.current();
    await denied(
      () => bad.source.read(publication, publication.full!),
      "snapshot_invalid",
    );
  }
});
async function denied(
  work: () => unknown | Promise<unknown>,
  code = "snapshot_unavailable",
  http = 503,
) {
  let error: unknown;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal(error.code, code);
  equal(error.http, http);
}
async function fixture(
  options: {
    head?: (v: NativeObject) => void;
    manifest?: (v: NativeObject) => void;
    review?: (v: NativeObject) => void;
    body?: (v: NativeObject) => void;
    parts?: boolean;
    binding?: (v: SnapshotTrustBinding) => SnapshotTrustBinding;
    qualification?: boolean;
    qualificationReceipt?: (v: NativeObject) => void;
    qualificationDescriptor?: (v: NativeObject) => void;
    runtimeMilliseconds?: number;
  } = {},
) {
  const objects = new Map<string, Uint8Array>();
  const requests: string[] = [];
  let headCalls = 0;
  let currentClock = NOW;
  let headHook: () => Promise<void> = () => Promise.resolve();
  let fetchOverride: typeof fetch | undefined;
  const payload = options.qualification
    ? syntheticQualifiableBody(options.parts ? "SYNTHETIC-part" : null)
    : syntheticSnapshotBody(false, options.parts ? "SYNTHETIC-part" : null);
  const qualification = options.qualification
    ? await syntheticQualificationArtifacts(
      payload,
      PREFIX + "qualification.json",
      options.qualificationReceipt,
    )
    : undefined;
  if (qualification) {
    ((payload.rows as NativeObject[])[0]
      .final_additional_admission_rank as NativeObject)
      .service_qualification = qualification.q;
    options.qualificationDescriptor?.(qualification.descriptor);
    objects.set(PREFIX + "qualification.json", qualification.bytes);
  }
  options.body?.(payload);
  const decoded = encode(payload),
    gzip = new Uint8Array(
      await new Response(
        new Blob([decoded]).stream().pipeThrough(new CompressionStream("gzip")),
      )
        .arrayBuffer(),
    );
  objects.set(PREFIX + "body.json.gz", gzip);
  const part: NativeObject = {
    part_id: options.parts ? "SYNTHETIC-part" : null,
    payload_id: "SYNTHETIC-payload",
    object_key: PREFIX + "body.json.gz",
    gzip_bytes: gzip.length,
    gzip_sha256: await snapshotBytesSha256(gzip),
    decoded_bytes: decoded.length,
    decoded_sha256: await snapshotBytesSha256(decoded),
    rows: 1,
    mapped_rows: 1,
    mapping_pending_rows: 0,
  };
  const manifest: NativeObject = {
    format: "jungsi.history-snapshot-manifest/v1",
    status: "approved",
    snapshot_id: "SYNTHETIC-edition",
    source_head_sha256: "b".repeat(64),
    scope_sha256: "a".repeat(64),
    generated_at: "2026-10-15T00:00:00Z",
    source_as_of: "2026-10-14T00:00:00Z",
    schema_version: "jungsi.history-snapshot/v1",
    normalization_rules_version: "SYNTHETIC-normalization-v1",
    normalization_rules_sha256: "c".repeat(64),
    selection_rules_version: "SYNTHETIC-selection-v1",
    selection_rules_sha256: "d".repeat(64),
    counts: {
      rows: 1,
      mapped_rows: 1,
      mapping_pending_rows: 0,
      observations: 1,
      schools: 1,
    },
    full: options.parts ? null : part,
    parts: options.parts ? [part] : [],
  };
  options.manifest?.(manifest);
  const manifestBytes = encode(manifest);
  objects.set(PREFIX + "manifest.json", manifestBytes);
  const manifestHash = await snapshotBytesSha256(manifestBytes);
  const review: NativeObject = {
    format: "jungsi.history-snapshot-independent-review/v1",
    status: "approved",
    lineage: "SYNTHETIC-lineage",
    manifest_sha256: manifestHash,
    source_head_sha256: "b".repeat(64),
    scope_sha256: "a".repeat(64),
    normalization_rules_sha256: "c".repeat(64),
    selection_rules_sha256: "d".repeat(64),
    publisher_ref: "SYNTHETIC-owner",
    reviewer_ref: "SYNTHETIC-reviewer",
    ...(qualification ? { field_qualification: qualification.descriptor } : {}),
  };
  options.review?.(review);
  const reviewBytes = encode(review);
  objects.set(PREFIX + "review.json", reviewBytes);
  const head: NativeObject = {
    format: "jungsi.history-snapshot-publication-head/v1",
    status: "approved",
    purpose: "p1-public-history",
    lineage: "SYNTHETIC-lineage",
    sequence: 1,
    previous_head_sha256: "0".repeat(64),
    source_head_sha256: "b".repeat(64),
    scope_sha256: "a".repeat(64),
    normalization_rules_version: "SYNTHETIC-normalization-v1",
    normalization_rules_sha256: "c".repeat(64),
    selection_rules_version: "SYNTHETIC-selection-v1",
    selection_rules_sha256: "d".repeat(64),
    publisher_ref: "SYNTHETIC-owner",
    reviewer_ref: "SYNTHETIC-reviewer",
    manifest: {
      object_key: PREFIX + "manifest.json",
      bytes: manifestBytes.length,
      sha256: manifestHash,
    },
    review_receipt: {
      object_key: PREFIX + "review.json",
      bytes: reviewBytes.length,
      sha256: await snapshotBytesSha256(reviewBytes),
    },
    expires_at: "2026-10-15T00:01:00Z",
  };
  options.head?.(head);
  let row: SnapshotHeadRow = {
    releaseVersion: "SYNTHETIC-lineage:00000000000000000001",
    contentSha256: await nativeJsonSha256(head),
    reviewStatus: "approved",
    metadataText: nativeJsonText(head),
  };
  const binding: SnapshotTrustBinding = {
    artifactKind: "SYNTHETIC-p1-head",
    lineage: "SYNTHETIC-lineage",
    minimumSequence: 1n,
    scopeSha256: "a".repeat(64),
    normalizationRulesVersion: "SYNTHETIC-normalization-v1",
    normalizationRulesSha256: "c".repeat(64),
    selectionRulesVersion: "SYNTHETIC-selection-v1",
    selectionRulesSha256: "d".repeat(64),
    publisherReferences: ["SYNTHETIC-owner"],
    reviewerReferences: ["SYNTHETIC-reviewer"],
    objectPrefix: PREFIX,
    maxMetadataBytes: 8192,
    maxGzipBytes: 8192,
    maxDecodedBytes: 32768,
    maxRows: 8,
    maxParts: 4,
    maxDepth: 32,
    maxInMemoryBytes: 600000,
    expiresAtUtc: NOW + 60000000n,
  };
  const source = new HistorySnapshotSource(
    {
      latest: (kind, lineage) => {
        equal(kind, binding.artifactKind);
        equal(lineage, binding.lineage);
        headCalls++;
        return Promise.resolve().then(() => headHook()).then(() => row);
      },
    },
    options.binding?.(binding) ?? binding,
    {
      projectUrl: URL_BASE,
      secretKey: "sb_secret_SYNTHETIC_key",
      bucket: "synthetic-private",
      objectPrefix: "SYNTHETIC/",
      limits: {
        maxArtifactBytes: 8192,
        maxBucketBytes: 1048576,
        maxMetadataBytes: 8192,
        requestTimeoutMs: 5000,
      },
    },
    { nowUtc: () => currentClock },
    {
      maxReadBytes: 1048576,
      maxResultBytes: 8192n,
      runtimeMilliseconds: options.runtimeMilliseconds ?? 5000,
    },
    ((url, init) => {
      if (fetchOverride) return fetchOverride(url, init);
      assert(
        init?.method === "GET" && init.redirect === "error" &&
          init.cache === "no-store",
      );
      equal(new Headers(init.headers).get("apikey"), "sb_secret_SYNTHETIC_key");
      const u = String(url);
      requests.push(u);
      const bytes = u.endsWith("/bucket/synthetic-private")
        ? encode({
          id: "synthetic-private",
          public: false,
          file_size_limit: 1048576,
        })
        : objects.get(
          decodeURIComponent(
            u.split("/object/authenticated/synthetic-private/")[1] ?? "",
          ),
        );
      const response = new Response(bytes ? Uint8Array.from(bytes) : null, {
        status: bytes ? 200 : 404,
      });
      Object.defineProperty(response, "url", { value: u });
      return Promise.resolve(response);
    }) as typeof fetch,
  );
  return {
    source,
    objects,
    head,
    manifest,
    part,
    requests,
    headCalls: () => headCalls,
    setHeadHook: (hook: () => Promise<void>) => headHook = hook,
    setClock: (now: bigint) => currentClock = now,
    setFetch: (fetcher: typeof fetch) => fetchOverride = fetcher,
    setRow: (change: (r: SnapshotHeadRow) => SnapshotHeadRow) => row = change(row),
    binding,
  };
}
Deno.test("snapshot source verifies scoped head receipt immutable bytes and projected gzip semantics", async () => {
  const f = await fixture(), p = await f.source.current();
  assert(p.full);
  const body = await f.source.read(p, p.full),
    wire = await f.source.representation(body);
  equal(wire.snapshotId, p.snapshotId);
  equal(wire.bytes.length, p.full.gzipBytes);
  equal(await snapshotBytesSha256(wire.bytes), p.full.gzipSha256);
  assert(f.requests.every((u) => u.startsWith(URL_BASE + "/storage/v1/")));
  assert(f.headCalls() >= 3);
});
Deno.test("snapshot source rejects other lineage draft expired rewind purpose and scope", async () => {
  for (
    const change of [(h: NativeObject) => {
      h.lineage = "SYNTHETIC-other";
    }, (h: NativeObject) => {
      h.status = "draft";
    }, (h: NativeObject) => {
      h.expires_at = "2026-10-15T00:00:00Z";
    }, (h: NativeObject) => {
      h.sequence = 0;
    }, (h: NativeObject) => {
      h.purpose = "engine";
    }, (h: NativeObject) => {
      h.scope_sha256 = "b".repeat(64);
    }]
  ) {
    const f = await fixture({ head: change });
    await denied(() => f.source.current());
    equal(f.requests.length, 0);
  }
});
Deno.test("snapshot source rejects modified source and rule hashes even with a repinned head", async () => {
  for (
    const field of [
      "source_head_sha256",
      "normalization_rules_sha256",
      "selection_rules_sha256",
    ]
  ) {
    const f = await fixture({
      head: (h) => {
        h[field] = "f".repeat(64);
      },
    });
    await denied(() => f.source.current());
  }
});
Deno.test("snapshot source requires independently approved reviewer receipt with exact manifest SHA", async () => {
  for (
    const change of [(r: NativeObject) => {
      r.reviewer_ref = "SYNTHETIC-owner";
    }, (r: NativeObject) => {
      r.status = "verified";
    }, (r: NativeObject) => {
      r.manifest_sha256 = "f".repeat(64);
    }, (r: NativeObject) => {
      r.scope_sha256 = "f".repeat(64);
    }]
  ) {
    const f = await fixture({ review: change });
    await denied(() => f.source.current());
  }
});
Deno.test("snapshot source final current binds release version status and metadata hash", async () => {
  for (
    const change of [
      (r: SnapshotHeadRow) => ({
        ...r,
        releaseVersion: "SYNTHETIC-lineage:00000000000000000002",
      }),
      (r: SnapshotHeadRow) => ({ ...r, reviewStatus: "draft" }),
      (r: SnapshotHeadRow) => ({
        ...r,
        metadataText: r.metadataText.replace(
          "p1-public-history",
          "p1-private-history",
        ),
      }),
    ]
  ) {
    const f = await fixture(), p = await f.source.current();
    f.setRow(change);
    await denied(() => f.source.assertCurrent(p), "publication_changed", 409);
  }
});
Deno.test("snapshot source rejects corrupt gzip and decompressed byte pins", async () => {
  const f = await fixture(), p = await f.source.current();
  assert(p.full);
  const bytes = f.objects.get(PREFIX + "body.json.gz")!;
  f.objects.set(PREFIX + "body.json.gz", new Uint8Array(bytes.length));
  await denied(() => f.source.read(p, p.full!));
  const second = await fixture({
      manifest: (m) => {
        (m.full as NativeObject).decoded_sha256 = "0".repeat(64);
      },
    }),
    p2 = await second.source.current();
  await denied(() => second.source.read(p2, p2.full!));
});
Deno.test("snapshot source rejects raw byte row count and private field violations", async () => {
  for (
    const bodyChange of [(b: NativeObject) => {
      b.private_model = {};
    }, (b: NativeObject) => {
      (b.rows as NativeObject[])[0].owner_id = "SYNTHETIC-private";
    }, (b: NativeObject) => {
      b.rows = [];
    }]
  ) {
    const f = await fixture({ body: bodyChange }), p = await f.source.current();
    await denied(() => f.source.read(p, p.full!), "snapshot_invalid");
  }
});
Deno.test("snapshot source rejects duplicate parts and mismatched mapped and pending totals", async () => {
  for (
    const change of [(m: NativeObject) => {
      (m.parts as NativeObject[]).push((m.parts as NativeObject[])[0]);
    }, (m: NativeObject) => {
      (m.counts as NativeObject).mapping_pending_rows = 1;
    }, (m: NativeObject) => {
      (m.parts as NativeObject[])[0].mapping_pending_rows = 1;
    }]
  ) {
    const f = await fixture({ parts: true, manifest: change });
    await denied(() => f.source.current());
  }
});
Deno.test("snapshot source reuses no body until strict public projection matches the validated source", async () => {
  const f = await fixture(),
    p = await f.source.current(),
    body = await f.source.read(p, p.full!);
  await denied(() => f.source.representation({ ...body, private_model: {} }));
  await denied(() => f.source.representation({ ...body, rows: [] }));
});
Deno.test("snapshot depth scanner ignores braces in strings and rejects deep duplicate key JSON", async () => {
  equal(
    parseBoundedSnapshotJson(new TextEncoder().encode('{"x":"{[\\""}'), 100, 1)
      .x,
    '{["',
  );
  for (const s of ['{"x":[[[0]]]}', '{"x":1,"x":2}', '{"x":']) {
    await denied(() => parseBoundedSnapshotJson(new TextEncoder().encode(s), 100, 2));
  }
});
Deno.test("snapshot bounded stream cancels overflow and aborted pending reads", async () => {
  let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(new Uint8Array(11)),
    cancel: () => {
      canceled++;
    },
  });
  await denied(() => readBoundedSnapshotStream(stream, 10));
  equal(canceled, 1);
  const controller = new AbortController(),
    pending = new ReadableStream<Uint8Array>({
      cancel: () => {
        canceled++;
      },
    }),
    read = readBoundedSnapshotStream(pending, 10, controller.signal);
  controller.abort();
  await denied(() => read);
  equal(canceled, 2);
});
Deno.test("snapshot configured limits must fit prior read result and whole memory envelopes", async () => {
  for (
    const binding of [
      (b: SnapshotTrustBinding) => ({ ...b, maxGzipBytes: 8193 }),
      (b: SnapshotTrustBinding) => ({ ...b, maxDecodedBytes: 1048576 }),
      (b: SnapshotTrustBinding) => ({ ...b, maxRows: 100000 }),
      (b: SnapshotTrustBinding) => ({ ...b, maxParts: 100000 }),
      (b: SnapshotTrustBinding) => ({ ...b, maxInMemoryBytes: 1048577 }),
    ]
  ) await denied(() => fixture({ binding }));
});
Deno.test("snapshot metadata SQL is one kind and C ordered lineage range under existing readonly role", async () => {
  const calls: { s: string; p: readonly unknown[] }[] = [];
  const pool: NativeSqlPool = {
    transaction: async (ro, work) => {
      assert(ro);
      return await work({
        query: (s, p = []) => {
          calls.push({ s, p });
          if (s === RUNTIME_ROLE_SQL) {
            return Promise.resolve([[
              "jungsi_backend_app",
              false,
              false,
              "on",
              "on",
              false,
              false,
              false,
              "UTC",
            ]]);
          }
          if (s === SNAPSHOT_HEAD_SQL) {
            return Promise.resolve([[
              "SYNTHETIC-lineage:00000000000000000001",
              "a".repeat(64),
              "approved",
              "{}",
            ]]);
          }
          return Promise.resolve([]);
        },
      });
    },
    close: () => Promise.resolve(),
  };
  const port = new SupabaseSnapshotHead(
    new SupabaseSqlTransport(pool),
    "00000000-0000-0000-0000-000000000001",
  );
  await port.latest("SYNTHETIC-p1-head", "SYNTHETIC-lineage");
  const selected = calls.filter((c) => c.s === SNAPSHOT_HEAD_SQL);
  equal(selected.length, 1);
  equal(selected[0].p, [
    "SYNTHETIC-p1-head",
    "SYNTHETIC-lineage:",
    "SYNTHETIC-lineage;",
  ]);
  assert(
    SNAPSHOT_HEAD_SQL.includes('COLLATE "C"') &&
      SNAPSHOT_HEAD_SQL.includes("LIMIT 1"),
  );
  assert(!/\b(INSERT|UPDATE|DELETE)\b/.test(SNAPSHOT_HEAD_SQL));
});

Deno.test("snapshot source returns pinned gzip after calculation context survives public projection", async () => {
  const f = await fixture({
    body: (body) => {
      Object.assign(body, syntheticSnapshotStatisticsBody());
      const row = (body.rows as NativeObject[])[0];
      row.academic_year = 2025;
      row.offering_id = "2025:" + row.original_pk;
      const alt = row.alternate_cut as NativeObject;
      const entries = alt.entries as NativeObject[];
      alt.entries = [
        {
          ...entries[3],
          value: new JsonFloat("0.000000123400"),
          score_calculation_context: {
            source_result_year: 2025,
            score_calculation_year: 2025,
            observation_role: "actual_result",
          },
          publication_context: {
            publication_role: "actual_result",
            simulation_target_academic_year: null,
          },
        },
        {
          ...entries[4],
          value: new JsonFloat("0.000000567800"),
          score_calculation_context: {
            source_result_year: 2025,
            score_calculation_year: 2026,
            observation_role: "prior_year_recalculated_reference",
          },
          publication_context: {
            publication_role: "simulation_reference",
            simulation_target_academic_year: 2027,
          },
        },
      ];
    },
  });
  const p = await f.source.current(), body = await f.source.read(p, p.full!);
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.snapshot.read", tier, body);
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
    const wire = await f.source.representation(projected);
    equal(await snapshotBytesSha256(wire.bytes), p.full!.gzipSha256);
    const decoded = await new Response(
      new Blob([wire.bytes]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      ),
    ).text();
    equal(
      await snapshotBytesSha256(new TextEncoder().encode(decoded)),
      p.full!.decodedSha256,
    );
    assert(decoded.includes('"observation_role":"actual_result"'));
    assert(
      decoded.includes(
        '"observation_role":"prior_year_recalculated_reference"',
      ),
    );
    assert(decoded.includes('"score_calculation_year":2026'));
    assert(decoded.includes('"publication_role":"actual_result"'));
    assert(decoded.includes('"publication_role":"simulation_reference"'));
    assert(decoded.includes('"simulation_target_academic_year":2027'));
    assert(decoded.includes('"value":0.000000123400'));
    assert(decoded.includes('"value":0.000000567800'));
  }
});

Deno.test("snapshot source retains score components and pending identity variants in pinned gzip", async () => {
  const f = await fixture({
    body: (body) => {
      Object.assign(body, syntheticSnapshotStatisticsBody());
      const row = (body.rows as NativeObject[])[0];
      row.identity_review = {
        status: "review_pending",
        reason_code: "SYNTHETIC_IDENTITY_REVIEW_PENDING",
        variants: [
          {
            university_name: "SYNTHETIC 학교",
            department: "SYNTHETIC unit A",
            admission_track: "SYNTHETIC 전형",
            group: null,
          },
          {
            university_name: "SYNTHETIC 학교",
            department: "SYNTHETIC unit B",
            admission_track: "SYNTHETIC 전형",
            group: null,
          },
        ],
      };
      const alt = row.alternate_cut as NativeObject;
      const entries = (alt.entries as NativeObject[]).slice(3, 5);
      for (const [i, entry] of entries.entries()) {
        entry.value = new JsonFloat(
          i === 0 ? "0.000000013570" : "0.000000097530",
        );
        entry.statistic_label = "SYNTHETIC 평균";
        entry.basis_code = i === 0 ? "SYNTHETIC-component-a" : "SYNTHETIC-component-b";
        entry.basis_label = i === 0 ? "SYNTHETIC component A" : "SYNTHETIC component B";
        entry.status = "pending_metadata";
        entry.reason_code = "SYNTHETIC_IDENTITY_REVIEW_PENDING";
        entry.score_calculation_context = {
          source_result_year: 2026,
          score_calculation_year: null,
          observation_role: "unresolved",
        };
        entry.publication_context = {
          publication_role: "simulation_reference",
          simulation_target_academic_year: 2027,
        };
        (entry.source_context as NativeObject).identity_variant_index = i;
        (entry.source_context as NativeObject).scope_status = "review_pending";
      }
      alt.entries = entries;
    },
  });
  const p = await f.source.current(), body = await f.source.read(p, p.full!);
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.snapshot.read", tier, body);
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
    const wire = await f.source.representation(projected);
    equal(await snapshotBytesSha256(wire.bytes), p.full!.gzipSha256);
    const decoded = await new Response(
      new Blob([wire.bytes]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      ),
    ).text();
    equal(
      await snapshotBytesSha256(new TextEncoder().encode(decoded)),
      p.full!.decodedSha256,
    );
    assert(decoded.includes('"basis_code":"SYNTHETIC-component-a"'));
    assert(decoded.includes('"basis_code":"SYNTHETIC-component-b"'));
    assert(decoded.includes('"identity_variant_index":0'));
    assert(decoded.includes('"identity_variant_index":1'));
    assert(decoded.includes('"scope_status":"review_pending"'));
    assert(decoded.includes('"publication_role":"simulation_reference"'));
    assert(decoded.includes('"simulation_target_academic_year":2027'));
    assert(decoded.includes('"score_calculation_year":null'));
    assert(decoded.includes('"value":0.000000013570'));
    assert(decoded.includes('"value":0.000000097530'));
  }
});

Deno.test("snapshot source gzip preserves synthetic conflict holds and missing 50", async () => {
  const f = await fixture({
    body: (body) => {
      Object.assign(body, syntheticSnapshotStatisticsBody());
      const row = (body.rows as NativeObject[])[0];
      const alt = row.alternate_cut as NativeObject;
      const originals = alt.entries as NativeObject[];
      row.final_70_percent_cut = {
        ...originals[0],
        value: new JsonFloat("0.000000010020"),
        statistic_percent: 70,
        statistic_label: "SYNTHETIC original 70 label",
      };
      alt.entries = [originals[3], originals[4]].map((entry, i) => ({
        ...entry,
        value: new JsonFloat(i === 0 ? "0.000000030040" : "0.000000050060"),
        statistic_percent: null,
        statistic_label: "SYNTHETIC original mean label",
        cohort: "SYNTHETIC original cohort",
        cohort_label: "SYNTHETIC original cohort label",
        basis_code: i === 0 ? "SYNTHETIC-score-component-a" : "SYNTHETIC-score-component-b",
        basis_label: i === 0 ? "SYNTHETIC original component A" : "SYNTHETIC original component B",
        selection_rule_ref: "SYNTHETIC-common-rule",
        status: "pending_metadata",
        reason_code: "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
        source_context: {
          ...(entry.source_context as NativeObject),
          scope_status: "review_pending",
        },
        score_calculation_context: {
          source_result_year: 2026,
          score_calculation_year: null,
          observation_role: "unresolved",
        },
        publication_context: i === 0
          ? { publication_role: "unresolved", simulation_target_academic_year: null }
          : { publication_role: "simulation_reference", simulation_target_academic_year: null },
      }));
      alt.reason_code = "SYNTHETIC_PRIORITY_CONFLICT_PENDING";
    },
  });
  const p = await f.source.current(), body = await f.source.read(p, p.full!);
  const schemas = JSON.parse(SYNTHETIC_QUALIFICATION_SCHEMA_JSON);
  const projection = new PublicResponseProjection(
    schemas,
    schemas.operations.map((o: { id: string; contract_ref: string }) => ({
      id: o.id,
      contract_ref: o.contract_ref,
    })),
  );
  for (const tier of ["standard", "paid"] as const) {
    const projected = projection.project("history.snapshot.read", tier, body);
    equal(await nativeJsonSha256(projected), await nativeJsonSha256(body));
    const wire = await f.source.representation(projected);
    equal(await snapshotBytesSha256(wire.bytes), p.full!.gzipSha256);
    const decoded = await new Response(
      new Blob([wire.bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    equal(await snapshotBytesSha256(new TextEncoder().encode(decoded)), p.full!.decodedSha256);
    assert(decoded.includes('"value":0.000000010020'));
    assert(decoded.includes('"value":0.000000030040'));
    assert(decoded.includes('"value":0.000000050060'));
    const result = JSON.parse(decoded);
    const row = result.rows[0];
    const entries = row.alternate_cut.entries;
    equal(row.final_50_percent_cut.value, null);
    equal(row.final_50_percent_cut.status, "not_published");
    equal(row.final_70_percent_cut.statistic_label, "SYNTHETIC original 70 label");
    equal(entries.map((e: NativeObject) => e.statistic_label), [
      "SYNTHETIC original mean label",
      "SYNTHETIC original mean label",
    ]);
    equal(entries.map((e: NativeObject) => e.source_url), [
      "https://synthetic.invalid/official-statistics",
      "https://synthetic.invalid/official-statistics",
    ]);
    equal(entries.map((e: NativeObject) => e.source_as_of), ["2026-10-14", "2026-10-14"]);
    equal(entries.map((e: NativeObject) => (e.source_context as NativeObject).scope_status), [
      "review_pending",
      "review_pending",
    ]);
    equal(entries.map((e: NativeObject) => e.selection_rule_ref), [
      "SYNTHETIC-common-rule",
      "SYNTHETIC-common-rule",
    ]);
    equal(entries.map((e: NativeObject) => e.cohort), [
      "SYNTHETIC original cohort",
      "SYNTHETIC original cohort",
    ]);
    equal(entries.map((e: NativeObject) => e.cohort_label), [
      "SYNTHETIC original cohort label",
      "SYNTHETIC original cohort label",
    ]);
    equal(entries.map((e: NativeObject) => e.basis_code), [
      "SYNTHETIC-score-component-a",
      "SYNTHETIC-score-component-b",
    ]);
    equal(entries.map((e: NativeObject) => e.basis_label), [
      "SYNTHETIC original component A",
      "SYNTHETIC original component B",
    ]);
    equal(entries.map((e: NativeObject) => e.status), ["pending_metadata", "pending_metadata"]);
    equal(entries.map((e: NativeObject) => e.reason_code), [
      "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
      "SYNTHETIC_PRIORITY_CONFLICT_PENDING",
    ]);
    equal(
      entries.map((e: NativeObject) =>
        (e.score_calculation_context as NativeObject).score_calculation_year
      ),
      [null, null],
    );
    equal(
      entries.map((e: NativeObject) => (e.publication_context as NativeObject).publication_role),
      ["unresolved", "simulation_reference"],
    );
    equal(
      entries.map((e: NativeObject) =>
        (e.publication_context as NativeObject).simulation_target_academic_year
      ),
      [null, null],
    );
  }
});

function concurrencyGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => release = resolve);
  return { promise, release: () => release() };
}

Deno.test("v1 concurrent current shares one authenticated load and budget", async () => {
  const f = await fixture(), gate = concurrencyGate();
  f.setHeadHook(() => gate.promise);
  const one = f.source.current(), two = f.source.current();
  await Promise.resolve();
  equal(f.headCalls(), 1);
  gate.release();
  const [a, b] = await Promise.all([one, two]);
  assert(a === b);
  equal(f.headCalls(), 1);
  equal(f.requests.length, 3);
  assert(await f.source.current() === a);
  equal(f.headCalls(), 1);
});

Deno.test("v1 failed concurrent load remains fail closed", async () => {
  const f = await fixture();
  f.setHeadHook(() => Promise.reject(new Error("SYNTHETIC_HEAD_FAILURE")));
  const outcomes = await Promise.allSettled([f.source.current(), f.source.current()]);
  equal(outcomes.map((v) => v.status), ["rejected", "rejected"]);
  equal(f.headCalls(), 1);
  const retry = await Promise.allSettled([f.source.current()]);
  equal(retry[0].status, "rejected");
  equal(f.headCalls(), 1);
});

Deno.test("v1 read reserves once and has no partial representation", async () => {
  const f = await fixture(), p = await f.source.current();
  const first = f.source.read(p, p.full!);
  const concurrent = f.source.read(p, p.full!);
  await denied(() => concurrent);
  await denied(() => f.source.representation({}));
  const body = await first;
  const wire = await f.source.representation(body);
  equal(await snapshotBytesSha256(wire.bytes), p.full!.gzipSha256);
  equal(f.requests.filter((v) => v.includes("body.json.gz")).length, 1);
  await denied(() => f.source.read(p, p.full!));
});

Deno.test("v1 stale head read failure never exposes partial bytes or retries", async () => {
  const f = await fixture(), p = await f.source.current();
  f.setRow((row) => ({ ...row, contentSha256: "0".repeat(64) }));
  await denied(() => f.source.read(p, p.full!), "publication_changed", 409);
  await denied(() => f.source.representation({}));
  await denied(() => f.source.read(p, p.full!));
  await denied(() => f.source.current());
  equal(f.requests.filter((v) => v.includes("body.json.gz")).length, 1);
});

Deno.test("v1 head expiry is checked after awaited head read", async () => {
  const f = await fixture({
    binding: (b) => ({ ...b, expiresAtUtc: NOW + 120000000n }),
  });
  const p = await f.source.current();
  f.setHeadHook(() => {
    f.setClock(p.expiresAtUtc);
    return Promise.resolve();
  });
  await denied(() => f.source.assertCurrent(p));
});

Deno.test("v1 late head rejects at deadline without claiming port cancellation", async () => {
  const f = await fixture({ runtimeMilliseconds: 600 }), p = await f.source.current();
  const gate = concurrencyGate();
  let portCompleted = false;
  f.setHeadHook(() =>
    gate.promise.then(() => {
      portCompleted = true;
    })
  );
  await denied(() => f.source.assertCurrent(p));
  equal(portCompleted, false);
  gate.release();
  await Promise.resolve();
  await Promise.resolve();
  equal(portCompleted, true);
});

Deno.test("v1 initial head timeout discards a late result and does not retry", async () => {
  const f = await fixture({ runtimeMilliseconds: 600 }), gate = concurrencyGate();
  f.setHeadHook(() => gate.promise);
  await denied(() => f.source.current());
  equal(f.headCalls(), 1);
  equal(f.requests.length, 0);
  await denied(() => f.source.current());
  equal(f.headCalls(), 1);
  gate.release();
  await Promise.resolve();
  await Promise.resolve();
  equal(f.requests.length, 0);
});

Deno.test("v1 ignored fetch signal times out and late body is discarded", async () => {
  const f = await fixture({ runtimeMilliseconds: 600 });
  let deliver!: (response: Response) => void, fetches = 0, cancels = 0;
  const response = new Promise<Response>((resolve) => deliver = resolve);
  f.setFetch(
    (() => {
      fetches++;
      return response;
    }) as typeof fetch,
  );
  await denied(() => f.source.current());
  equal(fetches, 1);
  await denied(() => f.source.current());
  equal(fetches, 1);
  deliver(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          cancels++;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  equal(cancels, 1);
});

async function deniedFast(work: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>((resolve) =>
    timer = setTimeout(() => resolve("timeout"), 300)
  );
  try {
    const result = await Promise.race([work().then(() => "accepted", (error) => error), deadline]);
    assert(result instanceof AccessError);
    equal(result.code, "snapshot_unavailable");
    equal(result.http, 503);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

Deno.test("already aborted signal releases reader despite never settling cancel", async () => {
  let calls = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      calls++;
      return new Promise<void>(() => {});
    },
  });
  const abort = new AbortController();
  abort.abort();
  await deniedFast(() => readBoundedSnapshotStream(stream, 4, abort.signal));
  equal(calls, 1);
  equal(stream.locked, false);
});

Deno.test("already aborted signal releases reader despite rejected cancel", async () => {
  let calls = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => {
      calls++;
      return Promise.reject(new Error("SYNTHETIC_CANCEL_FAILURE"));
    },
  });
  const abort = new AbortController();
  abort.abort();
  await deniedFast(() => readBoundedSnapshotStream(stream, 4, abort.signal));
  equal(calls, 1);
  equal(stream.locked, false);
});

Deno.test("oversized chunk fails despite never settling cancel", async () => {
  let calls = 0;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new Uint8Array(8)),
    cancel: () => {
      calls++;
      return new Promise<void>(() => {});
    },
  });
  await deniedFast(() => readBoundedSnapshotStream(stream, 4));
  equal(calls, 1);
  equal(stream.locked, false);
});

Deno.test("bad response status fails despite never settling body cancel", async () => {
  const f = await fixture();
  let calls = 0;
  f.setFetch(
    (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => {
              calls++;
              return new Promise<void>(() => {});
            },
          }),
          { status: 503 },
        ),
      )) as typeof fetch,
  );
  await deniedFast(() => f.source.current());
  equal(calls, 1);
});

Deno.test("oversized response length fails despite never settling body cancel", async () => {
  const f = await fixture();
  let calls = 0;
  f.setFetch(
    ((url) => {
      const r = new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => {
            calls++;
            return new Promise<void>(() => {});
          },
        }),
        { status: 200, headers: { "content-length": "999999" } },
      );
      Object.defineProperty(r, "url", { value: String(url) });
      return Promise.resolve(r);
    }) as typeof fetch,
  );
  await deniedFast(() => f.source.current());
  equal(calls, 1);
});

Deno.test("expired current remains failed if request clock is restored", async () => {
  const f = await fixture(), p = await f.source.current();
  f.setClock(f.binding.expiresAtUtc);
  await denied(() => f.source.current());
  f.setClock(NOW);
  await denied(() => f.source.current());
  await denied(() => f.source.read(p, p.full!));
});

Deno.test("changed head remains failed if same request later sees old head", async () => {
  const f = await fixture(), p = await f.source.current();
  let previous: SnapshotHeadRow | undefined;
  f.setRow((r) => {
    previous = r;
    return { ...r, contentSha256: "0".repeat(64) };
  });
  await denied(() => f.source.assertCurrent(p), "publication_changed", 409);
  f.setRow(() => previous!);
  await denied(() => f.source.current());
  await denied(() => f.source.read(p, p.full!));
});

Deno.test("read rejects failed interleaving after accepted final head", async () => {
  const f = await fixture(), p = await f.source.current();
  const original = f.source.assertCurrent.bind(f.source);
  let accepted = false, concurrentFailed = false;
  f.source.assertCurrent = async (publication) => {
    await original(publication);
    accepted = true;
    f.setRow((row) => ({ ...row, contentSha256: "0".repeat(64) }));
    await denied(() => original(publication), "publication_changed", 409);
    concurrentFailed = true;
  };
  await denied(() => f.source.read(p, p.full!));
  equal([accepted, concurrentFailed], [true, true]);
  await denied(() => f.source.representation({}));
});

Deno.test("representation rejects failed interleaving after accepted final head", async () => {
  const f = await fixture(), p = await f.source.current(), body = await f.source.read(p, p.full!);
  const original = f.source.assertCurrent.bind(f.source);
  let accepted = false, concurrentFailed = false;
  f.source.assertCurrent = async (publication) => {
    await original(publication);
    accepted = true;
    f.setRow((row) => ({ ...row, contentSha256: "0".repeat(64) }));
    await denied(() => original(publication), "publication_changed", 409);
    concurrentFailed = true;
  };
  await denied(() => f.source.representation(body));
  equal([accepted, concurrentFailed], [true, true]);
});

Deno.test("read rejects deadline interleaving after accepted final head", async () => {
  const f = await fixture(), p = await f.source.current();
  const original = f.source.assertCurrent.bind(f.source);
  f.source.assertCurrent = async (publication) => {
    await original(publication);
    f.setClock(f.binding.expiresAtUtc);
  };
  await denied(() => f.source.read(p, p.full!));
  await denied(() => f.source.representation({}));
});

Deno.test("representation rejects deadline interleaving after accepted final head", async () => {
  const f = await fixture(), p = await f.source.current(), body = await f.source.read(p, p.full!);
  const original = f.source.assertCurrent.bind(f.source);
  f.source.assertCurrent = async (publication) => {
    await original(publication);
    f.setClock(f.binding.expiresAtUtc);
  };
  await denied(() => f.source.representation(body));
});
