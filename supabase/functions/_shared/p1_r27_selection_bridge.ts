/** REVIEW ONLY. Server-owned port composition; no DB, Storage, route or publisher.
 * Void-returning issuer operations must independently authenticate all facts; a
 * permissive stub is not evidence. Original source bytes remain unchanged.
 */
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import {
  bindP1R27Evidence,
  composeP1R27Candidate,
  type P1BaselineBatchPort,
  type P1R27ByteSource,
  type P1R27Candidate,
  type P1R27Limits,
  type P1R27Pins,
} from "./jungsi/application/p1_r27_composition.ts";
import type { ReviewedR27Links, ReviewedR27Scope } from "./jungsi/application/r27_standalone.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "./jungsi/domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "./jungsi/domain/native_json.ts";
import {
  CurrentPublicR27BoundedService,
  OWN_2027_CANDIDATE_MAX_KEYS,
} from "./current_public_r27_bounded.ts";
import type { Own2027NativeQuota, Own2027SelectionItem } from "./current_public_r27_selection.ts";

type Key = Readonly<{ academic_year: 2027; school_id: string; offering_pk: string }>;
type PageReview = Readonly<{
  page_index: number;
  page_sha256: string;
  source_row_sha256: string;
  subject: Key;
  source_scope_state: string;
  selection_reasons: readonly string[];
  source_only_fields: Readonly<Record<string, "absent" | "null" | "present">>;
}>;
type ScopeReview = Readonly<{
  pins: P1R27Pins;
  ordered_keys_sha256: string;
  rows: number;
  pages: number;
}>;
export interface P1SelectionGate {
  readonly request: ApiExecution;
  readonly boundary: ApiExecutionBoundary;
  readonly admission: unknown;
  readonly signal: AbortSignal;
  readonly deadlineMonotonicMs: number;
  readonly maxPages: number;
  readonly maxRows: number;
  readonly maxSourceBytes: number;
}
export interface P1PagePin {
  readonly index: number;
  readonly sha256: string;
  readonly bytes: number;
  readonly rows: number;
}
/** Server-owned approved locator batch. The physical provider must enforce the
 * shared admission, deadline, cancellation and total byte limits; no per-row
 * fallback is permitted. This interface alone proves none of those controls.
 */
export interface P1SelectionBatchSource {
  readPages(
    pages: readonly P1PagePin[],
    pins: Readonly<P1R27Pins>,
    gate: P1SelectionGate,
  ): Promise<unknown>;
  assertSourceHead(expected: string, gate: P1SelectionGate): Promise<void>;
}
/** The existing baseline batch is wrapped in a server-owned provider that must
 * enforce this same admission, deadline and cancellation on physical I/O.
 * This interface is not proof that the provider is atomic or cancellable.
 */
