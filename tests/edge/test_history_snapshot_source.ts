/** Credential and SQL strings are synthetic; network and database ports are explicit fakes. */
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
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
import {
  type NativeSqlPool,
  RUNTIME_ROLE_SQL,
  SupabaseSqlTransport,
} from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
import { syntheticSnapshotBody } from "./synthetic_history_snapshot.ts";
import {
  syntheticQualifiableBody,
  syntheticQualificationArtifacts,
} from "./synthetic_history_qualification.ts";
import { assert, equal } from "./fixture.ts";
const encode = (raw: unknown) => new TextEncoder().encode(nativeJsonText(raw));
const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co", PREFIX = "SYNTHETIC/snapshot/";
Deno.test("snapshot qualified review loads exact grants without adding manifest keys and reuses original gzip", async () => {
  const f = await fixture({ qualification: true }), p = await f.source.current();
  assert(p.fieldQualification !== undefined);
  assert(!Object.hasOwn(f.manifest, "field_qualification"));
  const body = await f.source.read(p, p.full!),
    row = (body.rows as NativeObject[])[0],
    rank = row.final_additional_admission_rank as NativeObject;
  equal([rank.value, rank.unit, rank.status, (row.identity_review as NativeObject).status], [
    "17",
    null,
    "pending_metadata",
    "review_pending",
  ]);
  equal(
    ((rank.service_qualification as NativeObject).normalized_service_fields as NativeObject).unit,
    "번",
  );
  const wire = await f.source.representation(body);
  const text = await new Response(
    new Blob([wire.bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
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
        (rank.source_context as NativeObject).observation_id = "observation:" + "c".repeat(64);
      },
    }),
    p = await f.source.current(),
    body = await f.source.read(p, p.full!);
  const rank = (body.rows as NativeObject[])[0].final_additional_admission_rank as NativeObject;
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
    "snapshot qualified source rejects independently pinned but inconsistent content " + mode,
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
              subject: { ...approvals[0].subject as NativeObject, offering_pk: "SYNTHETIC-extra" },
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
    "snapshot qualification retains closed metadata and existing bounds " + mode,
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
          if (mode === "receipt-overflow") (d.receipt as NativeObject).bytes = 24577;
        },
      });
      await denied(() => f.source.current());
    },
  );
}
Deno.test("snapshot qualification cannot bypass the current head revocation check", async () => {
  const f = await fixture({ qualification: true }), p = await f.source.current();
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
          (b.rows as NativeObject[])[0].department = "SYNTHETIC" + forbidden + "이름";
        },
      }),
      publication = await bad.source.current();
    await denied(() => bad.source.read(publication, publication.full!), "snapshot_invalid");
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
  } = {},
) {
  const objects = new Map<string, Uint8Array>();
  const requests: string[] = [];
  let headCalls = 0;
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
    ((payload.rows as NativeObject[])[0].final_additional_admission_rank as NativeObject)
      .service_qualification = qualification.q;
    options.qualificationDescriptor?.(qualification.descriptor);
    objects.set(PREFIX + "qualification.json", qualification.bytes);
  }
  options.body?.(payload);
  const decoded = encode(payload),
    gzip = new Uint8Array(
      await new Response(new Blob([decoded]).stream().pipeThrough(new CompressionStream("gzip")))
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
    counts: { rows: 1, mapped_rows: 1, mapping_pending_rows: 0, observations: 1, schools: 1 },
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
        return Promise.resolve(row);
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
    { nowUtc: () => NOW },
    { maxReadBytes: 1048576, maxResultBytes: 8192n, runtimeMilliseconds: 5000 },
    ((url, init) => {
      assert(init?.method === "GET" && init.redirect === "error" && init.cache === "no-store");
      equal(new Headers(init.headers).get("apikey"), "sb_secret_SYNTHETIC_key");
      const u = String(url);
      requests.push(u);
      const bytes = u.endsWith("/bucket/synthetic-private")
        ? encode({ id: "synthetic-private", public: false, file_size_limit: 1048576 })
        : objects.get(
          decodeURIComponent(u.split("/object/authenticated/synthetic-private/")[1] ?? ""),
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
    setRow: (change: (r: SnapshotHeadRow) => SnapshotHeadRow) => row = change(row),
    binding,
  };
}
Deno.test("snapshot source verifies scoped head receipt immutable bytes and projected gzip semantics", async () => {
  const f = await fixture(), p = await f.source.current();
  assert(p.full);
  const body = await f.source.read(p, p.full), wire = await f.source.representation(body);
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
    const field of ["source_head_sha256", "normalization_rules_sha256", "selection_rules_sha256"]
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
      (r: SnapshotHeadRow) => ({ ...r, releaseVersion: "SYNTHETIC-lineage:00000000000000000002" }),
      (r: SnapshotHeadRow) => ({ ...r, reviewStatus: "draft" }),
      (r: SnapshotHeadRow) => ({
        ...r,
        metadataText: r.metadataText.replace("p1-public-history", "p1-private-history"),
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
  const f = await fixture(), p = await f.source.current(), body = await f.source.read(p, p.full!);
  await denied(() => f.source.representation({ ...body, private_model: {} }));
  await denied(() => f.source.representation({ ...body, rows: [] }));
});
Deno.test("snapshot depth scanner ignores braces in strings and rejects deep duplicate key JSON", async () => {
  equal(parseBoundedSnapshotJson(new TextEncoder().encode('{"x":"{[\\""}'), 100, 1).x, '{["');
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
  equal(selected[0].p, ["SYNTHETIC-p1-head", "SYNTHETIC-lineage:", "SYNTHETIC-lineage;"]);
  assert(SNAPSHOT_HEAD_SQL.includes('COLLATE "C"') && SNAPSHOT_HEAD_SQL.includes("LIMIT 1"));
  assert(!/\b(INSERT|UPDATE|DELETE)\b/.test(SNAPSHOT_HEAD_SQL));
});
