/** Synthetic metadata only; no IO permissions, private data or operating credentials. */
import { AccessError } from "./jungsi/application/access.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import {
  comparePublicCatalogKeys,
  parsePublicCatalogQuery,
  type PublicCatalogKey,
} from "./current_public_catalog.ts";
import {
  CurrentPublicMetadataKeyIndex,
  prepareCurrentPublicKeyIndex,
  prepareCurrentPublicKeyIndexV2,
  prepareCurrentPublicKeyIndexV3,
  type PublicKeyIndexBasis,
  type PublicKeyIndexEntry,
  type PublicKeyIndexPreparation,
  publicKeyRawHash,
} from "./current_public_key_index.ts";
function assert(v: unknown, message = "assertion_failed"): asserts v {
  if (!v) throw new Error(message);
}
function equal(a: unknown, b: unknown): void {
  assert(nativeJsonText(a, true) === nativeJsonText(b, true), "not_equal");
}
async function rejects(run: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (e) {
    error = e;
  }
  assert(error instanceof AccessError);
  equal([error.code, error.http], [
    "current_catalog_key_index_unapproved",
    503,
  ]);
}
function item(i: number): PublicKeyIndexEntry {
  const id = String(i).padStart(6, "0");
  return {
    key: [
      2024,
      "SYNTHETIC-SCHOOL",
      "SYNTHETIC-PK-" + id,
      "SYNTHETIC-METRIC",
      "SYNTHETIC-OBS-" + id,
    ],
    sourceKind: "admission",
    guide: null,
    nativeOfferingId: "SYNTHETIC-PK-" + id,
    expectedFingerprint: "f".repeat(64),
    search: {
      university: "synthetic university",
      department: "synthetic department",
      region: "synthetic region",
      group: "가",
    },
  };
}
function guideItem(i: number): PublicKeyIndexEntry {
  const row = item(i);
  return {
    ...row,
    key: [2027, row.key[1], row.key[2], "", `2027:${row.key[2]}`],
    sourceKind: "guide",
    nativeOfferingId: `2027:${row.key[2]}`,
    expectedFingerprint: null,
  };
}
async function setup(
  history: PublicKeyIndexEntry[],
  offerings: PublicKeyIndexEntry[] = [],
  lookups: PublicKeyIndexEntry[] = history,
  compact = false,
  packed = false,
) {
  const input: PublicKeyIndexPreparation = {
    history,
    offerings,
    lookups,
    metadataSha256: "a".repeat(64),
    guideCommandStateSha256: "b".repeat(64),
    admissionHead: {
      command_id: "SYNTHETIC-COMMAND",
      payload_sha256: "c".repeat(64),
    },
    coverage: {
      scope: "all_eligible_current_db_observations_at_head",
      review_receipt_sha256: "d".repeat(64),
      snapshot_sha256: await nativeJsonSha256({ history, offerings, lookups }),
      history_rows: history.length,
    },
    objectPrefix: "SYNTHETIC/keys/",
  };
  const prepared =
      await (packed
        ? prepareCurrentPublicKeyIndexV3(input)
        : compact
        ? prepareCurrentPublicKeyIndexV2(input)
        : prepareCurrentPublicKeyIndex(input)),
    basis: PublicKeyIndexBasis = {
      root: prepared.root,
      metadataSha256: input.metadataSha256,
      guideCommandStateSha256: input.guideCommandStateSha256,
      admissionHead: input.admissionHead,
      coverageReceiptSha256: input.coverage.review_receipt_sha256,
    };
  let reads = 0;
  const read = async (ref: { object_key: string }) => {
    await Promise.resolve(); // Simulate a partition fetch.
    reads++;
    const bytes = prepared.objects.get(ref.object_key);
    assert(bytes);
    return bytes;
  };
  return {
    prepared,
    input,
    basis,
    read,
    reader: new CurrentPublicMetadataKeyIndex(basis, read),
    reads: () => reads,
  };
}
async function changedCompactObject(
  f: Awaited<ReturnType<typeof setup>>,
  change: (raw: Record<string, unknown>) => void,
): Promise<CurrentPublicMetadataKeyIndex> {
  const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
  const encode = (raw: unknown) => new TextEncoder().encode(nativeJsonText(raw, true));
  const root = decode(f.prepared.objects.get(f.prepared.root.object_key)!);
  const objects = f.prepared.objects as Map<string, Uint8Array>;
  const prefix = Object.keys(root.lookups)[0], ref = root.lookups[prefix];
  const raw = decode(f.prepared.objects.get(ref.object_key)!);
  change(raw);
  const bytes = encode(raw);
  objects.set(ref.object_key, bytes);
  root.lookups[prefix] = { ...ref, bytes: bytes.length, sha256: await publicKeyRawHash(bytes) };
  const rootBytes = encode(root);
  objects.set(f.prepared.root.object_key, rootBytes);
  return new CurrentPublicMetadataKeyIndex({
    ...f.basis,
    root: { ...f.basis.root, bytes: rootBytes.length, sha256: await publicKeyRawHash(rootBytes) },
  }, f.read);
}
Deno.test("packed national lookup resolves 100 IDs with root and two byte-bounded objects", async () => {
  const rows = Array.from({ length: 24000 }, (_, i) => {
    const row = guideItem(i), pk = "S" + String(i).padStart(9, "0");
    return {
      ...row,
      key: [2027, row.key[1], pk, "", `2027:${pk}`] as PublicCatalogKey,
      nativeOfferingId: `2027:${pk}`,
    };
  });
  const f = await setup([], rows, rows, true, true),
    ids = rows.filter((_, i) => i % 239 === 0).slice(0, 100).map((e) => e.nativeOfferingId!);
  const result = await f.reader.resolve(ids, false);
  equal(result.keys.length, 100);
  assert(f.reads() <= 3);
  const root = JSON.parse(
    new TextDecoder().decode(f.prepared.objects.get(f.prepared.root.object_key)!),
  );
  equal(root.format, "jungsi.current-public-key-index/v3");
  assert(Object.keys(root.lookups).length <= 2);
  assert(Object.values(root.lookups).every((r) => (r as { bytes: number }).bytes <= 262144));
});
Deno.test("packed guide tuples preserve original PK lexemes and retain separate admission fallback", async () => {
  const guides = ["0000123", "SYNTHETIC-PK"].map((pk, i) => ({
    ...guideItem(i),
    key: [2027, "SYNTHETIC-SCHOOL", pk, "", `2027:${pk}`] as PublicCatalogKey,
    nativeOfferingId: `2027:${pk}`,
  }));
  const a = item(5);
  a.nativeOfferingId = `2024:${a.key[2]}`;
  const f = await setup([], guides, [...guides, a], true, true),
    result = await f.reader.resolve(
      [...guides.map((g) => g.nativeOfferingId), a.nativeOfferingId],
      false,
    );
  equal(
    result.keys.map((k) => k.nativeOfferingId).sort(),
    [a.nativeOfferingId, ...guides.map((g) => g.nativeOfferingId)].sort(),
  );
  assert(result.keys.some((k) => k.key[2] === "0000123"));
});
Deno.test("packed lookup rejects a signed invalid year-school code", async () => {
  const row = guideItem(1), f = await setup([], [row], [row], true, true);
  const reader = await changedCompactObject(f, (raw) => {
    (raw.guides as unknown[][])[0][0] = (raw.schools as unknown[]).length * 4;
  });
  await rejects(() => reader.resolve([row.nativeOfferingId!], false));
});
Deno.test("packed lookup retains a closed tuple shape and bounded total entry count", async () => {
  for (
    const change of [(raw: Record<string, unknown>) => {
      (raw.guides as unknown[][])[0].push("extra");
    }, (raw: Record<string, unknown>) => {
      raw.guides = Array.from({ length: 16385 }, () => [0, "x"]);
    }]
  ) {
    const row = guideItem(1), f = await setup([], [row], [row], true, true);
    const reader = await changedCompactObject(f, change);
    await rejects(() => reader.resolve([row.nativeOfferingId!], false));
  }
});
Deno.test("compact lookup resolves 100 native IDs from a national-sized metadata set within eight reads", async () => {
  const source = Array.from({ length: 24000 }, (_, i) => guideItem(i));
  const f = await setup([], [], source, true);
  const ids = source.slice(10000, 10100).map((row) => row.nativeOfferingId!);
  const page = await f.reader.resolve(ids, true);
  equal(page.keys.map((row) => row.nativeOfferingId), ids);
  assert(f.reads() <= 9); // One pinned root plus at most eight bounded lookup objects.
  assert([...f.prepared.objects.values()].every((bytes) => bytes.length <= 262144));
  equal(page.keys[0].expectedFingerprint, null);
});
Deno.test("compact lookup rejects a signed object containing an invalid dictionary reference", async () => {
  const row = guideItem(1), f = await setup([], [], [row], true);
  const changed = await changedCompactObject(f, (raw) => {
    (raw.entries as number[][])[0][6] = 999999;
  });
  await rejects(() => changed.resolve([row.nativeOfferingId!], false));
});
Deno.test("compact lookup rejects oversized signed tuples without widening its object budget", async () => {
  const row = guideItem(1), f = await setup([], [], [row], true);
  const changed = await changedCompactObject(f, (raw) => {
    raw.entries = Array.from({ length: 4097 }, () => (raw.entries as number[][])[0]);
  });
  await rejects(() => changed.resolve([row.nativeOfferingId!], false));
});
Deno.test("compact preparation retains duplicate-ID and exact-coverage guards", async () => {
  const row = guideItem(1), f = await setup([], [], [row], true);
  const duplicate = [row, row];
  const snapshot = await nativeJsonSha256({ history: [], offerings: [], lookups: duplicate });
  await rejects(() =>
    prepareCurrentPublicKeyIndexV2({
      ...f.input,
      lookups: duplicate,
      coverage: {
        ...f.input.coverage,
        snapshot_sha256: snapshot,
      },
    })
  );
  await rejects(() =>
    prepareCurrentPublicKeyIndexV2({
      ...f.input,
      coverage: { ...f.input.coverage, snapshot_sha256: "0".repeat(64) },
    })
  );
});
Deno.test("key index preparation is not DB-wide coverage or publication acceptance", async () => {
  const f = await setup([item(1)]);
  equal(f.prepared.status, "PREPARED_REQUIRES_EXTERNAL_COVERAGE_REVIEW");
  await rejects(async () =>
    await prepareCurrentPublicKeyIndex({
      ...f.input,
      coverage: { ...f.input.coverage, history_rows: 2 },
    })
  );
  await rejects(async () => await prepareCurrentPublicKeyIndex({ ...f.input, history: [item(2)] }));
});
Deno.test("key index paginates 700 observations without deduplicating same offering metric", async () => {
  const source = Array.from({ length: 700 }, (_, i) => ({
      ...item(i),
      key: [
        2024,
        "SYNTHETIC-SCHOOL",
        "SYNTHETIC-PK-SAME",
        "SYNTHETIC-METRIC",
        "SYNTHETIC-OBS-" + String(i).padStart(6, "0"),
      ] as PublicCatalogKey,
      nativeOfferingId: "SYNTHETIC-PK-SAME",
    })),
    f = await setup(source, [], []),
    all: PublicCatalogKey[] = [];
  let after: PublicCatalogKey | null = null;
  for (let i = 0; i < 7; i++) {
    const page = await f.reader.select(
      "history",
      parsePublicCatalogQuery({ limit: "100" }),
      after,
    );
    equal(page.keys.length, i === 6 ? 100 : 101);
    all.push(...page.keys.slice(0, 100).map((k) => k.key));
    after = page.keys.length > 100 ? page.keys[99].key : page.nextAfter;
  }
  equal(all, source.map((e) => e.key));
  equal(after, null);
  for (const bytes of f.prepared.objects.values()) {
    assert(!new TextDecoder().decode(bytes).includes("metric_value"));
  }
});
Deno.test("key index filters years unicode department region and group before returning keys", async () => {
  const a = item(1), b = item(2), c = item(3);
  a.search.department = "가상간호";
  b.search.department = "가상간호";
  b.search.region = "다른지역";
  c.key[0] = 2025;
  const f = await setup([a, b, c]);
  const page = await f.reader.select(
    "history",
    parsePublicCatalogQuery({
      academic_year: "2024",
      department_q: "간호",
      region: "SYNTHETIC REGION",
      group: "가",
    }),
    null,
  );
  equal(page.keys.map((k) => k.key), [a.key]);
});
Deno.test("key index sparse search exposes continuation at its physical read bound", async () => {
  const source = Array.from({ length: 3329 }, (_, i) => item(i));
  source.at(-1)!.search.department = "last department";
  const f = await setup(source, [], []),
    q = parsePublicCatalogQuery({
      department_q: "last department",
      limit: "100",
    }),
    first = await f.reader.select("history", q, null);
  equal(first.keys, []);
  assert(first.nextAfter !== null);
  equal(f.reads(), 13);
  const next = await f.reader.select("history", q, first.nextAfter);
  equal(next.keys.map((k) => k.key), [source.at(-1)!.key]);
  equal(next.nextAfter, null);
});
Deno.test("key index rejects changed bytes metadata source head and coverage reference", async () => {
  const f = await setup([item(1)]);
  for (
    const patch of [{ metadataSha256: "e".repeat(64) }, {
      admissionHead: {
        command_id: "SYNTHETIC-OTHER",
        payload_sha256: "c".repeat(64),
      },
    }, { coverageReceiptSha256: "e".repeat(64) }]
  ) {
    await rejects(() =>
      new CurrentPublicMetadataKeyIndex({ ...f.basis, ...patch }, f.read)
        .select("history", parsePublicCatalogQuery({}), null)
    );
  }
  await rejects(() =>
    new CurrentPublicMetadataKeyIndex(
      f.basis,
      () => Promise.resolve(new TextEncoder().encode("{}")),
    ).select("history", parsePublicCatalogQuery({}), null)
  );
});
Deno.test("key index retains exact native identifiers and rejects ambiguous lookup publication", async () => {
  const f = await setup([item(1), item(2)]),
    page = await f.reader.resolve(["SYNTHETIC-PK-000002"], false);
  equal(page.keys.map((k) => k.nativeOfferingId), ["SYNTHETIC-PK-000002"]);
  equal((await f.reader.resolve(["2024:SYNTHETIC-PK-000002"], false)).keys, []);
  const duplicate = {
    ...item(1),
    key: [2025, ...item(1).key.slice(1)] as PublicCatalogKey,
  };
  const lookups = [item(1), duplicate];
  await rejects(async () =>
    await prepareCurrentPublicKeyIndex({
      ...f.input,
      lookups,
      coverage: {
        ...f.input.coverage,
        snapshot_sha256: await nativeJsonSha256({
          history: f.input.history,
          offerings: f.input.offerings,
          lookups,
        }),
      },
    })
  );
});
Deno.test("key index rejects guide score bodies native-ID rewriting and duplicate canonical tuples", async () => {
  const f = await setup([item(1)]);
  for (
    const bad of [{ ...item(1), guide: { quota_value: 50 } }, {
      ...item(1),
      nativeOfferingId: "2024:SYNTHETIC-PK-000001",
    }, { ...item(1), metric_value: 50 }]
  ) {
    const history = [bad] as PublicKeyIndexEntry[];
    await rejects(async () =>
      prepareCurrentPublicKeyIndex({
        ...f.input,
        history,
        lookups: [],
        coverage: {
          ...f.input.coverage,
          snapshot_sha256: await nativeJsonSha256({
            history,
            offerings: [],
            lookups: [],
          }),
        },
      })
    );
  }
  const history = [item(1), item(1)];
  await rejects(async () =>
    await prepareCurrentPublicKeyIndex({
      ...f.input,
      history,
      lookups: [],
      coverage: {
        ...f.input.coverage,
        history_rows: 2,
        snapshot_sha256: await nativeJsonSha256({
          history,
          offerings: [],
          lookups: [],
        }),
      },
    })
  );
});
Deno.test("key index DB tuple comparator follows UTF8 C ordering for non-ASCII keys", () => {
  const keys: PublicCatalogKey[] = [
    [2024, "가", "", "", ""],
    [2024, "Z", "", "", ""],
    [2024, "é", "", "", ""],
    [2024, "a", "", "", ""],
  ];
  equal(keys.sort(comparePublicCatalogKeys).map((k) => k[1]), [
    "Z",
    "a",
    "é",
    "가",
  ]);
});
