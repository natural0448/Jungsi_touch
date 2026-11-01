/** Immutable metadata keys only. Original values are always reread from the current DB. */
import { AccessError } from "./jungsi/application/access.ts";
import { nativeJsonSha256, nativeJsonText } from "./jungsi/domain/json_value.ts";
import { JsonFloat, parseNativeJson } from "./jungsi/domain/native_json.ts";
import { hasAsciiControl, unicodeCasefold } from "./jungsi/domain/text.ts";
import {
  comparePublicCatalogKeys,
  type CurrentPublicKeySelectionPort,
  type PublicCatalogKey,
  publicCatalogKey,
  type PublicCatalogKind,
  type PublicCatalogQuery,
  type PublicPreparedKey,
  type PublicPreparedKeyPage,
} from "./current_public_catalog.ts";

export interface PublicKeyObjectReference {
  object_key: string;
  bytes: number;
  sha256: string;
}
export interface PublicKeyIndexEntry extends PublicPreparedKey {
  search: {
    university: string;
    department: string;
    region: string;
    group: string;
  };
}
interface KeyShard {
  reference: PublicKeyObjectReference;
  first: PublicCatalogKey;
  last: PublicCatalogKey;
  rows: number;
  universities: readonly string[] | null;
}
export interface PublicKeyIndexRoot {
  format:
    | "jungsi.current-public-key-index/v1"
    | "jungsi.current-public-key-index/v2"
    | "jungsi.current-public-key-index/v3";
  metadata_sha256: string;
  guide_command_state_sha256: string;
  admission_head: { command_id: string; payload_sha256: string };
  coverage: {
    scope: "all_eligible_current_db_observations_at_head";
    review_receipt_sha256: string;
    snapshot_sha256: string;
    history_rows: number;
  };
  history: readonly KeyShard[];
  offerings: readonly KeyShard[];
  lookups: Readonly<Record<string, PublicKeyObjectReference>>;
  limits: { max_shards_per_search: 12; max_shard_rows: 256 };
}
export interface PublicKeyIndexBasis {
  requiredFormat?: "jungsi.current-public-key-index/v2" | "jungsi.current-public-key-index/v3";
  root: PublicKeyObjectReference;
  metadataSha256: string;
  guideCommandStateSha256: string;
  admissionHead: { command_id: string; payload_sha256: string };
  coverageReceiptSha256: string;
}
export type PublicKeyObjectRead = (
  reference: PublicKeyObjectReference,
) => Promise<Uint8Array>;
const HASH = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail = (): never => {
  throw new AccessError("current_catalog_key_index_unapproved", 503);
};
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x) &&
  !(x instanceof JsonFloat);
