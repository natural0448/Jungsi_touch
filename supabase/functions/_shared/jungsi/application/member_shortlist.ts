/** Member/year selections are independent of score profiles and report revisions. */
import { AccessError } from "./access.ts";
import type { ApiExecution } from "./api_dispatch.ts";
import type { RequestClockPort } from "./ports.ts";
import { requirePaidSession, type SessionSnapshot } from "./session_service.ts";
import { MemberJsonResults } from "./member_json_results.ts";
import { resultObject } from "./paid_result_components.ts";
import { cloneNativeJson, nativeJsonSha256, type NativeObject } from "../domain/json_value.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import type { StoredReport } from "./platform_repository.ts";
import { reportDto } from "./profile_reports.ts";

export interface MemberSelection {
  readonly offering_id: string;
  readonly selected: boolean;
  readonly changed_at: string;
}
export interface LegacyShortlistSource {
  readonly report_id: string;
  readonly report_revision: number;
  readonly updated_at: string;
  readonly items: readonly MemberSelection[];
}
export interface MemberShortlistDocument {
  readonly format: "jungsi.member-shortlist-storage/v1";
  readonly owner: string;
  readonly year: number;
  readonly revision: number;
  readonly previous_sha256: string | null;
  readonly updated_at: string;
  readonly items: readonly MemberSelection[];
}
export interface PublishedMemberShortlist {
  readonly document: MemberShortlistDocument;
  readonly sha256: string;
}
export interface MemberShortlistReplyProof {
  readonly assessment: {
    readonly report_id: string;
    readonly report_revision: number;
    readonly source: "selected_report" | "current_profile";
  } | null;
  readonly responseSha: string;
}
export interface MemberShortlistReplay extends MemberShortlistReplyProof {
  readonly year: number;
  readonly saved: PublishedMemberShortlist | null;
  readonly legacy: { readonly report_id: string; readonly report_revision: number } | null;
}
export interface MemberShortlistCommit {
  readonly owner: string;
  readonly year: number;
  readonly expected: number;
  readonly expectedSha: string | null;
  readonly expectedLegacy: { report_id: string; report_revision: number } | null;
  readonly key: string;
  readonly digest: string;
  readonly proof: MemberShortlistReplyProof;
  readonly now: string;
  readonly assertCurrent: () => Promise<void>;
}
export interface MemberShortlistPort {
  read(owner: string, year: number, revision?: number): Promise<PublishedMemberShortlist | null>;
  replay(owner: string, key: string, digest: string): Promise<MemberShortlistReplay | null>;
  rememberNoOp(input: MemberShortlistCommit): Promise<void>;
  publish(
    input: MemberShortlistCommit & { document: MemberShortlistDocument },
  ): Promise<PublishedMemberShortlist>;
}
export interface MemberShortlistLegacyPort {
  latest(owner: string, year: number): Promise<LegacyShortlistSource | null>;
  exact(
    owner: string,
    year: number,
    reportId: string,
    revision: number,
  ): Promise<LegacyShortlistSource | null>;
  snapshot(
    owner: string,
    year: number,
    reportId: string,
    revision: number,
  ): Promise<{ report: StoredReport; legacy: LegacyShortlistSource } | null>;
}
export interface MemberShortlistCatalogPort {
  lookup(
    owner: string,
    year: number,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, NativeObject>>;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function identifier(x: unknown): string {
  if (typeof x !== "string" || !ID.test(x)) throw new AccessError("invalid_identifier", 422);
  return x;
}
function revision(x: unknown, minimum = 0): number {
  const n = typeof x === "bigint" && x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < minimum) {
    throw new AccessError("invalid_revision", 422);
  }
  return n;
}
export function validateMemberShortlist(
  d: MemberShortlistDocument,
  owner: string,
  year: number,
  maxItems: number,
): void {
  if (
    !d || d.format !== "jungsi.member-shortlist-storage/v1" || d.owner !== owner ||
    d.year !== year ||
    !Number.isSafeInteger(d.revision) || d.revision < 1 || !Array.isArray(d.items) ||
    d.items.filter((i) => i.selected).length > maxItems ||
    d.revision === 1 && d.previous_sha256 !== null ||
    d.revision > 1 &&
      (typeof d.previous_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(d.previous_sha256))
  ) invalid();
  try {
    utcInstant(d.updated_at);
  } catch {
    invalid();
  }
  const seen = new Set<string>();
  for (const i of d.items) {
    if (
      !i || typeof i.offering_id !== "string" || !ID.test(i.offering_id) ||
      typeof i.selected !== "boolean" || seen.has(i.offering_id)
    ) invalid();
    try {
      utcInstant(i.changed_at);
    } catch {
      invalid();
    }
    seen.add(i.offering_id);
  }
}
export class MemberShortlistService {
  constructor(
    private readonly lists: MemberShortlistPort,
    private readonly legacy: MemberShortlistLegacyPort,
    private readonly catalog: MemberShortlistCatalogPort,
    private readonly results: MemberJsonResults,
    private readonly clock: RequestClockPort,
    private readonly maxItems: number,
    private readonly approvedYears: ReadonlySet<number>,
    private readonly assertCurrent: () => Promise<void>,
  ) {
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || !approvedYears.size) invalid();
  }
  private async fresh(s: SessionSnapshot) {
    requirePaidSession(s, this.clock.nowUtc());
    await this.assertCurrent();
  }
  private async state(owner: string, year: number) {
    const saved = await this.lists.read(owner, year);
    if (saved) {
      validateMemberShortlist(saved.document, owner, year, this.maxItems);
      return { saved, legacy: null, items: saved.document.items };
    }
    const old = await this.legacy.latest(owner, year);
    if (old) {
      validateMemberShortlist(
        {
          format: "jungsi.member-shortlist-storage/v1",
          owner,
          year,
          revision: 1,
          previous_sha256: null,
          updated_at: old.updated_at,
          items: old.items,
        },
        owner,
        year,
        this.maxItems,
      );
    }
    return { saved: null, legacy: old, items: old?.items ?? [] };
  }
  async execute(r: ApiExecution): Promise<NativeObject> {
    if (!["member-shortlist.read", "member-shortlist.update"].includes(r.operation)) {
      throw new AccessError("route_not_found", 404);
    }
    await this.fresh(r.session);
    const read = r.operation as string === "member-shortlist.read";
    if (
      Object.keys(r.query).some((k) => !["year", "report_id"].includes(k)) ||
      !/^\d{4}$/.test(r.query.year ?? "")
    ) throw new AccessError("invalid_request", 422);
    const year = Number(r.query.year);
    if (year < 1000) throw new AccessError("invalid_request", 422);
    if (!this.approvedYears.has(year)) throw new AccessError("exam_not_available", 422);
    const reportId = r.query.report_id === undefined ? null : identifier(r.query.report_id),
      owner = r.session.user.subjectId;
    let key: string | null = null, digest: string | null = null;
    if (!read) {
      key = identifier(r.requestKey);
      digest = await nativeJsonSha256([r.body, r.params, r.query]);
      const replay = await this.lists.replay(owner, key, digest);
      if (replay) return await this.replayDto(r.session, year, replay);
    } else if (!resultObject(r.body) || Object.keys(r.body).length) {
      throw new AccessError("invalid_request", 422);
    }
    const state = await this.state(owner, year);
    if (read) {
      return await this.dto(r.session, year, state.items, state.saved, state.legacy, reportId);
    }
    if (
      !resultObject(r.body) ||
      Object.keys(r.body).some((k) =>
        !["selected", "expected_revision", "expected_legacy_source"].includes(k)
      ) || typeof r.body.selected !== "boolean"
    ) throw new AccessError("invalid_request", 422);
    const expected = revision(r.body.expected_revision),
      current = state.saved?.document.revision ?? 0;
    if (expected !== current) throw new AccessError("revision_conflict", 409);
    let expectedLegacy: { report_id: string; report_revision: number } | null = null;
    if (current === 0) {
      const v = r.body.expected_legacy_source ?? null;
      if (v !== null) {
        if (!resultObject(v) || Object.keys(v).length !== 2) {
          throw new AccessError("invalid_request", 422);
        }
        expectedLegacy = {
          report_id: identifier(v.report_id),
          report_revision: revision(v.report_version, 1),
        };
      }
      if (
        (state.legacy === null) !== (expectedLegacy === null) ||
        state.legacy &&
          (state.legacy.report_id !== expectedLegacy?.report_id ||
            state.legacy.report_revision !== expectedLegacy.report_revision)
      ) throw new AccessError("revision_conflict", 409);
    } else if (Object.hasOwn(r.body, "expected_legacy_source")) {
      throw new AccessError("invalid_request", 422);
    }
    const id = identifier(r.params.offering_id), selected = r.body.selected;
    const old = state.items.find((i) => i.offering_id === id);
    if ((old?.selected ?? false) === selected) {
      const value = await this.dto(
        r.session,
        year,
        state.items,
        state.saved,
        state.legacy,
        reportId,
      );
      await this.lists.rememberNoOp({
        owner,
        year,
        expected,
        expectedSha: state.saved?.sha256 ?? null,
        expectedLegacy,
        key: key!,
        digest: digest!,
        proof: await this.proof(value),
        now: utcText(this.clock.nowUtc()),
        assertCurrent: () => this.fresh(r.session),
      });
      const receipt = await this.lists.replay(owner, key!, digest!);
      if (!receipt) invalid();
      return await this.replayDto(r.session, year, receipt);
    }
    // Verify the exact target once; no full catalog or per-item offering.read calls.
    if (selected) {
      const target = await this.catalog.lookup(owner, year, [id]);
      if (!target.has(id)) throw new AccessError("offering_not_found", 404);
    }
    const items = state.items.filter((i) => i.selected && i.offering_id !== id).concat(
      selected
        ? [{
          offering_id: id,
          selected: true,
          changed_at: utcText(this.clock.nowUtc()),
        }]
        : [],
    ).sort((a, b) => a.offering_id < b.offering_id ? -1 : 1);
    if (items.length > this.maxItems) throw new AccessError("shortlist_limit_exceeded", 409);
    const document: MemberShortlistDocument = {
      format: "jungsi.member-shortlist-storage/v1",
      owner,
      year,
      revision: expected + 1,
      previous_sha256: state.saved?.sha256 ?? null,
      updated_at: utcText(this.clock.nowUtc()),
      items,
    };
    const prospective = { document, sha256: await nativeJsonSha256(document) },
      value = await this.dto(r.session, year, items, prospective, null, reportId);
    await this.lists.publish({
      owner,
      year,
      expected,
      expectedSha: state.saved?.sha256 ?? null,
      expectedLegacy,
      key: key!,
      digest: digest!,
      document,
      proof: await this.proof(value),
      now: document.updated_at,
      assertCurrent: () => this.fresh(r.session),
    });
    const receipt = await this.lists.replay(owner, key!, digest!);
    if (!receipt) invalid();
    return await this.replayDto(r.session, year, receipt);
  }
  private async proof(value: NativeObject): Promise<MemberShortlistReplyProof> {
    const c = value.assessment_context;
    return {
      assessment: resultObject(c)
        ? {
          report_id: identifier(c.report_id),
          report_revision: revision(c.report_version, 1),
          source: c.source as "selected_report" | "current_profile",
        }
        : null,
      responseSha: await nativeJsonSha256(value),
    };
  }
  private async replayDto(
    s: SessionSnapshot,
    year: number,
    receipt: MemberShortlistReplay,
  ): Promise<NativeObject> {
    if (receipt.year !== year) invalid();
    let legacy: LegacyShortlistSource | null = null;
    if (receipt.legacy) {
      const source = await this.legacy.exact(
        s.user.subjectId,
        year,
        receipt.legacy.report_id,
        receipt.legacy.report_revision,
      );
      if (!source) invalid();
      legacy = source;
    }
    const items = receipt.saved?.document.items ?? legacy?.items ?? [];
    const value = await this.dto(
      s,
      year,
      items,
      receipt.saved,
      legacy,
      null,
      undefined,
      receipt.assessment,
    );
    if (await nativeJsonSha256(value) !== receipt.responseSha) {
      throw new AccessError("revision_conflict", 409);
    }
    return value;
  }
  async print(r: ApiExecution): Promise<NativeObject> {
    await this.fresh(r.session);
    if (
      r.operation !== "report.export" ||
      Object.keys(r.query).some((k) =>
        ![
          "year",
          "expected_report_version",
          "shortlist_revision",
          "legacy_source_report_id",
          "legacy_source_report_version",
        ].includes(k)
      ) ||
      !/^\d{4}$/.test(r.query.year) || !/^\d+$/.test(r.query.expected_report_version) ||
      !/^\d+$/.test(r.query.shortlist_revision) ||
      !resultObject(r.body) || Object.keys(r.body).length
    ) throw new AccessError("invalid_request", 422);
    const year = Number(r.query.year),
      rv = revision(Number(r.query.expected_report_version), 1),
      sv = revision(Number(r.query.shortlist_revision)),
      owner = r.session.user.subjectId;
    const hasLegacyId = Object.hasOwn(r.query, "legacy_source_report_id"),
      hasLegacyVersion = Object.hasOwn(r.query, "legacy_source_report_version");
    if (
      hasLegacyId !== hasLegacyVersion ||
      hasLegacyId && (sv !== 0 || !/^\d+$/.test(r.query.legacy_source_report_version))
    ) throw new AccessError("invalid_request", 422);
    const legacyPin = hasLegacyId
      ? {
        report_id: identifier(r.query.legacy_source_report_id),
        report_revision: revision(Number(r.query.legacy_source_report_version), 1),
      }
      : null;
    if (year < 1000) throw new AccessError("invalid_request", 422);
    if (!this.approvedYears.has(year)) throw new AccessError("exam_not_available", 422);
    const source = await this.legacy.snapshot(owner, year, identifier(r.params.report_id), rv);
    if (!source) throw new AccessError("report_not_found", 404);
    let legacy = source.legacy;
    if (sv === 0) {
      if (legacyPin) {
        const exact = await this.legacy.exact(
          owner,
          year,
          legacyPin.report_id,
          legacyPin.report_revision,
        );
        if (!exact) throw new AccessError("report_not_found", 404);
        legacy = exact;
      } else {
        const latest = await this.legacy.latest(owner, year);
        if (
          !latest || latest.report_id !== source.report.report_id || latest.report_revision !== rv
        ) throw new AccessError("revision_conflict", 409);
      }
    }
    const saved = sv === 0 ? null : await this.lists.read(owner, year, sv);
    if (sv > 0 && !saved) throw new AccessError("revision_conflict", 409);
    if (saved) validateMemberShortlist(saved.document, owner, year, this.maxItems);
    const selected = await this.dto(
      r.session,
      year,
      saved?.document.items ?? legacy.items,
      saved,
      saved ? null : legacy,
      source.report.report_id,
      rv,
    );
    const report = reportDto(r.session, source.report);
    // The legacy report stays immutable; this export records its exact member selection snapshot.
    await this.fresh(r.session);
    return {
      format: "jungsi.counseling-snapshot/v1",
      status: "ready",
      snapshot_version: rv,
      generated_at: utcText(this.clock.nowUtc()),
      report,
      shortlist_revision: sv,
      member_shortlist: selected,
    };
  }
  private async dto(
    s: SessionSnapshot,
    year: number,
    all: readonly MemberSelection[],
    saved: PublishedMemberShortlist | null,
    legacy: LegacyShortlistSource | null,
    reportId: string | null,
    reportRevision?: number,
    pin?: MemberShortlistReplyProof["assessment"],
  ): Promise<NativeObject> {
    const selected = all.filter((i) => i.selected), ids = selected.map((i) => i.offering_id);
    const [display, results] = await Promise.all([
      this.catalog.lookup(s.user.subjectId, year, ids),
      pin === null
        ? Promise.resolve({
          context: null,
          assessments: new Map<string, NativeObject>(),
          reason: "current_saved_assessment_missing",
        })
        : this.results.read(
          s.user.subjectId,
          year,
          ids,
          pin?.report_id ?? reportId,
          pin?.report_revision ?? reportRevision,
        ),
    ]);
    if (pin && results.context) results.context.source = pin.source;
    await this.fresh(s);
    return {
      format: "jungsi.member-shortlist/v1",
      year,
      revision: saved?.document.revision ?? 0,
      updated_at: saved?.document.updated_at ?? legacy?.updated_at ?? null,
      origin: saved ? "member_json" : legacy ? "legacy_report" : "empty",
      legacy_source: legacy
        ? { report_id: legacy.report_id, report_version: legacy.report_revision }
        : null,
      assessment_context: results.context,
      items: selected.map((i) => ({
        offering_id: i.offering_id,
        selected: true,
        changed_at: i.changed_at,
        display: display.has(i.offering_id)
          ? Object.fromEntries(
            ["university_name", "department", "group", "track", "campus"].map(
              (k) => [k, cloneNativeJson(display.get(i.offering_id)![k] ?? null)],
            ),
          )
          : null,
        catalog_status: display.has(i.offering_id) ? "available" : "missing",
        assessment: results.assessments.get(i.offering_id) ?? null,
        assessment_status: results.assessments.get(i.offering_id)?.status ?? "missing",
        assessment_reason_code: results.assessments.has(i.offering_id) ? null : results.reason,
      })),
    };
  }
}
