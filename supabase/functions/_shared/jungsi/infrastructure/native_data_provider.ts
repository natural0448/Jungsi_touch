/** Decode only explicitly selected immutable raw sources into application-owned ports. */
import { AccessError } from "../application/access.ts";
import type { CatalogDataPort, CatalogRelease } from "../application/catalog.ts";
import type { ForecastInputPort } from "../application/forecast_ports.ts";
import type { RequestClockPort } from "../application/ports.ts";
import { CONVERSION_CONTEXT_FIELDS, publicVersion } from "../application/university_scoring.ts";
import type { OverallDataPort, TotalModelBinding } from "../application/overall_analysis.ts";
import {
  NativeOfferingAnalysisRelease,
  type OfferingAnalysisDataPort,
  type YearBridge,
} from "../application/offering_analysis.ts";
import type {
  UniversityConversionRelease,
  UniversityScoringDataPort,
} from "../application/university_scoring.ts";
import type {
  UniversityPercentileDataPort,
  UniversityPercentileRelease,
} from "../application/university_percentile.ts";
import { NativeExamPack } from "../domain/exam_pack.ts";
import { NativeExamTotalModel } from "../domain/total_model.ts";
import { NativeAllExamineesTotalModel } from "../domain/all_examinees_total_model.ts";
import { conversionBindingKey, NativeConversionRelease } from "../domain/conversion_release.ts";
import { NativeUniversityScoreDistribution } from "../domain/university_distribution.ts";
import {
  EQUATING_AREAS,
  NativeBridgePolicy,
  NativeRankDistribution,
  type RankBundle,
} from "../domain/year_equating.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { JsonFloat, type NativeJson } from "../domain/native_json.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { type NativeRuntimeKind, NativeSourceSelection } from "./native_source_selection.ts";
import { decodeSchoolReferencePayload } from "./school_reference_source.ts";
import type { SchoolReferenceFunction } from "../application/school_reference_scoring.ts";
import type {
  AuthorizedSavedTailBytesPort,
  AuthorizedSavedTailPin,
} from "./saved_reference_tail_source.ts";
function fail(code: string, http = 503): never {
  throw new AccessError(code, http);
}
function object(value: unknown): NativeObject {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    value instanceof JsonFloat
  ) fail("analysis_release_invalid");
  return value as NativeObject;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    fail("analysis_release_invalid");
  }
  return value;
}
function year(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1000 || value > 9999) {
    fail("analysis_release_invalid");
  }
  return value;
}
function rows(value: unknown): NativeObject[] {
  if (!Array.isArray(value)) fail("analysis_release_invalid");
  return value.map(object);
}
function freeze<T extends NativeJson>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) value.forEach(freeze);
    else if (!(value instanceof JsonFloat)) Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function yearMap<T>(value: unknown, decode: (raw: NativeJson) => T): ReadonlyMap<number, T> {
  return new Map(
    Object.entries(object(value)).map(([key, raw]) => {
      if (!/^[1-9][0-9]{3}$/.test(key)) fail("analysis_release_invalid");
      return [year(Number(key)), decode(raw)];
    }),
  );
}
function ranks(value: unknown): RankBundle {
  const raw = object(value);
  if (Object.keys(raw).sort().join(",") !== [...EQUATING_AREAS].sort().join(",")) {
    fail("analysis_release_invalid");
  }
  return Object.fromEntries(
    EQUATING_AREAS.map((area) => [area, new NativeRankDistribution(raw[area])]),
  ) as unknown as RankBundle;
}
/** Server-owned current approval; implementations must re-read the active head, not a warm cache. */
export interface NativeSelectionHeadPort {
  current(signal?: AbortSignal): Promise<{
    readonly status: string;
    readonly registrySha256: string;
    readonly selectionSha256: string;
    readonly approvalReferenceSha256: string;
    readonly expiresAtUtc: bigint;
  }>;
}
export interface NativeSelectionFreshness {
  readonly heads: NativeSelectionHeadPort;
  readonly clock: RequestClockPort;
  readonly approvalReferenceSha256: string;
  readonly expiresAtUtc: bigint;
}
export class NativeDataProvider
  implements
    OverallDataPort,
    CatalogDataPort,
    UniversityScoringDataPort,
    UniversityPercentileDataPort,
    OfferingAnalysisDataPort {
  private readonly cache: Map<string, unknown>;
  private readonly freshness?: NativeSelectionFreshness;
  private referenceKeys?: ReadonlyMap<string, string | null>;
  private scoringBatchActive = false;
  private scoringBatchReady = false;
  private scoringBatchSignal?: AbortSignal;
  constructor(
    private readonly selection: NativeSourceSelection,
    freshness?: NativeSelectionFreshness,
    sharedDecoded?: Map<string, unknown>,
  ) {
    if (!(selection instanceof NativeSourceSelection)) fail("storage_configuration_invalid");
    if (sharedDecoded !== undefined && !(sharedDecoded instanceof Map)) {
      fail("storage_configuration_invalid");
    }
    // Decoded releases are frozen and keyed by registry/selection hash, so an isolate may share them.
    this.cache = sharedDecoded ?? new Map();
    if (freshness !== undefined) {
      if (
        !freshness || typeof freshness.heads?.current !== "function" ||
        typeof freshness.clock?.nowUtc !== "function" ||
        !/^[0-9a-f]{64}$/.test(freshness.approvalReferenceSha256) ||
        typeof freshness.expiresAtUtc !== "bigint"
      ) fail("storage_configuration_invalid");
      this.freshness = Object.freeze({ ...freshness });
    }
  }
  async assertCurrentSelection(required = false, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) fail("artifact_not_approved");
    const f = this.freshness;
    // Existing offline decoders remain usable; serving a selected release requires preflight below.
    if (f === undefined) {
      if (required) fail("artifact_not_approved");
      return;
    }
    try {
      const head = await f.heads.current(signal), now = f.clock.nowUtc();
      if (signal?.aborted) fail("artifact_not_approved");
      if (
        signal?.aborted || !head || head.status !== "approved" || typeof now !== "bigint" ||
        head.registrySha256 !== this.selection.registryHash ||
        head.selectionSha256 !== this.selection.selectionHash ||
        head.approvalReferenceSha256 !== f.approvalReferenceSha256 ||
        head.expiresAtUtc !== f.expiresAtUtc || now >= f.expiresAtUtc
      ) {
        fail("artifact_version_mismatch");
      }
    } catch (e) {
      if (e instanceof AccessError) throw e;
      fail("artifact_not_approved");
    }
  }
  private async assertDecodeSelection(signal?: AbortSignal): Promise<void> {
    signal ??= this.scoringBatchSignal;
    if (signal?.aborted) fail("artifact_not_approved");
    if (!this.scoringBatchActive) {
      await this.assertCurrentSelection(false, signal);
      return;
    }
    if (!this.scoringBatchReady) fail("analysis_release_invalid");
    const f = this.freshness;
    if (f) {
      const now = f.clock.nowUtc();
      if (typeof now !== "bigint" || now >= f.expiresAtUtc) fail("artifact_version_mismatch");
    }
  }
  /** One request's bounded calculation phase only. Final freshness precedes report writes. */
  async withScoringBatch<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.scoringBatchActive) fail("analysis_release_invalid");
    this.scoringBatchActive = true;
    this.scoringBatchSignal = signal;
    try {
      await this.assertCurrentSelection(false, signal);
      this.scoringBatchReady = true;
      const value = await work();
      this.scoringBatchReady = false;
      await this.assertCurrentSelection(false, signal);
      return value;
    } finally {
      this.scoringBatchReady = false;
      this.scoringBatchActive = false;
      this.scoringBatchSignal = undefined;
    }
  }
  load(kind: NativeRuntimeKind, key: string): NativeObject | null {
    return this.selection.load(kind, key)?.payload ?? null;
  }
  /** Server-only selected metadata. This does not grant user/report access. */
  async referenceSelection(signal: AbortSignal): Promise<
    Readonly<{
      registrySha256: string;
      selectionSha256: string;
      approvalReferenceSha256: string;
      tails: readonly { key: string; entry: NativeObject }[];
      compatibilities: readonly { key: string; entry: NativeObject }[];
    }>
  > {
    if (!signal || signal.aborted || !this.freshness) fail("artifact_not_approved");
    await this.assertCurrentSelection(true, signal);
    const tails = this.selection.referenceTailEntries(),
      compatibilities = this.selection.referenceCompatibilityMetadata();
    await this.assertCurrentSelection(true, signal);
    return Object.freeze({
      registrySha256: this.selection.registryHash,
      selectionSha256: this.selection.selectionHash,
      approvalReferenceSha256: this.freshness.approvalReferenceSha256,
      tails: Object.freeze(tails),
      compatibilities: Object.freeze(compatibilities),
    });
  }
  /** Exact selected exam-pack pin, after the normal approved payload was loaded and verified.
   * The source compatibility issuer compares bytes, not only a version string. */
  async referenceExamPin(
    examId: string,
    signal: AbortSignal,
  ): Promise<Readonly<{ key: string; sha256: string; version: string }> | null> {
    if (!signal || signal.aborted || typeof examId !== "string" || !examId.trim()) {
      fail("artifact_not_approved");
    }
    await this.assertCurrentSelection(true, signal);
    const selected = this.selection.reference("exam_pack", examId);
    if (!selected) {
      await this.assertCurrentSelection(true, signal);
      return null;
    }
    const loaded = this.selection.load("exam_pack", examId);
    if (
      !loaded || selected.kind !== "exam_pack" || selected.key !== examId ||
      typeof selected.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(selected.sha256) ||
      typeof selected.version !== "string" || !selected.version ||
      loaded.entry.sha256 !== selected.sha256 || loaded.entry.version !== selected.version ||
      selected.status !== "approved" || selected.engine_approved !== true ||
      selected.production_allowed !== true
    ) fail("artifact_not_approved");
    await this.assertCurrentSelection(true, signal);
    return Object.freeze({ key: examId, sha256: selected.sha256, version: selected.version });
  }
  async loadReferenceTail(
    key: string,
    signal: AbortSignal,
  ): Promise<{ entry: NativeObject; bytes: Uint8Array } | null> {
    if (!signal || signal.aborted) fail("artifact_not_approved");
    await this.assertCurrentSelection(true, signal);
    const value = await this.selection.loadReferenceTail(key, signal);
    await this.assertCurrentSelection(true, signal);
    return value;
  }
  async loadReferenceCompatibility(
    key: string,
    signal: AbortSignal,
  ): Promise<{ entry: NativeObject; payload: NativeObject } | null> {
    if (!signal || signal.aborted) fail("artifact_not_approved");
    await this.assertCurrentSelection(true, signal);
    const value = await this.selection.loadReferenceCompatibility(key, signal);
    await this.assertCurrentSelection(true, signal);
    return value;
  }
  /** True only when a production conversion release is selected for this offering (no body load). */
  hasProductionConversion(offeringId: string): Promise<boolean> {
    return Promise.resolve(this.selection.has("conversion", offeringId));
  }
  private async decode<T>(
    kind: NativeRuntimeKind,
    key: string,
    code: string,
    build: (raw: NativeObject, entry: NativeObject) => T,
    signal?: AbortSignal,
  ): Promise<T | null> {
    await this.assertDecodeSelection(signal);
    const identity = JSON.stringify([
      this.selection.registryHash,
      this.selection.selectionHash,
      kind,
      key,
    ]);
    if (this.cache.has(identity)) {
      const cached = this.cache.get(identity) as T;
      await this.assertDecodeSelection(signal);
      return cached;
    }
    const selected = this.selection.load(kind, key);
    if (selected === null) {
      await this.assertDecodeSelection(signal);
      return null;
    }
    try {
      const result = build(selected.payload, selected.entry);
      await this.assertDecodeSelection(signal);
      this.cache.set(identity, result);
      return result;
    } catch (error) {
      if (error instanceof AccessError) throw error;
      fail(code);
    }
  }
  /** Decode the explicit payload scope; full readiness retains every selected release check. */
  async preflight(): Promise<NativeObject> {
    return await this.withScoringBatch(() => this.preflightSelected());
  }
  private async preflightSelected(): Promise<NativeObject> {
    try {
      await this.assertCurrentSelection(true);
      const identities = this.selection.identities();
      const overallOnly = this.selection.payloadMode === "overall_only";
      const universityOnly = this.selection.payloadMode === "university_only";
      if (
        overallOnly && identities.some(({ kind }) => !["exam_pack", "total_model"].includes(kind))
      ) fail("artifact_not_approved");
      const catalog = overallOnly ? null : await this.getCatalog();
      if (this.selection.payloadMode === "catalog_only") {
        if (identities.some(({ kind, key }) => kind !== "catalog" || key !== "service")) {
          fail("artifact_not_approved");
        }
        await this.assertCurrentSelection(true);
        return Object.freeze({
          format: "jungsi.native-provider-preflight/v1",
          status: "verified_catalog_payload",
          registry_sha256: this.selection.registryHash,
          selection_sha256: this.selection.selectionHash,
          approval_reference_sha256: this.freshness!.approvalReferenceSha256,
          artifacts: identities.length,
          verification_scope: "catalog_payload_and_all_selected_reference_metadata",
          source_selection: this.selection.privateReceipt(),
          optional_missing: catalog
            ? []
            : [{ kind: "catalog", key: "service", reason_code: "catalog_not_selected" }],
          production_ready: false,
          native_acceptance: "NOT_VERIFIED_BY_SOURCE_PREFLIGHT",
        });
      }
      const offerings = catalog?.offerings ?? [];
      // Build once for the selected catalog. Null preserves ambiguity instead of deduplicating it.
      const offeringIndex = new Map<string, NativeObject | null>();
      const offeringIdIndex = new Map<string, NativeObject | null>();
      for (const offering of offerings) {
        const id = text(offering.offering_id);
        const key = conversionBindingKey(year(offering.academic_year), id);
        offeringIndex.set(key, offeringIndex.has(key) ? null : offering);
        offeringIdIndex.set(id, offeringIdIndex.has(id) ? null : offering);
      }
      // Every reference metadata row is checked, without loading unrequested rule bodies.
      const referencePacks = new Map<string, { year: number; version: string; type: unknown }>();
      if (!overallOnly) {
        for (const { entry } of this.selection.referenceMetadata()) {
          const c = object(entry.reference_context), examId = text(c.exam_id);
          let pack = referencePacks.get(examId);
          if (!pack) {
            const source = this.selection.load("exam_pack", examId);
            if (!source) fail("reference_exam_context_mismatch");
            const decoded = new NativeExamPack(source.payload);
            pack = {
              year: decoded.academicYear,
              version: decoded.packVersion,
              type: object(source.payload.exam).exam_type,
            };
            referencePacks.set(examId, pack);
          }
          if (
            pack.year !== c.academic_year || pack.version !== c.source_pack_version ||
            pack.type !== c.exam_type
          ) {
            fail("reference_exam_context_mismatch");
          }
          if (
            !Array.isArray(c.offering_ids) ||
            c.offering_ids.some((pk) =>
              !offeringIndex.get(conversionBindingKey(c.academic_year, pk))
            )
          ) fail("reference_offering_context_mismatch");
        }
      }
      const missing: NativeObject[] = [];
      const packFor = (
        raw: NativeObject,
        compatibility: unknown = raw.mock_compatibility,
      ): void => {
        year(raw.academic_year);
        text(raw.exam_id);
        text(raw.source_pack_version);
        // A university release keeps its CSAT definition. Mock inputs need a separate approval.
        if (raw.exam_type !== "csat") fail("artifact_exam_mismatch");
        const source = this.selection.load("exam_pack", text(raw.exam_id));
        if (source !== null) {
          const pack = new NativeExamPack(source.payload), exam = object(source.payload.exam);
          if (
            pack.examId !== raw.exam_id || pack.packVersion !== raw.source_pack_version ||
            pack.academicYear !== raw.academic_year || exam.exam_type !== raw.exam_type
          ) fail("artifact_exam_mismatch");
        }
        if (compatibility != null && object(compatibility).status === "approved") {
          const c = object(compatibility);
          text(c.source_pack_version);
          if (
            !publicVersion(c.version) || c.rule_exam_id !== raw.exam_id ||
            c.rule_pack_version !== raw.source_pack_version ||
            !["september_mock", "june_mock"].includes(c.source_exam_type as string)
          ) fail("artifact_exam_mismatch");
          const mockSource = this.selection.load("exam_pack", text(c.source_exam_id));
          if (mockSource !== null) {
            const mock = new NativeExamPack(mockSource.payload),
              exam = object(mockSource.payload.exam);
            if (
              mock.examId !== c.source_exam_id || mock.packVersion !== c.source_pack_version ||
              mock.academicYear !== raw.academic_year || exam.exam_type !== c.source_exam_type
            ) fail("artifact_exam_mismatch");
          } else {
            missing.push({
              kind: "exam_pack",
              key: c.source_exam_id,
              reason_code: "mock_compatibility_source_missing",
            });
          }
        } else if (source === null) {
          // No declared target pack is fabricated and no unapproved cross-exam use is inferred.
          missing.push({
            kind: "mock_compatibility",
            key: raw.exam_id,
            reason_code: "mock_compatibility_not_approved",
          });
        }
      };
      const bindingsFor = (raw: NativeObject, key: string, singleYear = true): NativeObject[] => {
        if (raw.status !== "approved") fail("artifact_not_approved");
        const bindings = rows(raw.bindings), seen = new Set<string>();
        if (!bindings.length) fail("analysis_release_invalid");
        let selected = false;
        for (const b of bindings) {
          const composite = conversionBindingKey(year(b.academic_year), b.offering_pk);
          const id = String(b.offering_pk);
          if (seen.has(composite)) fail("analysis_release_invalid");
          seen.add(composite);
          const matching = offeringIndex.get(composite);
          if (
            !matching || singleYear && b.academic_year !== raw.academic_year ||
            !CONVERSION_CONTEXT_FIELDS.every((field) =>
              Object.hasOwn(b, field) && b[field] === matching[field]
            )
          ) {
            fail("analysis_release_invalid");
          }
          if (id === key) selected = true;
        }
        if (!selected) fail("analysis_release_invalid");
        return bindings;
      };
      for (const { kind, key } of identities) {
        const selected = this.selection.load(kind, key)!;
        const raw = selected.payload;
        if (Object.hasOwn(raw, "version") && raw.version !== selected.entry.version) {
          fail("artifact_version_mismatch");
        }
        switch (kind) {
          case "catalog":
            if (key !== "service" || catalog === null || catalog.status !== "approved") {
              fail("artifact_not_approved");
            }
            break;
          case "exam_pack":
            if (universityOnly) {
              // Scoped preflight retains fresh-head checks around all pinned body decoders.
              const pack = new NativeExamPack(raw);
              if (pack.examId !== key) fail("artifact_exam_mismatch");
            } else await this.getExamPack(key);
            break;
          case "total_model": {
            const examId = text(raw.exam_id), packVersion = text(raw.pack_version);
            if (key !== examId + ":" + packVersion) fail("artifact_version_mismatch");
            const pack = await this.getExamPack(examId),
              model = await this.getTotalModel(examId, packVersion);
            if (
              !pack || !model || pack.packVersion !== packVersion ||
              model.model.metadata.academic_year !== pack.academicYear ||
              model.model.metadata.status !== "approved"
            ) {
              fail("artifact_not_approved");
            }
            break;
          }
          case "conversion": {
            packFor(raw);
            const bundle = await this.getConversion(key), bindings = bindingsFor(raw, key);
            if (!bundle) fail("analysis_release_invalid");
            for (const ruleRaw of rows(raw.rules)) {
              const rule = bundle.release.rule(text(ruleRaw.rule_version));
              if (
                !rule || rule.data.academic_year !== raw.academic_year ||
                rule.data.review_status !== "calculation_verified" ||
                rule.data.data_kind !== "official_rule"
              ) fail("artifact_not_approved");
              for (
                const component of [
                  rule.data,
                  ...Object.values(object(rule.data.tables)).map(object),
                ]
              ) {
                for (
                  const [field, expected] of [["exam_id", raw.exam_id], [
                    "source_pack_version",
                    raw.source_pack_version,
                  ], ["rule_version", rule.data.rule_version]] as const
                ) {
                  if (Object.hasOwn(component, field) && component[field] !== expected) {
                    fail("artifact_exam_mismatch");
                  }
                }
                if (
                  component !== rule.data &&
                  (component.status !== "verified" || !publicVersion(component.version))
                ) {
                  fail("artifact_not_approved");
                }
              }
            }
            for (const b of bindings) {
              if (
                bundle.release.binding(year(b.academic_year), b.offering_pk as string) !==
                  b.rule_version
              ) fail("analysis_release_invalid");
            }
            break;
          }
          case "reference_conversion": {
            const reference = await this.referenceGroup(key);
            if (!reference) fail("reference_conversion_missing");
            const packSource = this.selection.load("exam_pack", reference.examId);
            if (!packSource) fail("reference_exam_context_mismatch");
            const pack = new NativeExamPack(packSource.payload),
              exam = object(packSource.payload.exam);
            if (
              pack.packVersion !== reference.packVersion ||
              pack.academicYear !== reference.academicYear ||
              exam.exam_type !== reference.examType
            ) fail("reference_exam_context_mismatch");
            for (const b of reference.bindings) {
              const matching = offeringIndex.get(
                conversionBindingKey(reference.academicYear, b.offering_pk),
              );
              if (
                !matching ||
                !CONVERSION_CONTEXT_FIELDS.every((field) => b[field] === matching[field])
              ) {
                fail("reference_offering_context_mismatch");
              }
            }
            break;
          }
          case "percentile": {
            const conversion = await this.getConversion(key);
            packFor(raw, conversion?.mockCompatibility ?? null);
            const bundle = await this.getPercentile(key), bindings = bindingsFor(raw, key);
            if (
              !bundle || bundle.curve.metadata.status !== "approved" ||
              bundle.curve.metadata.academic_year !== raw.academic_year ||
              bundle.curve.metadata.exam_id !== raw.exam_id ||
              bundle.curve.metadata.rule_version !== raw.rule_version
            ) fail("artifact_not_approved");
            for (const b of bindings) {
              if (
                b.rule_version !== raw.rule_version ||
                b.curve_version !== bundle.curve.metadata.curve_version
              ) fail("analysis_release_invalid");
            }
            if (
              conversion &&
              (conversion.status !== "approved" ||
                conversion.academicYear !== bundle.academicYear ||
                conversion.examId !== bundle.examId ||
                conversion.sourcePackVersion !== bundle.sourcePackVersion ||
                conversion.examType !== bundle.examType ||
                conversion.release.binding(bundle.academicYear, key) !== bundle.ruleVersion)
            ) fail("artifact_version_mismatch");
            break;
          }
          case "analysis": {
            const release = await this.getAnalysis(key);
            if (!release || release.status !== "approved") fail("artifact_not_approved");
            for (const b of bindingsFor(raw, key, false)) {
              const rule = release.release.rule(text(b.rule_version));
              if (
                !rule || rule.data.academic_year !== b.academic_year ||
                rule.data.review_status !== "calculation_verified" ||
                rule.data.data_kind !== "official_rule"
              ) fail("artifact_not_approved");
            }
            break;
          }
          case "forecast_context": {
            const context = object(raw.context), matching = offeringIdIndex.get(key);
            if (
              !catalog || !matching || context.offering_id !== key ||
              context.catalog_version !== catalog.version ||
              offeringIndex.get(conversionBindingKey(year(context.academic_year), key)) !==
                matching ||
              !CONVERSION_CONTEXT_FIELDS.every((field) => context[field] === matching[field])
            ) fail("forecast_base_version_conflict", 409);
            // Optional unissued curves/judgment inputs stay pending. Declared dependencies must match.
            const conversion = await this.getConversion(key),
              percentile = await this.getPercentile(key);
            if (
              conversion && (context.exam_id !== conversion.examId ||
                context.source_pack_version !== conversion.sourcePackVersion ||
                conversion.release.binding(year(matching.academic_year), key) !==
                  context.rule_version)
            ) fail("forecast_base_version_conflict", 409);
            if (percentile) {
              for (
                const field of [
                  "rule_id",
                  "rule_version",
                  "curve_version",
                  "population_id",
                  "score_scope",
                  "score_scale_id",
                  "bonus_treatment",
                ]
              ) {
                if (context[field] !== percentile.curve.metadata[field]) {
                  fail("forecast_base_version_conflict", 409);
                }
              }
            }
            break;
          }
          case "forecast_inputs":
            if (key !== text(raw.input_id) + ":" + text(raw.version)) {
              fail("forecast_input_binding_mismatch");
            }
            object(raw.context);
            break;
          case "forecast_policy":
            if (key !== text(raw.policy_id) + ":" + text(raw.version)) {
              fail("forecast_policy_binding_mismatch");
            }
            object(raw.context);
            break;
          case "estimate_receipt":
            // Full population receipt semantics are checked by the percentile service, not renamed here.
            if (typeof raw.version !== "string") fail("percentile_population_receipt_missing");
            break;
        }
      }
      await this.assertCurrentSelection(true);
      for (const { kind, key } of identities) {
        if (kind === "exam_pack") {
          const pack = this.selection.load(kind, key)!.payload;
          const modelKey = key + ":" + text(pack.pack_version);
          if (universityOnly && this.selection.reference("total_model", modelKey)) continue;
          if (!this.selection.load("total_model", modelKey)) {
            missing.push({
              kind: "total_model",
              key: modelKey,
              reason_code: "total_model_missing",
            });
          }
        }
      }
      for (const offering of offerings) {
        const id = text(offering.offering_id);
        if (!this.selection.load("percentile", id)) {
          missing.push({ kind: "percentile", key: id, reason_code: "percentile_release_missing" });
        }
        if (!this.selection.load("analysis", id)) {
          missing.push({ kind: "analysis", key: id, reason_code: "analysis_release_missing" });
        }
      }
      return Object.freeze({
        format: "jungsi.native-provider-preflight/v1",
        status: overallOnly
          ? "verified_overall_payloads"
          : universityOnly
          ? "verified_university_payloads"
          : "verified_selected_release_graph",
        registry_sha256: this.selection.registryHash,
        selection_sha256: this.selection.selectionHash,
        approval_reference_sha256: this.freshness!.approvalReferenceSha256,
        artifacts: identities.length,
        verification_scope: overallOnly
          ? "exam_model_payloads_and_all_selected_reference_metadata"
          : universityOnly
          ? "university_payloads_and_all_selected_reference_metadata"
          : "selected_native_envelopes_and_release_bindings",
        ...(overallOnly || universityOnly
          ? { source_selection: this.selection.privateReceipt() }
          : {}),
        optional_missing: missing,
        production_ready: false,
        native_acceptance: "NOT_VERIFIED_BY_SOURCE_PREFLIGHT",
      });
    } catch (error) {
      if (error instanceof AccessError) throw error;
      fail("analysis_release_invalid");
    }
  }
  getExamPack(examId: string, signal?: AbortSignal): Promise<NativeExamPack | null> {
    return new Promise((resolve) =>
      resolve(this.decode("exam_pack", examId, "artifact_exam_mismatch", (raw) => {
        const pack = new NativeExamPack(raw);
        if (pack.examId !== examId) fail("artifact_exam_mismatch");
        return pack;
      }, signal))
    );
  }
  getTotalModel(examId: string, packVersion: string): Promise<TotalModelBinding | null> {
    return new Promise((resolve) =>
      resolve(this.decode(
        "total_model",
        examId + ":" + packVersion,
        "model_unverified",
        (raw, entry) => {
          const model = raw.format === "jungsi.exam-total-model/v2"
            ? new NativeAllExamineesTotalModel(raw)
            : raw.format === "jungsi.exam-total-model/v1"
            ? new NativeExamTotalModel(raw)
            : fail("model_unverified");
          if (
            model.examId !== examId || model.packVersion !== packVersion ||
            entry.distribution_id !== model.distributionId
          ) fail("artifact_version_mismatch");
          return Object.freeze({ model, distributionId: model.distributionId });
        },
      ))
    );
  }
  getCatalog(): Promise<CatalogRelease | null> {
    return new Promise((resolve) =>
      resolve(this.decode("catalog", "service", "catalog_release_invalid", (raw, entry) => {
        if (raw.format !== "jungsi.catalog-release/v1" || raw.status !== "approved") {
          fail("catalog_release_invalid");
        }
        const zone = entry.source_timezone;
        if (zone != null && typeof zone !== "string") fail("artifact_time_invalid");
        const instant = (value: unknown) =>
          utcInstant(text(value), typeof zone === "string" ? zone : undefined);
        const offerings = rows(raw.offerings);
        for (const row of offerings) {
          if (row.recruitment == null) continue;
          const recruitment = object(row.recruitment);
          if (recruitment.deadline_at != null) {
            recruitment.deadline_at = utcText(instant(recruitment.deadline_at));
          }
          if (Object.hasOwn(recruitment, "changes")) {
            for (const change of rows(recruitment.changes)) {
              if (change.announced_at != null) {
                change.announced_at = utcText(instant(change.announced_at));
              }
            }
          }
        }
        return Object.freeze({
          version: text(raw.version),
          status: "approved",
          asOfUtc: instant(raw.as_of),
          offerings: freeze(offerings),
          history: freeze(rows(Object.hasOwn(raw, "history") ? raw.history : [])),
        });
      }))
    );
  }
  getConversion(offeringId: string): Promise<UniversityConversionRelease | null> {
    return new Promise((resolve) =>
      resolve(this.decode("conversion", offeringId, "conversion_release_invalid", (raw) => {
        if (raw.format !== "jungsi.university-conversion-release/v1") {
          fail("conversion_release_invalid");
        }
        return Object.freeze({
          version: text(raw.version),
          status: text(raw.status),
          academicYear: year(raw.academic_year),
          examId: text(raw.exam_id),
          sourcePackVersion: text(raw.source_pack_version),
          examType: text(raw.exam_type),
          release: new NativeConversionRelease(raw.release_id, raw.rules, raw.bindings),
          bindings: freeze(rows(raw.bindings)),
          mockCompatibility: raw.mock_compatibility == null
            ? null
            : freeze(object(raw.mock_compatibility)),
        });
      }))
    );
  }
  private async referenceGroup(key: string, signal?: AbortSignal) {
    signal ??= this.scoringBatchSignal;
    await this.assertDecodeSelection(signal);
    // Same request-scoped decode cache as decode(): skip the per-call rule-body copy once decoded.
    const decodedId = JSON.stringify([
      this.selection.registryHash,
      this.selection.selectionHash,
      "reference_conversion",
      key,
    ]);
    if (this.cache.has(decodedId)) {
      const cached = this.cache.get(decodedId) as ReturnType<typeof decodeSchoolReferencePayload>;
      await this.assertDecodeSelection(signal);
      return cached;
    }
    const selected = await this.selection.loadReference(key, signal);
    if (!selected) {
      await this.assertDecodeSelection(signal);
      return null;
    }
    return this.decode(
      "reference_conversion",
      key,
      "reference_conversion_unavailable",
      (raw, entry) => {
        if (
          entry.kind !== "reference_conversion" || entry.status !== "approved_reference" ||
          entry.approval_scope !== "same_exam_mathematical_reference" ||
          entry.engine_approved !== false ||
          entry.production_allowed !== false
        ) fail("artifact_not_approved");
        const decoded = decodeSchoolReferencePayload(raw, {
          sourceSha256: text(entry.source_review_sha256),
          independentSha256: text(entry.independent_review_sha256),
        });
        const c = object(entry.reference_context);
        if (
          [
            ["academic_year", decoded.academicYear],
            ["exam_id", decoded.examId],
            ["source_pack_version", decoded.packVersion],
            ["exam_type", decoded.examType],
            ["score_scale_id", decoded.scoreScaleId],
            ["rule_version", decoded.rule.data.rule_version],
          ]
            .some(([k, v]) => c[k as string] !== v) ||
          !Array.isArray(c.offering_ids) ||
          c.offering_ids.length !== decoded.bindings.length ||
          decoded.bindings.some((b) => !(c.offering_ids as unknown[]).includes(b.offering_pk))
        ) fail("reference_rule_context_mismatch");
        return decoded;
      },
      signal,
    );
  }
  /** One current selected conversion artifact per admitted batch, never one physical load
   * per offering. Callers must independently prove current Guide/source/score-axis authority.
   * A key absent from this exact selected artifact or ambiguous across selected artifacts is pending. */
  async getReferenceBatchFromSelectedArtifact(
    artifactKey: string,
    offeringIds: readonly string[],
    signal: AbortSignal,
  ): Promise<
    readonly Readonly<{ offeringId: string; reference: SchoolReferenceFunction | null }>[]
  > {
    if (
      signal?.aborted || typeof artifactKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(artifactKey) ||
      !Array.isArray(offeringIds) || offeringIds.length < 1 || offeringIds.length > 64 ||
      offeringIds.some((id) => typeof id !== "string" || !/^2027:[1-9][0-9]{0,18}$/.test(id)) ||
      new Set(offeringIds).size !== offeringIds.length
    ) fail("reference_offering_context_mismatch");
    await this.assertCurrentSelection(false, signal);
    const index = new Map<string, string | null>();
    for (const { key, entry } of this.selection.referenceMetadata()) {
      const context = object(entry.reference_context);
      if (!Array.isArray(context.offering_ids)) fail("reference_rule_context_mismatch");
      for (const raw of context.offering_ids) {
        const id = text(raw);
        if (offeringIds.includes(id)) index.set(id, index.has(id) ? null : key);
      }
    }
    const selectedIds = offeringIds.filter((id) => index.get(id) === artifactKey);
    const group = selectedIds.length ? await this.referenceGroup(artifactKey, signal) : null;
    if (signal.aborted) fail("reference_tail_unavailable");
    const result = offeringIds.map((offeringId) => {
      if (index.get(offeringId) !== artifactKey || !group) {
        return Object.freeze({ offeringId, reference: null });
      }
      const bindings = group.bindings.filter((b) => b.offering_pk === offeringId);
      if (bindings.length !== 1) fail("reference_offering_context_mismatch");
      const reference: SchoolReferenceFunction = Object.freeze({ ...group, binding: bindings[0] });
      return Object.freeze({ offeringId, reference });
    });
    await this.assertCurrentSelection(false, signal);
    return Object.freeze(result);
  }
  async getReference(
    offeringId: string,
    signal?: AbortSignal,
  ): Promise<SchoolReferenceFunction | null> {
    signal ??= this.scoringBatchSignal;
    if (signal?.aborted) fail("reference_tail_unavailable");
    if (!this.referenceKeys) {
      const index = new Map<string, string | null>();
      for (const { key, entry } of this.selection.referenceMetadata()) {
        for (const value of object(entry.reference_context).offering_ids as unknown[]) {
          const pk = text(value);
          index.set(pk, index.has(pk) ? null : key);
        }
      }
      this.referenceKeys = index;
    }
    const key = this.referenceKeys.get(offeringId);
    if (key === null) fail("reference_offering_ambiguous");
    if (key === undefined) return null;
    const group = await this.referenceGroup(key, signal);
    if (signal?.aborted) fail("reference_tail_unavailable");
    if (!group) return null;
    const binding = group.bindings.find((b) => b.offering_pk === offeringId);
    if (!binding) fail("reference_offering_context_mismatch");
    return Object.freeze({ ...group, binding });
  }
  private referenceTailKeys?: ReadonlyMap<string, NativeObject | null>;
  private referenceTailIndex(): ReadonlyMap<string, NativeObject | null> {
    if (!this.referenceTailKeys) {
      const index = new Map<string, NativeObject | null>();
      for (const entry of this.selection.referenceTailMetadata()) {
        for (const value of object(entry.reference_context).offering_ids as unknown[]) {
          const id = text(value);
          index.set(id, index.has(id) ? null : Object.freeze(entry));
        }
      }
      this.referenceTailKeys = index;
    }
    return this.referenceTailKeys;
  }
  hasReferenceTail(offeringId: string): boolean {
    return !!this.referenceTailIndex().get(offeringId);
  }
  /** Exact selected saved-tail universe for one exam; empty when none is approved. */
  referenceTailOfferings(academicYear: number, examId: string): readonly string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.referenceTailIndex()) {
      if (entry === null) fail("reference_offering_ambiguous");
      const c = object(entry.reference_context);
      if (c.academic_year === academicYear && c.exam_id === examId) ids.push(id);
    }
    return Object.freeze(ids.sort());
  }
  /** Analysis-cache pin: changes whenever the approved saved-tail selection changes. */
  async referenceTailPins(): Promise<string | null> {
    const rows = this.selection.referenceTailMetadata();
    if (!rows.length) return null;
    return await nativeJsonSha256({
      registry: this.selection.registryHash,
      selection: this.selection.selectionHash,
      tails: rows.map((e) => [e.key, e.sha256]).sort(),
    } as NativeObject);
  }
  /**
   * Server authority for saved reference tails. Selection comes only from the approved
   * registry/selection/head chain of this request; every use rechecks the fresh head.
   */
  referenceTailAuthority(): AuthorizedSavedTailBytesPort & {
    /** Chunked index entries only (catalog tail_layout "chunked_index_v1"). */
    selectChunked(offeringId: string, signal: AbortSignal): Promise<AuthorizedSavedTailPin | null>;
    readChunk(
      parent: AuthorizedSavedTailPin,
      indexBytes: Uint8Array,
      key: string,
      bytes: number,
      signal: AbortSignal,
    ): Promise<Uint8Array>;
  } {
    const contextOf = (entry: NativeObject): NativeObject => {
      const c = { ...object(entry.reference_context) };
      delete c.offering_ids;
      return c;
    };
    const isChunked = (entry: NativeObject) => entry.tail_layout === "chunked_index_v1";
    const pinOf = async (
      offeringId: string,
      chunked: boolean,
      signal?: AbortSignal,
    ): Promise<AuthorizedSavedTailPin | null> => {
      if (signal?.aborted) fail("reference_tail_unavailable");
      const entry = this.referenceTailIndex().get(offeringId);
      if (entry === null) fail("reference_offering_ambiguous");
      if (entry === undefined || isChunked(entry) !== chunked) return null;
      const reference = await this.getReference(offeringId, signal);
      if (signal?.aborted) fail("reference_tail_unavailable");
      const context = contextOf(entry);
      if (!reference) return null;
      if (
        reference.binding.rule_version !== context.rule_version ||
        reference.academicYear !== context.academic_year ||
        reference.examId !== context.exam_id ||
        reference.packVersion !== context.source_pack_version ||
        reference.examType !== context.exam_type ||
        reference.scoreScaleId !== context.score_scale_id
      ) fail("reference_tail_context_mismatch");
      const binding: NativeObject = { offering_id: offeringId };
      for (const k of [...CONVERSION_CONTEXT_FIELDS, "rule_version"]) {
        binding[k] = (reference.binding[k] ?? null) as NativeJson;
      }
      return {
        key: text(entry.key),
        sha256: text(entry.sha256),
        bytes: Number(entry.bytes),
        maxBytes: Number(entry.bytes),
        releaseSha256: this.selection.registryHash,
        selectionSha256: this.selection.selectionHash,
        compatibilitySha256: this.selection.selectionHash,
        binding,
        context,
        evidence: cloneNativeJson(object(entry.reference_evidence)),
      };
    };
    return Object.freeze({
      select: (offeringId: string, signal?: AbortSignal) => pinOf(offeringId, false, signal),
      selectChunked: (offeringId: string, signal: AbortSignal) => pinOf(offeringId, true, signal),
      /** Only a piece listed (key and exact length) in the pinned index bytes is read. */
      readChunk: async (
        parent: AuthorizedSavedTailPin,
        indexBytes: Uint8Array,
        key: string,
        bytes: number,
        signal: AbortSignal,
      ) => {
        if (signal.aborted) fail("reference_tail_unavailable");
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(indexBytes))),
        ]
          .map((v) => v.toString(16).padStart(2, "0")).join("");
        if (digest !== parent.sha256 || indexBytes.length !== parent.bytes) {
          fail("reference_tail_pin_invalid");
        }
        const index = object(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(indexBytes)),
        );
        const listed = Array.isArray(index.chunks) &&
          index.chunks.some((c) =>
            c !== null && typeof c === "object" && (c as NativeObject).key === key &&
            (c as NativeObject).bytes === bytes
          );
        if (!listed) fail("reference_tail_pin_invalid");
        const chunk = await this.selection.referenceTailChunkBytes(parent.key, key, bytes, signal);
        if (signal.aborted) fail("reference_tail_unavailable");
        return chunk;
      },
      read: async (key: string, maximumBytes: number, signal: AbortSignal) => {
        const bytes = await this.selection.referenceTailBytes(key, signal);
        if (bytes.length > maximumBytes) fail("storage_artifact_too_large");
        return bytes;
      },
      assertCurrent: async (_pin: AuthorizedSavedTailPin, signal: AbortSignal) => {
        if (signal.aborted) fail("reference_tail_unavailable");
        await this.assertCurrentSelection(true, signal);
        if (signal.aborted) fail("reference_tail_unavailable");
      },
      assertCompatible: async (
        pin: AuthorizedSavedTailPin,
        identity: Readonly<NativeObject>,
        signal: AbortSignal,
      ) => {
        const c = pin.context;
        if (
          identity.offering_id !== pin.binding.offering_id ||
          [
            "academic_year",
            "exam_id",
            "exam_type",
            "source_pack_version",
            "rule_version",
            "score_scale_id",
          ].some((k) => identity[k] !== c[k])
        ) fail("reference_tail_context_mismatch");
        const pack = await this.getExamPack(text(c.exam_id), signal);
        if (signal.aborted) fail("reference_tail_unavailable");
        if (!pack || pack.examId !== c.exam_id || pack.packVersion !== c.source_pack_version) {
          fail("reference_exam_context_mismatch");
        }
      },
    });
  }
  getPercentile(offeringId: string): Promise<UniversityPercentileRelease | null> {
    return new Promise((resolve) =>
      resolve(this.decode("percentile", offeringId, "percentile_release_invalid", (raw) => {
        if (raw.format !== "jungsi.university-percentile-release/v1") {
          fail("percentile_release_invalid");
        }
        const population = raw.comparison_population == null
          ? null
          : object(raw.comparison_population);
        const receipt = population === null
          ? null
          : this.load("estimate_receipt", text(population.validation_receipt_version));
        if (population !== null && receipt === null) fail("percentile_population_receipt_missing");
        return Object.freeze({
          version: text(raw.version),
          status: text(raw.status),
          releaseId: text(raw.release_id),
          academicYear: year(raw.academic_year),
          examId: text(raw.exam_id),
          sourcePackVersion: text(raw.source_pack_version),
          examType: text(raw.exam_type),
          ruleVersion: text(raw.rule_version),
          curve: new NativeUniversityScoreDistribution(raw.curve),
          bindings: freeze(rows(raw.bindings)),
          comparisonPopulation: population === null ? null : freeze(population),
          validationReceipt: receipt === null ? null : freeze(receipt),
        });
      }))
    );
  }
  getAnalysis(offeringId: string): Promise<NativeOfferingAnalysisRelease | null> {
    return new Promise((resolve) =>
      resolve(this.decode("analysis", offeringId, "analysis_release_invalid", (raw) => {
        if (raw.format !== "jungsi.offering-analysis-release/v1") fail("analysis_release_invalid");
        return new NativeOfferingAnalysisRelease({
          version: text(raw.version),
          status: text(raw.status),
          sourcePackVersion: text(raw.source_pack_version),
          release: new NativeConversionRelease(raw.release_id, raw.rules, raw.bindings),
          offeringsByYear: object(raw.offerings_by_year),
          policy: new NativeBridgePolicy(raw.policy),
          bridges: yearMap(raw.bridges, (value): YearBridge => {
            const bridge = object(value);
            return {
              source: ranks(bridge.source),
              target: ranks(bridge.target),
              sourceTotal: new NativeRankDistribution(bridge.source_total),
              targetTotal: new NativeRankDistribution(bridge.target_total),
            };
          }),
          curves: yearMap(raw.curves, (value) => new NativeUniversityScoreDistribution(value)),
          decisions: yearMap(raw.decisions, object),
        });
      }))
    );
  }
}
/** Current forecast context requires the same selected catalog, rule binding and independent curve. */
export class NativeForecastInputs implements ForecastInputPort {
  constructor(private readonly data: NativeDataProvider) {
    if (!(data instanceof NativeDataProvider)) fail("forecast_input_not_configured");
  }
  private required(kind: NativeRuntimeKind, key: string): NativeObject {
    const raw = this.data.load(kind, key);
    if (raw === null) fail("forecast_input_missing");
    return raw;
  }
  async inputs(offeringId: string, inputId: string, version: string): Promise<NativeObject> {
    await this.data.assertCurrentSelection();
    const raw = this.required("forecast_inputs", inputId + ":" + version);
    if (
      raw.input_id !== inputId || raw.version !== version ||
      object(raw.context).offering_id !== offeringId
    ) fail("forecast_input_binding_mismatch");
    return raw;
  }
  async policy(policyId: string, version: string): Promise<NativeObject> {
    await this.data.assertCurrentSelection();
    const raw = this.required("forecast_policy", policyId + ":" + version);
    if (raw.policy_id !== policyId || raw.version !== version) {
      fail("forecast_policy_binding_mismatch");
    }
    return raw;
  }
  async currentContext(offeringId: string): Promise<NativeObject> {
    await this.data.assertCurrentSelection();
    const context = object(this.required("forecast_context", offeringId).context),
      catalog = await this.data.getCatalog();
    if (catalog === null || catalog.status !== "approved") fail("forecast_catalog_unavailable");
    const rows = catalog.offerings.filter((row) => row.offering_id === offeringId);
    if (rows.length !== 1) fail("forecast_offering_mismatch", 409);
    const offering = rows[0];
    for (
      const field of ["academic_year", "university_id", "campus", "department", "track", "group"]
    ) {
      if (context[field] !== offering[field]) fail("forecast_base_version_conflict", 409);
    }
    const [conversion, percentile] = await Promise.all([
      this.data.getConversion(offeringId),
      this.data.getPercentile(offeringId),
    ]);
    if (
      conversion === null || conversion.status !== "approved" || percentile === null ||
      percentile.status !== "approved"
    ) fail("forecast_execution_sources_pending");
    const metadata = percentile.curve.metadata;
    if (
      context.catalog_version !== catalog.version || context.exam_id !== conversion.examId ||
      context.source_pack_version !== conversion.sourcePackVersion ||
      context.rule_version !== percentile.ruleVersion ||
      context.curve_version !== metadata.curve_version ||
      conversion.release.binding(year(offering.academic_year), offeringId) !== context.rule_version
    ) {
      fail("forecast_base_version_conflict", 409);
    }
    for (
      const field of [
        "population_id",
        "rule_id",
        "score_scope",
        "score_scale_id",
        "bonus_treatment",
      ]
    ) {
      if (context[field] !== metadata[field]) fail("forecast_base_version_conflict", 409);
    }
    await this.data.assertCurrentSelection();
    return cloneNativeJson(context);
  }
}