function exact(x: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !record(x) || Object.keys(x).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(x, k))
  ) return fail();
  return x;
}
function text(x: unknown, max = 256): x is string {
  return typeof x === "string" && x.length <= max && !hasAsciiControl(x);
}
export async function publicKeyRawHash(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function reference(x: unknown, max = 524288): PublicKeyObjectReference {
  const r = exact(x, ["object_key", "bytes", "sha256"]);
  if (
    !text(r.object_key, 512) || !r.object_key || r.object_key.startsWith("/") ||
    r.object_key.split("/").some((p) =>
      !p || p === "." || p === ".." || !/^[-A-Za-z0-9_.]+$/.test(p)
    ) || !Number.isSafeInteger(r.bytes) || Number(r.bytes) < 1 ||
    Number(r.bytes) > max || !HASH.test(String(r.sha256))
  ) return fail();
  return r as unknown as PublicKeyObjectReference;
}
function head(x: unknown): PublicKeyIndexRoot["admission_head"] {
  const h = exact(x, ["command_id", "payload_sha256"]);
  if (!ID.test(String(h.command_id)) || !HASH.test(String(h.payload_sha256))) {
    return fail();
  }
  return h as unknown as PublicKeyIndexRoot["admission_head"];
}
function entry(x: unknown, qualified = false): PublicKeyIndexEntry {
  const e = exact(x, [
    "key",
    "sourceKind",
    "guide",
    "nativeOfferingId",
    "expectedFingerprint",
    "search",
  ]);
  const key = publicCatalogKey(e.key),
    s = exact(e.search, ["university", "department", "region", "group"]);
  // No guide/quota/score/source body may be smuggled into a key projection.
  if (
    !["admission", "guide"].includes(String(e.sourceKind)) ||
    e.guide !== null || !ID.test(String(e.nativeOfferingId)) ||
    key[2] && e.nativeOfferingId !== (qualified ? `${key[0]}:${key[2]}` : key[2]) ||
    e.sourceKind === "guide" && (!key[2] || key[3] !== "") ||
    qualified && e.sourceKind === "guide" && key[4] !== e.nativeOfferingId ||
    e.expectedFingerprint !== null &&
      !HASH.test(String(e.expectedFingerprint)) ||
    Object.values(s).some((v) => !text(v) || unicodeCasefold(v as string) !== v)
  ) return fail();
  return { ...e, key } as unknown as PublicKeyIndexEntry;
}
function shard(x: unknown): KeyShard {
  const s = exact(x, ["reference", "first", "last", "rows", "universities"]);
  reference(s.reference, 262144);
  const first = publicCatalogKey(s.first), last = publicCatalogKey(s.last);
  if (
    !Number.isSafeInteger(s.rows) || Number(s.rows) < 1 ||
    Number(s.rows) > 256 || comparePublicCatalogKeys(first, last) > 0 ||
    s.universities !== null &&
      (!Array.isArray(s.universities) || s.universities.length > 64 ||
        s.universities.some((v) => !text(v) || unicodeCasefold(v) !== v))
  ) return fail();
  return { ...s, first, last } as unknown as KeyShard;
}
const nativeTypedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
const nativeUint8Set = Uint8Array.prototype.set;

/** Snapshot a plain, approved reference before invoking an asynchronous port. */
function immutableReference(ref: PublicKeyObjectReference): PublicKeyObjectReference {
  try {
    const d = Object.getOwnPropertyDescriptors(ref);
    if (
      Object.keys(ref).length !== 3 ||
      !d.object_key || !("value" in d.object_key) ||
      !d.bytes || !("value" in d.bytes) ||
      !d.sha256 || !("value" in d.sha256)
    ) return fail();
    return Object.freeze(reference({
      object_key: d.object_key.value,
      bytes: d.bytes.value,
      sha256: d.sha256.value,
    }));
  } catch {
    return fail();
  }
}

/** Copy exactly the returned view into a private buffer before hashing or parsing. */
function immutableBytes(raw: unknown, expected: number): Uint8Array {
  try {
    if (
      !(raw instanceof Uint8Array) || !nativeTypedArrayByteLength ||
      nativeTypedArrayByteLength.call(raw) !== expected
    ) return fail();
    const bytes = new Uint8Array(new ArrayBuffer(expected));
    Reflect.apply(nativeUint8Set, bytes, [raw]);
    return bytes;
  } catch {
    return fail();
  }
}

async function checked(
  read: PublicKeyObjectRead,
  ref: PublicKeyObjectReference,
): Promise<unknown> {
  const pin = immutableReference(ref);
  const bytes = immutableBytes(await read(pin), pin.bytes);
  if (await publicKeyRawHash(bytes) !== pin.sha256) return fail();
  try {
    return parseNativeJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return fail();
  }
}
function matches(e: PublicKeyIndexEntry, q: PublicCatalogQuery): boolean {
  return (q.academic_year === null || e.key[0] === q.academic_year) &&
    e.search.university.includes(q.university_q) &&
    e.search.department.includes(q.department_q) &&
    (!q.region || e.search.region === q.region) &&
    (!q.group || e.search.group === q.group);
}
function bare(e: PublicKeyIndexEntry): PublicPreparedKey {
  return {
    key: [...e.key],
    sourceKind: e.sourceKind,
    guide: null,
    nativeOfferingId: e.nativeOfferingId,
    expectedFingerprint: e.expectedFingerprint,
  };
}

/** Compact lookup metadata only. Scores, quotas and source bodies remain outside this object. */
function compactLookup(prefix: string, entries: readonly PublicKeyIndexEntry[]): unknown {
  const strings: string[] = [], positions = new Map<string, number>();
  const intern = (value: string): number => {
    const old = positions.get(value);
    if (old !== undefined) return old;
    const index = strings.length;
    strings.push(value);
    positions.set(value, index);
    return index;
  };
  return {
    format: "jungsi.current-public-key-lookup/v2",
    prefix,
    strings,
    entries: entries.map((e) => [
      e.key[0],
      ...e.key.slice(1).map((x) => intern(String(x))),
      e.sourceKind === "admission" ? 0 : 1,
      intern(e.nativeOfferingId!),
      e.expectedFingerprint === null ? -1 : intern(e.expectedFingerprint),
    ]),
  };
}
function decodeCompactLookup(raw: Record<string, unknown>): PublicKeyIndexEntry[] {
  if (
    !Array.isArray(raw.strings) || raw.strings.length > 32768 ||
    raw.strings.some((x) => !text(x)) ||
    new Set(raw.strings).size !== raw.strings.length ||
    !Array.isArray(raw.entries) || raw.entries.length > 4096
  ) return fail();
  const strings = raw.strings as string[];
  const value = (index: unknown): string => {
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= strings.length) {
      return fail();
    }
    return strings[Number(index)];
  };
  return raw.entries.map((tuple) => {
    if (
      !Array.isArray(tuple) || tuple.length !== 8 ||
      !Number.isSafeInteger(tuple[0]) || ![0, 1].includes(tuple[5]) ||
      tuple[7] !== -1 && !Number.isSafeInteger(tuple[7])
    ) return fail();
    return entry({
      key: [tuple[0], ...tuple.slice(1, 5).map(value)],
      sourceKind: tuple[5] === 0 ? "admission" : "guide",
      guide: null,
      nativeOfferingId: value(tuple[6]),
      expectedFingerprint: tuple[7] === -1 ? null : value(tuple[7]),
      search: { university: "", department: "", region: "", group: "" },
    }, true);
  });
}
/** Year/school code plus the original PK string; derived addresses are never stored twice. */
function packedLookup(prefix: string, entries: readonly PublicKeyIndexEntry[]): unknown {
  const guides = entries.filter((e) => e.sourceKind === "guide" && e.expectedFingerprint === null);
  const schools = [...new Set(guides.map((e) => e.key[1]))].sort();
  const positions = new Map(schools.map((school, i) => [school, i]));
  const fallback = compactLookup(
    prefix,
    entries.filter((e) => e.sourceKind !== "guide" || e.expectedFingerprint !== null),
  ) as Record<string, unknown>;
  if ((fallback.entries as unknown[]).length > 4096) return fail();
  return {
    format: "jungsi.current-public-key-lookup/v3",
    prefix,
    schools,
    guides: guides.map((
      e,
    ) => [(e.key[0] - 2024) * schools.length + positions.get(e.key[1])!, e.key[2]]),
    strings: fallback.strings,
    entries: fallback.entries,
  };
}
function decodePackedLookup(raw: Record<string, unknown>): PublicKeyIndexEntry[] {
  if (
    !Array.isArray(raw.schools) || raw.schools.length > 16384 ||
    raw.schools.some((s) => !text(s)) || new Set(raw.schools).size !== raw.schools.length ||
    !Array.isArray(raw.guides) || !Array.isArray(raw.entries) ||
    raw.guides.length + raw.entries.length > 16384
  ) return fail();
  const schools = raw.schools as string[];
  const guides = raw.guides.map((tuple) => {
    if (
      !Array.isArray(tuple) || tuple.length !== 2 || !Number.isSafeInteger(tuple[0]) ||
      tuple[0] < 0 || tuple[0] >= schools.length * 4 || !text(tuple[1]) || !tuple[1]
    ) return fail();
    const year = 2024 + Math.floor(tuple[0] / schools.length), pk = tuple[1], id = `${year}:${pk}`;
    return entry({
      key: [year, schools[tuple[0] % schools.length], pk, "", id],
      sourceKind: "guide",
      guide: null,
      nativeOfferingId: id,
      expectedFingerprint: null,
      search: { university: "", department: "", region: "", group: "" },
    }, true);
  });
  return [...guides, ...decodeCompactLookup(raw)];
}
async function lookupPrefix(id: string, compact: boolean, packed = false): Promise<string> {
  const first = (await publicKeyRawHash(new TextEncoder().encode(id))).slice(0, 2);
  return compact ? (Number.parseInt(first, 16) & (packed ? 1 : 7)).toString(16) : first;
}