export interface P1SelectionBaselineBatch {
  readPinnedBatch(
    request: Parameters<P1BaselineBatchPort["readPinnedBatch"]>[0],
    gate: P1SelectionGate,
  ): ReturnType<P1BaselineBatchPort["readPinnedBatch"]>;
  assertCurrent(
    request: Parameters<P1BaselineBatchPort["assertCurrent"]>[0],
    gate: P1SelectionGate,
  ): Promise<void>;
}
export interface SourcePageAuthorization {
  readonly manifest_sha256: string;
  readonly source_sha256: string;
  readonly source_head_sha256: string;
  readonly scope_sha256: string;
  readonly previous_publication_sha256: string;
  readonly previous_source_head_sha256: string;
  readonly subject_id: string;
  readonly expected_rows: number;
  readonly page_count: number;
  readonly declared_bytes: number;
  readonly pages: readonly P1PagePin[];
}
export interface IndependentP1SelectionIssuer {
  /** Verify independent issuer, permitted request, exact descriptor, pins and source authority. */
  assertPins(pins: Readonly<P1R27Pins>, gate: P1SelectionGate): Promise<void>;
  /** Independently authorize this exact manifest/page census, scope, heads, subject
   * and shared admission before the first source read; a hash echo is not approval. */
  assertSourcePages(
    request: Readonly<SourcePageAuthorization>,
    pins: Readonly<P1R27Pins>,
    gate: P1SelectionGate,
  ): Promise<void>;
  /** Verify the complete ordered source key census and source/head/scope at one authority. */
  assertScope(scope: ScopeReview, gate: P1SelectionGate): Promise<void>;
  /** Independently verify each source row, source-only fields, condition,
   * SQL/JSON null origin, non-practical status and its selection/source/head linkage.
   * Each invocation must use bounded batch I/O under the same shared admission,
   * not one physical query per row. A caller echo or hash is not approval.
   */
  assertBatch(
    page: readonly PageReview[],
    selectionHead: string,
    publication: string,
    pins: Readonly<P1R27Pins>,
    gate: P1SelectionGate,
  ): Promise<void>;
  /** Re-read the independently approved current catalog head and publication. */
  assertSelectionCurrent(
    head: string,
    publication: string,
    pins: Readonly<P1R27Pins>,
    gate: P1SelectionGate,
  ): Promise<void>;
  assertLive(pins: Readonly<P1R27Pins>, gate: P1SelectionGate): Promise<void>;
}
export interface P1SelectionBridgeBudget {
  readonly maxPages: number;
  readonly maxRows: number;
  readonly maxSourceBytes: number;
  readonly timeoutMs: number;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sourceOnly = Object.freeze(
  [
    "university_name",
    "region",
    "department",
    "campus",
    "admission_track",
    "group",
    "scope",
    "source_ref",
    "quota_condition_text",
    "quota_cell",
  ] as const,
);
function need(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function obj(value: unknown): NativeObject {
  need(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      !(value instanceof JsonFloat),
    "source_shape",
  );
  return value as NativeObject;
}
function bytes(raw: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  const base = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(base, "byteLength")?.get;
  const brand = Object.getOwnPropertyDescriptor(base, Symbol.toStringTag)?.get;
  need(raw instanceof Uint8Array && length && brand, "source_bytes");
  let n: number, tag: unknown;
  try {
    n = Reflect.apply(length, raw, []) as number;
    tag = Reflect.apply(brand, raw, []);
  } catch {
    throw new Error("source_bytes");
  }
  need(tag === "Uint8Array" && Number.isSafeInteger(n) && n > 0 && n <= maximum, "source_bytes");
  const out = new Uint8Array(new ArrayBuffer(n));
  try {
    Uint8Array.prototype.set.call(out, raw);
  } catch {
    throw new Error("source_bytes");
  }
  return out;
}
async function sha(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw.buffer))].map((n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
}
function parse(raw: Uint8Array<ArrayBuffer>): NativeObject {
  return obj(parseNativeJson(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
}
function sameNative(a: NativeJson, b: NativeJson): boolean {
  if (a instanceof JsonFloat || b instanceof JsonFloat) {
    return a instanceof JsonFloat && b instanceof JsonFloat && a.lexeme === b.lexeme;
  }
  return typeof a === typeof b && nativeJsonText(a, true) === nativeJsonText(b, true);
}
function equalField(row: NativeObject, field: string, got: Own2027NativeQuota): boolean {
  if (!Object.hasOwn(row, field)) return got.state === "absent";
  return got.state === "present" && sameNative(row[field], got.value);
}
function ownKey(row: NativeObject): Key {
  need(
    row.academic_year === 2027 && typeof row.school_id === "string" && ID.test(row.school_id) &&
      typeof row.original_pk === "string" && ID.test(row.original_pk),
    "source_identity",
  );
  return Object.freeze({
    academic_year: 2027,
    school_id: row.school_id,
    offering_pk: row.original_pk,
  });
}
function dataSnapshot(raw: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  need(raw !== null && typeof raw === "object" && !Array.isArray(raw), "bridge_shape");
  const keys = Reflect.ownKeys(raw);
  need(
    keys.length === fields.length && keys.every((k) => typeof k === "string" && fields.includes(k)),
    "bridge_shape",
  );
  const result: Record<string, unknown> = {};
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    need(d && d.enumerable && "value" in d, "bridge_shape");
    result[k] = d.value;
  }
  return Object.freeze(result);
}
function boundedBudget(raw: P1SelectionBridgeBudget): P1SelectionBridgeBudget {
  const b = dataSnapshot(raw, ["maxPages", "maxRows", "maxSourceBytes", "timeoutMs"]);
  need(
    typeof b.maxPages === "number" && Number.isSafeInteger(b.maxPages) && b.maxPages > 0 &&
      b.maxPages <= 512 &&
      typeof b.maxRows === "number" && Number.isSafeInteger(b.maxRows) && b.maxRows > 0 &&
      b.maxRows <= 20_000 &&
      typeof b.maxSourceBytes === "number" && Number.isSafeInteger(b.maxSourceBytes) &&
      b.maxSourceBytes > 0 && b.maxSourceBytes <= 134_217_728 &&
      typeof b.timeoutMs === "number" && Number.isSafeInteger(b.timeoutMs) && b.timeoutMs > 0 &&
      b.timeoutMs <= 60_000,
    "bridge_budget",
  );
  return b as unknown as P1SelectionBridgeBudget;
}
/** Materializes only approved bounded pages; selectors remain HOLD, and this function
 * produces a review candidate only. Abort stops this wait, not necessarily physical I/O.
 */
export async function composeSelectedP1R27Candidate(
  request: ApiExecution,
  boundary: ApiExecutionBoundary,
  selector: CurrentPublicR27BoundedService,
  issuer: IndependentP1SelectionIssuer,
  previous: P1SelectionBaselineBatch,
  source: P1SelectionBatchSource,
  manifestBytes: Uint8Array,
  coverageBytes: Uint8Array,
  pins: P1R27Pins,
  scope: ReviewedR27Scope,
  links: ReviewedR27Links | undefined,
  payloadId: string,
  limits: P1R27Limits,
  rawBudget: P1SelectionBridgeBudget,
): Promise<
  Readonly<
    { candidate: P1R27Candidate; source_only_fields: readonly string[]; publication_ready: false }
  >
> {
  const budget = boundedBudget(rawBudget);
  need(
    boundary && boundary.signal instanceof AbortSignal && !boundary.signal.aborted &&
      boundary.admission !== null && boundary.admission !== undefined,
    "admission_unavailable",
  );
  need(
    selector instanceof CurrentPublicR27BoundedService && issuer &&
      typeof issuer.assertPins === "function" && typeof issuer.assertSourcePages === "function" &&
      typeof issuer.assertScope === "function" &&
      typeof issuer.assertBatch === "function" &&
      typeof issuer.assertSelectionCurrent === "function" &&
      typeof issuer.assertLive === "function" &&
      previous && typeof previous.readPinnedBatch === "function" &&
      typeof previous.assertCurrent === "function" &&
      source && typeof source.readPages === "function" &&
      typeof source.assertSourceHead === "function",
    "bridge_port",
  );
  const issuerPins = issuer.assertPins.bind(issuer), issuerScope = issuer.assertScope.bind(issuer);
  const issuerSourcePages = issuer.assertSourcePages.bind(issuer);
  const issuerBatch = issuer.assertBatch.bind(issuer),
    issuerSelection = issuer.assertSelectionCurrent.bind(issuer);
  const issuerLive = issuer.assertLive.bind(issuer), sourceRead = source.readPages.bind(source);
  const sourceHead = source.assertSourceHead.bind(source);
  const baselineRead = previous.readPinnedBatch.bind(previous),
    baselineHead = previous.assertCurrent.bind(previous);
  const signal = boundary.signal, admission = boundary.admission;
  const session = request.session, user = session.user;
  const subject = user.subjectId, userExpiry = user.expiresAtUtc;
  const tier = session.tier, paidUntil = session.paidUntilUtc, evaluatedAt = session.evaluatedAtUtc;
  const operation = request.operation,
    body = request.body,
    query = request.query,
    params = request.params;
  const management = request.management, requestKey = request.requestKey;
  const started = performance.now();
  const gate: P1SelectionGate = Object.freeze({
    request,
    boundary,
    signal,
    admission,
    deadlineMonotonicMs: started + budget.timeoutMs,
    maxPages: budget.maxPages,
    maxRows: budget.maxRows,
    maxSourceBytes: budget.maxSourceBytes,
  });
  function check(): void {
    need(
      boundary.signal === signal && boundary.admission === admission && !signal.aborted &&
        request.session === session && session.user === user && user.subjectId === subject &&
        user.expiresAtUtc === userExpiry && session.tier === tier &&
        session.paidUntilUtc === paidUntil && session.evaluatedAtUtc === evaluatedAt &&
        request.operation === operation && request.body === body && request.query === query &&
        request.params === params && request.management === management &&
        request.requestKey === requestKey &&
        performance.now() - started < budget.timeoutMs,
      "bridge_cancelled_or_expired",
    );
  }
  async function wait<T>(work: () => Promise<T>): Promise<T> {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("bridge_cancelled_or_expired"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, Math.max(1, budget.timeoutMs - (performance.now() - started)));
    });
    try {
      const result = await Promise.race([work(), interrupted]);
      check();
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal.removeEventListener("abort", abort);
    }
  }
  async function voidResult(work: () => Promise<void>): Promise<void> {
    need(await wait(work) === undefined, "issuer_protocol");
  }
  const manifest = bytes(manifestBytes, 1_048_576), coverage = bytes(coverageBytes, 65_536);
  const pin = dataSnapshot(pins, [
    "manifest_sha256",
    "coverage_sha256",
    "source_sha256",
    "source_head_sha256",
    "previous_publication_sha256",
    "previous_source_head_sha256",
    "scope_sha256",
  ]) as unknown as P1R27Pins;
  need(Object.values(pin).every((v) => typeof v === "string" && HASH.test(v)), "bridge_pins");
  const bound = await wait(() => bindP1R27Evidence(manifest, coverage, pin));
  await voidResult(() => issuerPins(pin, gate));
  await voidResult(() => issuerLive(pin, gate));
  const prevHead = Object.freeze({
    previous_publication_sha256: pin.previous_publication_sha256,
    previous_source_head_sha256: pin.previous_source_head_sha256,
    scope_sha256: pin.scope_sha256,
  });
  const m = parse(manifest);
  need(
    Array.isArray(m.pages) && m.pages.length > 0 && m.pages.length <= budget.maxPages &&
      typeof m.expected_rows === "number" && Number.isSafeInteger(m.expected_rows) &&
      m.expected_rows > 0 && m.expected_rows <= budget.maxRows,
    "source_manifest",
  );
  const pagePins: P1PagePin[] = [];
  let declaredBytes = 0;
  for (let index = 0; index < m.pages.length; index++) {
    const expected = obj(m.pages[index]);
    need(
      typeof expected.bytes === "number" && Number.isSafeInteger(expected.bytes) &&
        expected.bytes > 0 && typeof expected.rows === "number" &&
        Number.isSafeInteger(expected.rows) &&
        expected.rows >= 0 && expected.rows <= 128 && typeof expected.sha256 === "string" &&
        HASH.test(expected.sha256),
      "source_manifest",
    );
    declaredBytes += expected.bytes;
    need(declaredBytes <= budget.maxSourceBytes, "source_byte_limit");
    pagePins.push(
      Object.freeze({ index, bytes: expected.bytes, rows: expected.rows, sha256: expected.sha256 }),
    );
  }
  const approvedPagePins = Object.freeze(pagePins);
  const sourceAuthorization: Readonly<SourcePageAuthorization> = Object.freeze({
    manifest_sha256: pin.manifest_sha256,
    source_sha256: pin.source_sha256,
    source_head_sha256: pin.source_head_sha256,
    scope_sha256: pin.scope_sha256,
    previous_publication_sha256: pin.previous_publication_sha256,
    previous_source_head_sha256: pin.previous_source_head_sha256,
    subject_id: subject,
    expected_rows: m.expected_rows as number,
    page_count: approvedPagePins.length,
    declared_bytes: declaredBytes,
    pages: approvedPagePins,
  });
  await voidResult(() => issuerSourcePages(sourceAuthorization, pin, gate));
  await voidResult(() => baselineHead(prevHead, gate));
  await voidResult(() => sourceHead(pin.source_head_sha256, gate));
  const rawPages = await wait(() => sourceRead(approvedPagePins, pin, gate));
  need(Array.isArray(rawPages), "source_batch_shape");
  const length = Object.getOwnPropertyDescriptor(rawPages, "length");
  need(
    length && "value" in length && length.value === pagePins.length &&
      Reflect.ownKeys(rawPages).length === pagePins.length + 1,
    "source_batch_shape",
  );
  const cached: Uint8Array<ArrayBuffer>[] = [], rowsByPage: NativeObject[][] = [];
  const allKeys: Key[] = [], seen = new Set<string>();
  for (let index = 0; index < pagePins.length; index++) {
    const d = Object.getOwnPropertyDescriptor(rawPages, String(index));
    need(d && d.enumerable && "value" in d, "source_batch_shape");
    const expected = pagePins[index], raw = bytes(d.value, expected.bytes);
    need(raw.length === expected.bytes && await sha(raw) === expected.sha256, "source_digest");
    const page = parse(raw);
    need(
      page.format === "jungsi.r27-source-page/v1" && page.source_sha256 === pin.source_sha256 &&
        page.source_head_sha256 === pin.source_head_sha256 && page.index === index &&
        Array.isArray(page.rows) && page.rows.length === expected.rows,
      "source_page",
    );
    const rows = page.rows.map(obj);
    for (const row of rows) {
      const key = ownKey(row), fingerprint = key.school_id + "\u0000" + key.offering_pk;
      need(!seen.has(fingerprint) && allKeys.length < budget.maxRows, "source_duplicate_or_limit");
      seen.add(fingerprint);
      allKeys.push(key);
    }
    cached.push(raw);
    rowsByPage.push(rows);
  }
  need(allKeys.length === m.expected_rows, "source_coverage");
  const orderedKeysSha = await nativeJsonSha256(allKeys as unknown as NativeJson);
  await voidResult(() =>
    issuerScope(
      Object.freeze({
        pins: pin,
        ordered_keys_sha256: orderedKeysSha,
        rows: allKeys.length,
        pages: cached.length,
      }),
      gate,
    )
  );
  const callSelection = CurrentPublicR27BoundedService.prototype.selectedOwn2027Guides.bind(
    selector,
  );
  const selected: Own2027SelectionItem[] = [];
  let selectionHead: string | null = null, selectionPublication: string | null = null;
  // Source page boundaries are deliberately irrelevant to logical catalog batches.
  for (let offset = 0; offset < allKeys.length; offset += OWN_2027_CANDIDATE_MAX_KEYS) {
    await voidResult(() => issuerLive(pin, gate));
    const keys = Object.freeze(allKeys.slice(offset, offset + OWN_2027_CANDIDATE_MAX_KEYS));
    const chosen = await wait(() => callSelection(request, boundary, keys));
    need(
      chosen.items.length === keys.length && HASH.test(chosen.head_sha256) &&
        HASH.test(chosen.publication_sha256),
      "selection_batch",
    );
    if (selectionHead === null) {
      selectionHead = chosen.head_sha256;
      selectionPublication = chosen.publication_sha256;
    }
    need(
      selectionHead === chosen.head_sha256 && selectionPublication === chosen.publication_sha256,
      "selection_head_changed",
    );
    selected.push(...chosen.items);
  }
  need(
    selected.length === allKeys.length && selectionHead !== null && selectionPublication !== null,
    "selection_missing",
  );
  const reviews: PageReview[] = [];
  let position = 0;
  for (let i = 0; i < rowsByPage.length; i++) {
    for (const row of rowsByPage[i]) {
      const key = allKeys[position], item = selected[position++];
      need(
        item.academic_year === 2027 && item.school_id === key.school_id &&
          item.offering_pk === key.offering_pk && item.offering_id === "2027:" + key.offering_pk &&
          item.status === "HOLD",
        "selection_identity",
      );
      need(
        equalField(row, "quota_value", item.quota_native) &&
          equalField(row, "quota_literal_state", item.quota_literal_native) &&
          equalField(row, "quota_stage", item.quota_stage_native),
        "native_value_mismatch",
      );
      const sourceScope = obj(row.scope);
      need(typeof sourceScope.state === "string", "source_scope");
      need(
        !item.reasons.some((x) => x === "NOT_RETURNED" || x === "GUIDE_LINK_UNVERIFIED"),
        "selection_unverified",
      );
      need(
        ["CONDITIONAL_SOURCE_UNPROVEN", "NULL_ORIGIN_UNPROVEN", "PRACTICAL_EVIDENCE_UNPROVEN"]
          .every((reason) => item.reasons.includes(reason)),
        "selection_reason_missing",
      );
      const gaps: Record<string, "absent" | "null" | "present"> = {};
      for (const field of sourceOnly) {
        gaps[field] = !Object.hasOwn(row, field)
          ? "absent"
          : row[field] === null
          ? "null"
          : "present";
      }
      reviews.push(
        Object.freeze({
          page_index: i,
          page_sha256: pagePins[i].sha256,
          source_row_sha256: await nativeJsonSha256(row),
          subject: key,
          source_scope_state: sourceScope.state,
          selection_reasons: Object.freeze([...item.reasons]),
          source_only_fields: Object.freeze(gaps),
        }),
      );
    }
  }
  need(position === selected.length, "source_coverage");
  for (let offset = 0; offset < reviews.length; offset += 100) {
    const group = Object.freeze(reviews.slice(offset, offset + 100));
    const h = selectionHead, publication = selectionPublication;
    await voidResult(() => issuerBatch(group, h, publication, pin, gate));
  }
  need(selectionHead !== null && selectionPublication !== null, "selection_missing");
  const finalSelectionHead = selectionHead, finalSelectionPublication = selectionPublication;
  await voidResult(() => issuerSelection(finalSelectionHead, finalSelectionPublication, pin, gate));
  await voidResult(() => issuerLive(pin, gate));
  await voidResult(() => sourceHead(pin.source_head_sha256, gate));
  await voidResult(() => baselineHead(prevHead, gate));
  let cursor = 0;
  const cachedSource: P1R27ByteSource = {
    readPage: (index) => {
      check();
      need(index === cursor && index < cached.length, "source_page_order");
      cursor++;
      return Promise.resolve(Uint8Array.from(cached[index]));
    },
    assertSourceHead: (expected) => voidResult(() => sourceHead(expected, gate)),
  };
  const guardedPrevious: P1BaselineBatchPort = {
    readPinnedBatch: (r) => wait(() => baselineRead(r, gate)),
    assertCurrent: (r) => voidResult(() => baselineHead(r, gate)),
  };
  const candidate = await wait(() =>
    composeP1R27Candidate(guardedPrevious, cachedSource, bound, scope, links, payloadId, limits)
  );
  need(cursor === cached.length && candidate.status === "HOLD_UNPUBLISHED", "producer_incomplete");
  await voidResult(() => issuerSelection(finalSelectionHead, finalSelectionPublication, pin, gate));
  await voidResult(() => issuerLive(pin, gate));
  await voidResult(() => sourceHead(pin.source_head_sha256, gate));
  await voidResult(() => baselineHead(prevHead, gate));
  return Object.freeze({
    candidate,
    source_only_fields: sourceOnly,
    publication_ready: false as const,
  });
}
