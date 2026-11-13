/**
 * REVIEW ONLY: builds unapproved P1 v2 INPUTS from the new v25 statistics,
 * 2027 Guide lineage, CID/shape/change references and an SQL-source receipt.
 * It never copies prior snapshot rows,
 * invents scope/qualification, writes files or storage, creates an approved
 * manifest/head/receipt, changes a DB, or installs a runtime. Output is private.
 */
import { AccessError } from "./access.ts";
import type { SnapshotPublication } from "./history_snapshot.ts";
import { validateP1PreparedPartsGlobal } from "./p1_r27_global_parts.ts";
import { nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson, parseNativeJson } from "../domain/native_json.ts";

export type P1V2InputPins = Readonly<{
  v25Sha256: string;
  guideSha256: string;
  historicalReferencesSha256: string;
  unqualifiedChangeReferencesSha256: string;
  pendingCutContextReferencesSha256: string;
  exactRuleSqlReceiptSha256: string;
  /** The previous published head is a predecessor, never the new v25 source head. */
  previousHeadSha256: string;
  guideRows: number;
  v25Rows: number;
  historicalReferenceRows: number;
  unqualifiedChangeReferenceRows: number;
  pendingCutContextReferenceRows: number;
}>;
/** Must authenticate real receipts, ownership, current source and previous publication.
 * Input hashes, row counts, this type and a structural check are not approval. All I/O must
 * physically stop before resolution/rejection, including on abort. No issuer is installed. */
export interface P1V2InputAuthority {
  assertInputCurrent(pins: P1V2InputPins, signal: AbortSignal): Promise<void>;
  /** Independently verify an actually issued publication, all source/scope/consumer and review
   * evidence before the existing global validator is called; never synthesize approved fields. */
  assertPublicationCurrent(
    pins: P1V2InputPins,
    publication: SnapshotPublication,
    signal: AbortSignal,
  ): Promise<void>;
  awaitQuiescence(signal: AbortSignal): Promise<void>;
}
export type P1V2ReviewRow = Readonly<{
  academicYear: 2027;
  offeringPk: string;
  /** Original unassessed 2027 Guide/lineage row; not an approved P1 row. */
  guideLineage: NativeObject;
  /** Matching v25 source rows retain original text and missing rows stay null. */
  pastV25: readonly Readonly<
    { academicYear: 2024 | 2025 | 2026; offeringPk: string; source: NativeObject | null }
  >[];
  /** CID references are unassessed, not evidence of matching cutoff/cohort. */
  historicalReferences: NativeObject;
  /** Unassessed references only; no numeric adjustment or forecast approval is implied. */
  unqualifiedChangeReferences: readonly NativeObject[];
  pendingCutContextReferences: readonly NativeObject[];
}>;
export type P1V2ReviewPage = Readonly<{
  status: "HOLD_UNPUBLISHED";
  sourcePins: P1V2InputPins;
  rows: readonly P1V2ReviewRow[];
  nextOffset: number | null;
}>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELDS = ["학교ID", "학교", "모집단위", "전형", "모집군"] as const;
const VALUE_FIELDS = [
  "최초모집인원",
  "수시이월인원",
  "최종모집인원",
  "모집인원_발표기준미명시",
  "경쟁률",
  "충원합격인원_명",
  "최종합격예비번호_번",
  "충원발표값_정의확인대기",
  "원문충원항목명",
  "발표모집집단",
  "공동발표학과목록",
  "조회자료상태",
  "최종합격예비번호_발표기준",
] as const;
function fail(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function object(value: unknown): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat) {
    fail();
  }
  return value as NativeObject;
}
function freezeTree(value: NativeJson): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeTree(item as NativeJson);
  Object.freeze(value);
}
function live(signal: AbortSignal): void {
  if (!signal || signal.aborted) fail();
}
function year(value: unknown): 2024 | 2025 | 2026 {
  if (value !== 2024 && value !== 2025 && value !== 2026) fail();
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) fail();
  return value;
}
function key(y: number, pk: string): string {
  return JSON.stringify([y, pk]);
}
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
function lines(bytes: Uint8Array, maximumRows: number): NativeObject[] {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 32 * 1024 * 1024) fail();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const entries = text.split("\n");
  if (entries.at(-1) === "") entries.pop();
  if (
    !entries.length || entries.length > maximumRows ||
    entries.some((line) => !line || line.length > 1_048_576)
  ) fail();
  return entries.map((line) => {
    const row = object(parseNativeJson(line));
    freezeTree(row);
    return row;
  });
}
function copyPins(pins: P1V2InputPins): P1V2InputPins {
  if (
    !pins ||
    ![
      pins.v25Sha256,
      pins.guideSha256,
      pins.historicalReferencesSha256,
      pins.unqualifiedChangeReferencesSha256,
      pins.pendingCutContextReferencesSha256,
      pins.exactRuleSqlReceiptSha256,
      pins.previousHeadSha256,
    ].every((v) => typeof v === "string" && HASH.test(v)) ||
    ![
      pins.guideRows,
      pins.v25Rows,
      pins.historicalReferenceRows,
      pins.unqualifiedChangeReferenceRows,
      pins.pendingCutContextReferenceRows,
    ].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 100_000)
  ) fail();
  return Object.freeze({ ...pins });
}