/** Bounded IO, hash-pinned partitions and exclusive tuple continuation; no value cache. */
export class CurrentPublicMetadataKeyIndex implements CurrentPublicKeySelectionPort {
  private rootValue: Promise<PublicKeyIndexRoot> | undefined;
  constructor(
    private readonly basis: PublicKeyIndexBasis,
    private readonly read: PublicKeyObjectRead,
  ) {}
  private root(): Promise<PublicKeyIndexRoot> {
    return this.rootValue ??= (async () => {
      const raw = exact(await checked(this.read, reference(this.basis.root)), [
        "format",
        "metadata_sha256",
        "guide_command_state_sha256",
        "admission_head",
        "coverage",
        "history",
        "offerings",
        "lookups",
        "limits",
      ]);
      const h = head(raw.admission_head),
        coverage = exact(raw.coverage, [
          "scope",
          "review_receipt_sha256",
          "snapshot_sha256",
          "history_rows",
        ]),
        limits = exact(raw.limits, ["max_shards_per_search", "max_shard_rows"]);
      if (
        ![
          "jungsi.current-public-key-index/v1",
          "jungsi.current-public-key-index/v2",
          "jungsi.current-public-key-index/v3",
        ].includes(
          String(raw.format),
        ) ||
        this.basis.requiredFormat !== undefined && raw.format !== this.basis.requiredFormat ||
        raw.metadata_sha256 !== this.basis.metadataSha256 ||
        raw.guide_command_state_sha256 !== this.basis.guideCommandStateSha256 ||
        h.command_id !== this.basis.admissionHead.command_id ||
        h.payload_sha256 !== this.basis.admissionHead.payload_sha256 ||
        coverage.scope !== "all_eligible_current_db_observations_at_head" ||
        coverage.review_receipt_sha256 !== this.basis.coverageReceiptSha256 ||
        !HASH.test(String(coverage.snapshot_sha256)) ||
        !Number.isSafeInteger(coverage.history_rows) ||
        Number(coverage.history_rows) < 0 ||
        limits.max_shards_per_search !== 12 || limits.max_shard_rows !== 256
      ) return fail();
      for (const name of ["history", "offerings"] as const) {
        if (!Array.isArray(raw[name]) || raw[name].length > 4096) return fail();
        const ss = (raw[name] as unknown[]).map(shard);
        for (let i = 1; i < ss.length; i++) {
          if (comparePublicCatalogKeys(ss[i - 1].last, ss[i].first) >= 0) {
            return fail();
          }
        }
        raw[name] = ss;
      }
      if (
        (raw.history as KeyShard[]).reduce((n, s) => n + s.rows, 0) !==
          coverage.history_rows
      ) return fail();
      const packed = raw.format === "jungsi.current-public-key-index/v3",
        compact = packed || raw.format === "jungsi.current-public-key-index/v2";
      if (
        !record(raw.lookups) || Object.keys(raw.lookups).length > (packed ? 2 : compact ? 8 : 256)
      ) {
        return fail();
      }
      for (const [prefix, ref] of Object.entries(raw.lookups)) {
        if (!(packed ? /^[01]$/ : compact ? /^[0-7]$/ : /^[0-9a-f]{2}$/).test(prefix)) {
          return fail();
        }
        reference(ref, 262144);
      }
      return raw as unknown as PublicKeyIndexRoot;
    })();
  }
  private page(
    root: PublicKeyIndexRoot,
    keys: readonly PublicPreparedKey[],
    nextAfter: PublicCatalogKey | null,
  ): PublicPreparedKeyPage {
    return {
      keys,
      nextAfter,
      admissionHead: { ...root.admission_head },
      coverage: root.coverage.scope,
      indexSha256: this.basis.root.sha256,
    };
  }
  async select(
    kind: PublicCatalogKind,
    q: PublicCatalogQuery,
    after: PublicCatalogKey | null,
  ): Promise<PublicPreparedKeyPage> {
    if (
      !["history", "offerings"].includes(kind) ||
      !Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 100
    ) return fail();
    if (after) publicCatalogKey(after);
    const root = await this.root(),
      descriptors = root[kind],
      out: PublicPreparedKey[] = [];
    let reads = 0, progress = after;
    for (let i = 0; i < descriptors.length; i++) {
      const d = descriptors[i];
      if (after && comparePublicCatalogKeys(d.last, after) <= 0) continue;
      if (
        q.academic_year !== null &&
          (d.last[0] < q.academic_year || d.first[0] > q.academic_year) ||
        q.university_q && d.universities !== null &&
          !d.universities.some((u) => u.includes(q.university_q))
      ) {
        progress = d.last;
        continue;
      }
      if (reads === root.limits.max_shards_per_search) {
        return this.page(root, out, progress);
      }
      reads++;
      const raw = exact(await checked(this.read, d.reference), [
        "format",
        "kind",
        "entries",
      ]);
      if (
        raw.format !== "jungsi.current-public-key-shard/v1" ||
        raw.kind !== kind || !Array.isArray(raw.entries) ||
        raw.entries.length !== d.rows
      ) return fail();
      const entries = raw.entries.map((value) =>
        entry(value, root.format !== "jungsi.current-public-key-index/v1")
      );
      for (let j = 0; j < entries.length; j++) {
        const e = entries[j];
        if (
          j && comparePublicCatalogKeys(entries[j - 1].key, e.key) >= 0 ||
          kind === "history" &&
            (e.key[0] === 2027 || e.sourceKind !== "admission")
        ) return fail();
        if (
          d.universities !== null &&
          !d.universities.includes(e.search.university)
        ) return fail();
      }
      if (
        comparePublicCatalogKeys(entries[0].key, d.first) !== 0 ||
        comparePublicCatalogKeys(entries.at(-1)!.key, d.last) !== 0
      ) return fail();
      for (const e of entries) {
        if (after && comparePublicCatalogKeys(e.key, after) <= 0) continue;
        progress = e.key;
        if (matches(e, q)) out.push(bare(e));
        if (out.length === q.limit + 1) return this.page(root, out, null);
      }
    }
    return this.page(root, out, null);
  }
  async resolve(
    ids: readonly string[],
    _recruitment: boolean,
  ): Promise<PublicPreparedKeyPage> {
    if (
      !Array.isArray(ids) || !ids.length || ids.length > 100 ||
      new Set(ids).size !== ids.length || ids.some((id) => !ID.test(id))
    ) return fail();
    const root = await this.root(),
      groups = new Map<string, string[]>(),
      packed = root.format === "jungsi.current-public-key-index/v3",
      compact = packed || root.format === "jungsi.current-public-key-index/v2";
    for (const id of ids) {
      const prefix = await lookupPrefix(id, compact, packed);
      groups.set(prefix, [...(groups.get(prefix) ?? []), id]);
    }
    // An over-budget batch fails closed instead of returning false 404s for unread shards.
    if (groups.size > 12) return fail();
    const out: PublicPreparedKey[] = [];
    for (const [prefix, requested] of groups) {
      const ref = root.lookups[prefix];
      if (!ref) continue;
      const raw = exact(
        await checked(this.read, ref),
        packed
          ? ["format", "prefix", "schools", "guides", "strings", "entries"]
          : compact
          ? ["format", "prefix", "strings", "entries"]
          : ["format", "prefix", "entries"],
      );
      if (
        raw.format !==
          (packed
            ? "jungsi.current-public-key-lookup/v3"
            : compact
            ? "jungsi.current-public-key-lookup/v2"
            : "jungsi.current-public-key-lookup/v1") ||
        raw.prefix !== prefix || !Array.isArray(raw.entries) ||
        raw.entries.length > (compact ? 4096 : 2048)
      ) return fail();
      const seen = new Set<string>();
      const values = packed
        ? decodePackedLookup(raw)
        : compact
        ? decodeCompactLookup(raw)
        : raw.entries.map((value) => entry(value));
      for (const e of values) {
        const id = e.nativeOfferingId!;
        if (
          seen.has(id) ||
          await lookupPrefix(id, compact, packed) !== prefix
        ) return fail();
        seen.add(id);
        if (requested.includes(id)) out.push(bare(e));
      }
    }
    out.sort((a, b) => comparePublicCatalogKeys(a.key, b.key));
    return this.page(root, out, null);
  }
}