/** Private owner-side index. Review rows are not P1 payload rows and cannot be published directly. */
export class P1V25V2ReviewInput {
  private constructor(
    readonly pins: P1V2InputPins,
    private readonly guide: readonly NativeObject[],
    private readonly v25: ReadonlyMap<string, NativeObject>,
    private readonly references: ReadonlyMap<string, NativeObject>,
    private readonly changes: ReadonlyMap<string, readonly NativeObject[]>,
    private readonly contexts: ReadonlyMap<string, readonly NativeObject[]>,
    private readonly authority: P1V2InputAuthority,
  ) {}
  static async open(
    input: Readonly<
      {
        v25: Uint8Array;
        guide: Uint8Array;
        references: Uint8Array;
        changes: Uint8Array;
        cutContexts: Uint8Array;
        ruleSqlReceipt: Uint8Array;
      }
    >,
    inputPins: P1V2InputPins,
    signal: AbortSignal,
    authority: P1V2InputAuthority,
  ): Promise<P1V25V2ReviewInput> {
    const pins = copyPins(inputPins);
    if (
      !authority || typeof authority.assertInputCurrent !== "function" ||
      typeof authority.assertPublicationCurrent !== "function" ||
      typeof authority.awaitQuiescence !== "function" || !input ||
      ![
        input.v25,
        input.guide,
        input.references,
        input.changes,
        input.cutContexts,
        input.ruleSqlReceipt,
      ].every((bytes) =>
        bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= 32 * 1024 * 1024
      )
    ) fail();
    live(signal);
    try {
      await authority.assertInputCurrent(pins, signal);
      live(signal);
      // Detach copies before asynchronous digest; caller mutation cannot change verified input.
      const v25Bytes = Uint8Array.from(input.v25),
        guideBytes = Uint8Array.from(input.guide),
        refBytes = Uint8Array.from(input.references),
        changeBytes = Uint8Array.from(input.changes),
        contextBytes = Uint8Array.from(input.cutContexts),
        sqlReceiptBytes = Uint8Array.from(input.ruleSqlReceipt);
      if (
        await digest(v25Bytes) !== pins.v25Sha256 ||
        await digest(guideBytes) !== pins.guideSha256 ||
        await digest(refBytes) !== pins.historicalReferencesSha256 ||
        await digest(changeBytes) !== pins.unqualifiedChangeReferencesSha256 ||
        await digest(contextBytes) !== pins.pendingCutContextReferencesSha256 ||
        await digest(sqlReceiptBytes) !== pins.exactRuleSqlReceiptSha256
      ) fail();
      // The SQL bytes are a pinned source receipt only; never parse as SQL or execute them.
      live(signal);
      const stats = lines(v25Bytes, pins.v25Rows),
        guide = lines(guideBytes, pins.guideRows),
        refs = lines(refBytes, pins.historicalReferenceRows),
        changeRows = lines(changeBytes, pins.unqualifiedChangeReferenceRows),
        contextRows = lines(contextBytes, pins.pendingCutContextReferenceRows);
      if (
        stats.length !== pins.v25Rows || guide.length !== pins.guideRows ||
        refs.length !== pins.historicalReferenceRows ||
        changeRows.length !== pins.unqualifiedChangeReferenceRows ||
        contextRows.length !== pins.pendingCutContextReferenceRows
      ) fail();
      const v25 = new Map<string, NativeObject>(),
        references = new Map<string, NativeObject>(),
        guideKeys = new Set<string>(),
        guideByPk = new Map<string, NativeObject>(),
        changes = new Map<string, NativeObject[]>(),
        contexts = new Map<string, NativeObject[]>();
      for (const row of stats) {
        const y = year(row.academicYear),
          pk = id(row.offeringPk),
          values = object(row.values),
          k = key(y, pk);
        // Owner's 15-column view deliberately omits the five Guide identity fields.
        if (
          FIELDS.some((f) => Object.hasOwn(values, f)) ||
          Object.keys(values).length !== VALUE_FIELDS.length ||
          VALUE_FIELDS.some((f) =>
            !Object.hasOwn(values, f) || (values[f] !== null && typeof values[f] !== "string")
          ) ||
          v25.has(k)
        ) fail();
        v25.set(k, row);
      }
      for (const row of guide) {
        if (
          row.academicYear !== 2027 || !Array.isArray(row.historical_keys) ||
          row.service_scope !== "NOT_ASSESSED_BY_THIS_CANDIDATE"
        ) fail();
        const pk = id(row.offeringPk);
        if (guideKeys.has(pk)) fail();
        guideKeys.add(pk);
        guideByPk.set(pk, row);
        object(row.guide);
      }
      for (const row of refs) {
        if (row.academicYear !== 2027 || row.service_scope !== "NOT_ASSESSED_BY_THIS_CANDIDATE") {
          fail();
        }
        const pk = id(row.offeringPk);
        object(row.references_by_year);
        if (references.has(pk) || !guideKeys.has(pk)) fail();
        references.set(pk, row);
      }
      if (references.size !== guideKeys.size) fail();
      const changePairs = new Set<string>();
      for (const row of changeRows) {
        if (
          row.academicYear !== 2027 || row.priorYear !== 2026 ||
          row.service_scope !== "NOT_ASSESSED" ||
          row.same_cohort_same_final_stage_not_asserted !== true ||
          row.automatic_score_or_cut_adjustment !== null ||
          !Array.isArray(row.flags) || row.flags.some((flag) => typeof flag !== "string")
        ) fail();
        const pk = id(row.offeringPk),
          priorPk = id(row.priorOfferingPk),
          original = guideByPk.get(pk);
        if (
          !original || !Array.isArray(original.historical_keys) ||
          !original.historical_keys.some((value) => {
            const h = object(value);
            return h.academicYear === 2026 && h.offeringPk === priorPk;
          })
        ) fail();
        const pair = JSON.stringify([pk, priorPk]);
        if (changePairs.has(pair)) fail();
        changePairs.add(pair);
        const list = changes.get(pk) ?? [];
        list.push(row);
        changes.set(pk, list);
      }
      for (const row of contextRows) {
        if (
          row.academicYear !== 2027 || row.service_scope !== "NOT_ASSESSED_BY_THIS_CANDIDATE" ||
          !Array.isArray(row.three_year_cut_context_candidates)
        ) fail();
        const pk = id(row.offeringPk);
        if (!guideKeys.has(pk)) fail();
        // Preserve candidate shape as unassessed data; do not infer common cohort, cutoff or approval.
        const list = contexts.get(pk) ?? [];
        list.push(row);
        contexts.set(pk, list);
      }
      for (const list of changes.values()) Object.freeze(list);
      for (const list of contexts.values()) Object.freeze(list);
      await authority.assertInputCurrent(pins, signal);
      live(signal);
      return new P1V25V2ReviewInput(
        pins,
        Object.freeze(guide),
        v25,
        references,
        changes,
        contexts,
        authority,
      );
    } finally {
      try {
        await authority.awaitQuiescence(signal);
      } catch {
        await new Promise<never>(() => {});
      }
    }
  }
  /** Up to 128 rows per page. It never promotes source paths to approved cross-year links. */
  async page(offset: number, limit: number, signal: AbortSignal): Promise<P1V2ReviewPage> {
    if (
      !Number.isSafeInteger(offset) || offset < 0 || offset >= this.guide.length ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 128
    ) fail();
    live(signal);
    try {
      await this.authority.assertInputCurrent(this.pins, signal);
      live(signal);
      const output = this.guide.slice(offset, offset + limit).map((g) => {
        const offeringPk = id(g.offeringPk), h = this.references.get(offeringPk);
        if (!h || !Array.isArray(g.historical_keys)) fail();
        const seen = new Set<string>();
        const pastV25 = g.historical_keys.map((raw) => {
          const history = object(raw),
            academicYear = year(history.academicYear),
            pk = id(history.offeringPk);
          const k = key(academicYear, pk), source = this.v25.get(k) ?? null;
          if (
            seen.has(k) || typeof history.v25_present !== "boolean" ||
            history.v25_present !== (source !== null)
          ) fail();
          seen.add(k);
          return Object.freeze({ academicYear, offeringPk: pk, source });
        });
        return Object.freeze({
          academicYear: 2027 as const,
          offeringPk,
          guideLineage: g,
          pastV25: Object.freeze(pastV25),
          historicalReferences: h,
          unqualifiedChangeReferences: this.changes.get(offeringPk) ?? Object.freeze([]),
          pendingCutContextReferences: this.contexts.get(offeringPk) ?? Object.freeze([]),
        });
      });
      await this.authority.assertInputCurrent(this.pins, signal);
      live(signal);
      return Object.freeze({
        status: "HOLD_UNPUBLISHED" as const,
        sourcePins: this.pins,
        rows: Object.freeze(output),
        nextOffset: offset + output.length < this.guide.length ? offset + output.length : null,
      });
    } finally {
      try {
        await this.authority.awaitQuiescence(signal);
      } catch {
        await new Promise<never>(() => {});
      }
    }
  }
  /** Existing P1 validator is reused only after an independently issued publication is supplied.
   * It verifies the complete part set, not permission to publish or change an operating head. */
  async validateIssuedParts(
    publication: SnapshotPublication,
    bodies: readonly Uint8Array[],
    limits: Readonly<
      {
        maxParts: number;
        maxRows: number;
        maxDecodedBytes: number;
        maxPartBytes: number;
        maxDepth: number;
      }
    >,
    signal: AbortSignal,
  ): Promise<
    Readonly<{
      status: "HOLD_UNPUBLISHED";
      partsChecked: number;
      rowsChecked: number;
    }>
  > {
    live(signal);
    try {
      await this.authority.assertInputCurrent(this.pins, signal);
      await this.authority.assertPublicationCurrent(this.pins, publication, signal);
      live(signal);
      const before = nativeJsonText({
        previous: this.pins.previousHeadSha256,
        source: publication.sourceHeadSha256,
        scope: publication.scopeSha256,
        publication: publication.publicationSha256,
      }, true);
      const result = await validateP1PreparedPartsGlobal(publication, bodies, limits);
      live(signal);
      await this.authority.assertPublicationCurrent(this.pins, publication, signal);
      await this.authority.assertInputCurrent(this.pins, signal);
      live(signal);
      if (
        before !==
          nativeJsonText({
            previous: this.pins.previousHeadSha256,
            source: publication.sourceHeadSha256,
            scope: publication.scopeSha256,
            publication: publication.publicationSha256,
          }, true)
      ) fail();
      return Object.freeze(result);
    } finally {
      try {
        await this.authority.awaitQuiescence(signal);
      } catch {
        await new Promise<never>(() => {});
      }
    }
  }
}