export interface PublicKeyIndexPreparation {
  history: readonly PublicKeyIndexEntry[];
  offerings: readonly PublicKeyIndexEntry[];
  lookups: readonly PublicKeyIndexEntry[];
  metadataSha256: string;
  guideCommandStateSha256: string;
  admissionHead: PublicKeyIndexRoot["admission_head"];
  coverage: PublicKeyIndexRoot["coverage"];
  objectPrefix: string;
}
/** Pure preparation from a Data-team snapshot; this function never verifies DB-wide coverage. */
export async function prepareCurrentPublicKeyIndex(
  input: PublicKeyIndexPreparation,
): ReturnType<typeof prepareIndex> {
  return await prepareIndex(input, false);
}
/** Eight byte-bounded lookup objects support a full 100-ID batch without widening read budgets. */
export async function prepareCurrentPublicKeyIndexV2(
  input: PublicKeyIndexPreparation,
): ReturnType<typeof prepareIndex> {
  return await prepareIndex(input, true);
}
/** Two byte-bounded lookup objects, with reversible two-field guide tuples and native-string PKs. */
export async function prepareCurrentPublicKeyIndexV3(
  input: PublicKeyIndexPreparation,
): ReturnType<typeof prepareIndex> {
  return await prepareIndex(input, true, true);
}
async function prepareIndex(
  input: PublicKeyIndexPreparation,
  compact: boolean,
  packed = false,
): Promise<
  {
    status: "PREPARED_REQUIRES_EXTERNAL_COVERAGE_REVIEW";
    root: PublicKeyObjectReference;
    objects: ReadonlyMap<string, Uint8Array>;
  }
> {
  if (
    !HASH.test(input.metadataSha256) ||
    !HASH.test(input.guideCommandStateSha256) ||
    !input.objectPrefix.endsWith("/")
  ) return fail();
  head(input.admissionHead);
  const coverage = exact(input.coverage, [
    "scope",
    "review_receipt_sha256",
    "snapshot_sha256",
    "history_rows",
  ]);
  if (
    coverage.scope !== "all_eligible_current_db_observations_at_head" ||
    !HASH.test(String(coverage.review_receipt_sha256)) ||
    !HASH.test(String(coverage.snapshot_sha256)) ||
    coverage.history_rows !== input.history.length
  ) return fail();
  const snapshot = {
    history: input.history,
    offerings: input.offerings,
    lookups: input.lookups,
  };
  if (await nativeJsonSha256(snapshot) !== coverage.snapshot_sha256) {
    return fail();
  }
  const objects = new Map<string, Uint8Array>();
  const put = async (name: string, value: unknown, max = 262144) => {
    const bytes = new TextEncoder().encode(nativeJsonText(value, true));
    if (bytes.length > max) return fail();
    const sha256 = await publicKeyRawHash(bytes),
      ref = {
        object_key: input.objectPrefix + name + "." + sha256 + ".json",
        bytes: bytes.length,
        sha256,
      };
    reference(ref, max);
    objects.set(ref.object_key, bytes);
    return ref;
  };
  const root: PublicKeyIndexRoot = {
    format: packed
      ? "jungsi.current-public-key-index/v3"
      : compact
      ? "jungsi.current-public-key-index/v2"
      : "jungsi.current-public-key-index/v1",
    metadata_sha256: input.metadataSha256,
    guide_command_state_sha256: input.guideCommandStateSha256,
    admission_head: { ...input.admissionHead },
    coverage: input.coverage,
    history: [],
    offerings: [],
    lookups: {},
    limits: { max_shards_per_search: 12, max_shard_rows: 256 },
  };
  for (const kind of ["history", "offerings"] as const) {
    const rows = input[kind].map((value) => entry(value, compact)).sort((a, b) =>
        comparePublicCatalogKeys(a.key, b.key)
      ),
      ss: KeyShard[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (
        i && comparePublicCatalogKeys(rows[i - 1].key, rows[i].key) >= 0 ||
        kind === "history" &&
          (rows[i].key[0] === 2027 || rows[i].sourceKind !== "admission")
      ) return fail();
    }
    for (let i = 0; i < rows.length; i += 256) {
      const part = rows.slice(i, i + 256),
        universities = [...new Set(part.map((e) => e.search.university))]
          .sort();
      ss.push({
        reference: await put(kind + "-" + i, {
          format: "jungsi.current-public-key-shard/v1",
          kind,
          entries: part,
        }),
        first: part[0].key,
        last: part.at(-1)!.key,
        rows: part.length,
        universities: universities.length <= 64 ? universities : null,
      });
    }
    root[kind] = ss;
  }
  const lookup = new Map<string, PublicKeyIndexEntry[]>(),
    seen = new Set<string>();
  for (const value of input.lookups) {
    const e = entry(value, compact), id = e.nativeOfferingId!;
    if (seen.has(id)) return fail();
    seen.add(id);
    const prefix = await lookupPrefix(id, compact, packed);
    lookup.set(prefix, [...(lookup.get(prefix) ?? []), e]);
  }
  const refs: Record<string, PublicKeyObjectReference> = {};
  for (const [prefix, entries] of lookup) {
    if (entries.length > (packed ? 16384 : compact ? 4096 : 2048)) return fail();
    refs[prefix] = await put(
      "lookup-" + prefix,
      packed ? packedLookup(prefix, entries) : compact ? compactLookup(prefix, entries) : {
        format: "jungsi.current-public-key-lookup/v1",
        prefix,
        entries,
      },
    );
  }
  root.lookups = refs;
  return {
    status: "PREPARED_REQUIRES_EXTERNAL_COVERAGE_REVIEW",
    root: await put("root", root, 524288),
    objects,
  };
}
