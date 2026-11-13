/** Existing app-role tables hold small immutable publication/replay pointers only. */
import { AccessError } from "../application/access.ts";
import type {
  MemberAssessmentContext,
  MemberSavedResultsPort,
} from "../application/member_json_results.ts";
import type {
  LegacyShortlistSource,
  MemberSelection,
  MemberShortlistCommit,
  MemberShortlistLegacyPort,
  MemberShortlistPort,
  MemberShortlistReplay,
  PublishedMemberShortlist,
} from "../application/member_shortlist.ts";
import { resultObject } from "../application/paid_result_components.ts";
import { type NativeSqlTransaction, SupabaseSqlTransport } from "./transaction_sql.ts";
import { sqlIntegerText, sqlObjectText, sqlUtcText } from "./sql_values.ts";
import { type MemberJsonReference, MemberJsonStorage } from "./member_json_storage.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../domain/json_value.ts";
import { composeMemberSchoolResults } from "../application/member_school_results.ts";
import type { StoredProfile } from "../application/platform_repository.ts";
import type {
  MemberSchoolResultReference,
  MemberSchoolResultsStorage,
} from "./member_school_results_storage.ts";
import type { StoredReport } from "../application/platform_repository.ts";

export const MEMBER_PUBLICATION_SQL = `SELECT result::text FROM jungsi_backend.requests
 WHERE owner_id=$1 AND operation='member-shortlist.publication'
 AND request_key LIKE $2 ORDER BY request_key COLLATE "C" DESC LIMIT 1`;
export const MEMBER_REVISION_SQL = `SELECT result::text FROM jungsi_backend.requests
 WHERE owner_id=$1 AND operation='member-shortlist.publication' AND request_key=$2`;
export const MEMBER_REPLAY_SQL = `SELECT digest,result::text FROM jungsi_backend.requests
 WHERE owner_id=$1 AND operation='member-shortlist.update' AND request_key=$2`;
export const MEMBER_POINTER_INSERT_SQL = `INSERT INTO jungsi_backend.requests
 (owner_id,operation,request_key,digest,result,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`;
const TIME = `to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const PROFILE_TIME = `to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const OWN_JOIN = `FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v
 ON (r.report_id,r.owner_id,r.revision)=(v.report_id,v.owner_id,v.revision)
 JOIN jungsi_backend.profiles p ON (v.profile_id,v.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND v.owner_id=$1 AND p.owner_id=$1
 AND v.body#>>'{overall,exam,academic_year}'=$2`;
export const MEMBER_LEGACY_SQL = `SELECT r.report_id,v.revision::text,${TIME},
 CASE WHEN octet_length((v.body->'shortlist')::text)<=$3 THEN (v.body->'shortlist')::text ELSE NULL END
 ${OWN_JOIN} ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC LIMIT 1`;
/** Conflicts with the existing report writer's FOR UPDATE through publication commit. */
export const MEMBER_LEGACY_LOCK_SQL = MEMBER_LEGACY_SQL + " FOR SHARE OF r";
export const MEMBER_LEGACY_EXACT_SQL = `SELECT r.report_id,v.revision::text,${TIME},
 CASE WHEN octet_length((v.body->'shortlist')::text)<=$3 THEN (v.body->'shortlist')::text ELSE NULL END
 FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v
 ON (r.report_id,r.owner_id)=(v.report_id,v.owner_id)
 JOIN jungsi_backend.profiles p ON (v.profile_id,v.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND v.owner_id=$1 AND p.owner_id=$1
 AND v.body#>>'{overall,exam,academic_year}'=$2 AND r.report_id=$4 AND v.revision=$5::bigint`;
export const MEMBER_RESULTS_SQL = `SELECT r.report_id,v.revision::text,v.profile_id,
 p.scores->>'exam_id',p.scores->>'pack_version',
 (SELECT COALESCE(jsonb_object_agg(i.id,v.body->'analyses'->i.id),'{}'::jsonb)::text
 FROM jsonb_array_elements_text($3::text::jsonb) i(id) WHERE (v.body->'analyses') ? i.id),
 CASE WHEN v.body ? 'member_school_results_refs' THEN v.body::text ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN p.scores::text ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN p.confirmed ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN ${PROFILE_TIME} ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN ${TIME} ELSE NULL END
 FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v
 ON (r.report_id,r.owner_id)=(v.report_id,v.owner_id)
 AND v.revision=COALESCE($5::bigint,r.revision)
 JOIN jungsi_backend.profiles p ON (v.profile_id,v.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND v.owner_id=$1 AND p.owner_id=$1
 AND v.body#>>'{overall,exam,academic_year}'=$2
 AND ($4::text IS NULL OR r.report_id=$4)
 AND ($4::text IS NOT NULL OR EXISTS(SELECT 1 FROM jungsi_backend.score_input_states s
 WHERE s.owner_id=$1 AND s.current_profile_id=v.profile_id))
 ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC LIMIT 1`;
function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function one(rows: unknown[][], size: number): unknown[] | null {
  if (
    !Array.isArray(rows) || rows.length > 1 ||
    rows.some((r) => !Array.isArray(r) || r.length !== size)
  ) invalid();
  return rows[0] ?? null;
}
function id(v: unknown): string {
  if (typeof v !== "string" || !v.match(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)) invalid();
  return v;
}
function rev(v: unknown): number {
  const n = sqlIntegerText(v);
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) invalid();
  return n;
}
export async function lockMemberShortlist(
  tx: NativeSqlTransaction,
  owner: string,
  year: number,
): Promise<void> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${owner}\0member-shortlist\0${year}`),
    ),
  );
  await tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [
    String(new DataView(bytes.buffer).getBigInt64(0, false)),
  ]);
}
export class SupabaseMemberShortlistLegacy
  implements MemberShortlistLegacyPort, MemberSavedResultsPort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly maxBytes: number,
    private readonly maxItems: number,
    private readonly schoolResults: Pick<MemberSchoolResultsStorage, "read"> | null = null,
  ) {}

  /** References stay private; immutable objects are fetched after the SQL read. */
  private async hydrate(
    report: StoredReport,
    year: number,
    profile: StoredProfile,
  ): Promise<StoredReport> {
    if (!Object.hasOwn(report.body, "member_school_results_refs")) return report;
    if (
      year !== 2027 || !this.schoolResults || !profile.confirmed ||
      profile.owner_id !== report.owner_id || profile.profile_id !== report.profile_id ||
      !resultObject(report.body.overall) || !resultObject(report.body.overall.exam) ||
      report.body.overall.exam.academic_year !== year ||
      report.body.overall.exam.exam_id !== profile.scores.exam_id ||
      report.body.overall.pack_version !== profile.scores.pack_version ||
      typeof profile.scores.exam_id !== "string" ||
      typeof profile.scores.pack_version !== "string" ||
      !Array.isArray(report.body.member_school_results_refs)
    ) invalid();
    const fingerprint = await nativeJsonSha256(profile.scores);
    const documents: NativeObject[] = [];
    const seen = new Set<string>();
    for (const value of report.body.member_school_results_refs) {
      if (
        !resultObject(value) || Object.keys(value).sort().join(",") !==
          "bytes,object_key,sha256,source_report_revision" ||
        typeof value.object_key !== "string" || seen.has(value.object_key) ||
        typeof value.sha256 !== "string" || typeof value.bytes !== "number" ||
        typeof value.source_report_revision !== "number" ||
        !Number.isSafeInteger(value.source_report_revision) || value.source_report_revision < 1 ||
        value.source_report_revision > report.revision
      ) invalid();
      seen.add(value.object_key);
      const ref = value as unknown as MemberSchoolResultReference;
      documents.push(
        await this.schoolResults.read({
          owner: report.owner_id,
          academicYear: year,
          reportId: report.report_id,
          reportRevision: ref.source_report_revision,
          currentReportRevision: report.revision,
          profileId: report.profile_id,
          profileFingerprint: fingerprint,
          examId: profile.scores.exam_id,
          packVersion: profile.scores.pack_version,
        }, ref),
      );
    }
    const composed = await composeMemberSchoolResults(report.owner_id, profile, report, documents);
    return { ...report, body: { ...report.body, analyses: composed.analyses } };
  }

  private profile(
    owner: string,
    profileId: string,
    scores: unknown,
    confirmed: unknown,
    createdAt: unknown,
  ): StoredProfile {
    if (confirmed !== true) invalid();
    return {
      owner_id: owner,
      profile_id: profileId,
      scores: sqlObjectText(scores, this.maxBytes),
      confirmed: true,
      created_at: sqlUtcText(createdAt),
    };
  }

  async legacyIn(
    tx: NativeSqlTransaction,
    owner: string,
    year: number,
    locked = false,
  ): Promise<LegacyShortlistSource | null> {
    return this.legacyRow(
      one(
        await tx.query(locked ? MEMBER_LEGACY_LOCK_SQL : MEMBER_LEGACY_SQL, [
          owner,
          String(year),
          this.maxBytes,
        ]),
        4,
      ),
    );
  }
  private legacyRow(r: unknown[] | null): LegacyShortlistSource | null {
    if (!r) return null;
    const raw = sqlObjectText(r[3], this.maxBytes);
    if (!resultObject(raw)) invalid();
    const items: MemberSelection[] = Object.entries(raw).map(([offering_id, value]) => {
      if (
        !resultObject(value) || typeof value.selected !== "boolean" ||
        typeof value.changed_at !== "string"
      ) invalid();
      return {
        offering_id: id(offering_id),
        selected: value.selected,
        changed_at: value.changed_at,
      };
    });
    return { report_id: id(r[0]), report_revision: rev(r[1]), updated_at: sqlUtcText(r[2]), items };
  }
  async latest(owner: string, year: number) {
    return await this.sql.read(owner, (tx) => this.legacyIn(tx, owner, year));
  }
  async exact(owner: string, year: number, reportId: string, revision: number) {
    return await this.sql.read(
      owner,
      async (tx) =>
        this.legacyRow(
          one(
            await tx.query(MEMBER_LEGACY_EXACT_SQL, [
              owner,
              String(year),
              this.maxBytes,
              id(reportId),
              String(revision),
            ]),
            4,
          ),
        ),
    );
  }
  async snapshot(owner: string, year: number, reportId: string, revision: number) {
    const result = await this.sql.read(owner, async (tx) => {
      const r = one(
        await tx.query(
          `SELECT v.profile_id,v.body::text,${TIME},
 CASE WHEN v.body ? 'member_school_results_refs' THEN p.scores::text ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN p.confirmed ELSE NULL END,
 CASE WHEN v.body ? 'member_school_results_refs' THEN ${PROFILE_TIME} ELSE NULL END
 FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v
 ON (r.report_id,r.owner_id)=(v.report_id,v.owner_id)
 JOIN jungsi_backend.profiles p ON (v.profile_id,v.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND v.owner_id=$1 AND p.owner_id=$1 AND r.report_id=$2
 AND v.revision=$3::bigint AND v.body#>>'{overall,exam,academic_year}'=$4`,
          [owner, id(reportId), String(revision), String(year)],
        ),
        6,
      );
      if (!r) return null;
      const body = sqlObjectText(r[1], this.maxBytes);
      if (!resultObject(body.shortlist)) invalid();
      const items: MemberSelection[] = Object.entries(body.shortlist).map(([offering_id, v]) => {
        if (
          !resultObject(v) || typeof v.selected !== "boolean" || typeof v.changed_at !== "string"
        ) invalid();
        return { offering_id: id(offering_id), selected: v.selected, changed_at: v.changed_at };
      });
      const updated_at = sqlUtcText(r[2]);
      const report: StoredReport = {
        owner_id: owner,
        report_id: reportId,
        profile_id: id(r[0]),
        revision,
        body,
        updated_at,
      };
      const profile = Object.hasOwn(body, "member_school_results_refs")
        ? this.profile(owner, report.profile_id, r[3], r[4], r[5])
        : null;
      return {
        report,
        profile,
        legacy: { report_id: reportId, report_revision: revision, updated_at, items },
      };
    });
    if (!result) return null;
    const report = result.profile
      ? await this.hydrate(result.report, year, result.profile)
      : result.report;
    return { report, legacy: result.legacy };
  }

  async read(
    owner: string,
    year: number,
    ids: readonly string[],
    reportId: string | null,
    revision?: number,
  ) {
    if (ids.length > this.maxItems || ids.some((x) => id(x) !== x)) invalid();
    const result = await this.sql.read(owner, async (tx) => {
      const r = one(
        await tx.query(MEMBER_RESULTS_SQL, [
          owner,
          String(year),
          JSON.stringify(ids),
          reportId,
          revision === undefined ? null : String(revision),
        ]),
        11,
      );
      if (!r) return null;
      const context: MemberAssessmentContext = {
        owner,
        year,
        report_id: id(r[0]),
        report_revision: rev(r[1]),
        profile_id: id(r[2]),
        exam_id: id(r[3]),
        pack_version: id(r[4]),
        source: reportId === null ? "current_profile" : "selected_report",
      };
      const analyses = sqlObjectText(r[5], this.maxBytes);
      if (r[6] === null) return { context, analyses, report: null, profile: null };
      const body = sqlObjectText(r[6], this.maxBytes);
      if (!Object.hasOwn(body, "member_school_results_refs")) invalid();
      const report: StoredReport = {
        owner_id: owner,
        report_id: context.report_id,
        profile_id: context.profile_id,
        revision: context.report_revision,
        body,
        updated_at: sqlUtcText(r[10]),
      };
      const profile = this.profile(owner, context.profile_id, r[7], r[8], r[9]);
      if (
        profile.scores.exam_id !== context.exam_id ||
        profile.scores.pack_version !== context.pack_version
      ) invalid();
      return { context, analyses, report, profile };
    });
    if (!result) return null;
    if (!result.report || !result.profile) {
      return { context: result.context, analyses: result.analyses };
    }
    const restored = await this.hydrate(result.report, year, result.profile);
    if (!resultObject(restored.body.analyses)) invalid();
    const analyses: NativeObject = {};
    for (const offeringId of ids) {
      if (Object.hasOwn(restored.body.analyses, offeringId)) {
        analyses[offeringId] = restored.body.analyses[offeringId];
      }
    }
    return { context: result.context, analyses };
  }
}
export class SupabaseMemberShortlist implements MemberShortlistPort {
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly objects: MemberJsonStorage,
    private readonly legacy: SupabaseMemberShortlistLegacy,
    private readonly maxMetadataBytes: number,
  ) {}
  private async pointer(
    tx: NativeSqlTransaction,
    owner: string,
    year: number,
    revision?: number,
  ): Promise<MemberJsonReference | null> {
    const key = `${year}:${revision === undefined ? "%" : String(revision).padStart(16, "0")}`;
    const row = one(
      await tx.query(revision === undefined ? MEMBER_PUBLICATION_SQL : MEMBER_REVISION_SQL, [
        owner,
        key,
      ]),
      1,
    );
    if (!row) return null;
    const ref = this.objects.reference(sqlObjectText(row[0], this.maxMetadataBytes), owner, year);
    if (revision !== undefined && ref.revision !== revision) invalid();
    return ref;
  }
  private async replayIn(tx: NativeSqlTransaction, owner: string, key: string, digest: string) {
    const row = one(await tx.query(MEMBER_REPLAY_SQL, [owner, key]), 2);
    if (!row) return null;
    if (row[0] !== digest) throw new AccessError("idempotency_conflict", 409);
    const v = sqlObjectText(row[1], this.maxMetadataBytes),
      n = typeof v.year === "bigint" ? Number(v.year) : v.year;
    if (
      typeof n !== "number" || !Number.isSafeInteger(n) || n < 1000 || n > 9999 ||
      Object.keys(v).sort().join(",") !== "assessment,legacy,reference,response_sha256,year" ||
      typeof v.response_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.response_sha256)
    ) invalid();
    const legacy = v.legacy === null ? null : this.reportReference(v.legacy);
    let assessment: MemberShortlistReplay["assessment"] = null;
    if (v.assessment !== null) {
      if (
        !resultObject(v.assessment) ||
        !["current_profile", "selected_report"].includes(v.assessment.source as string)
      ) invalid();
      assessment = {
        ...this.reportReference(v.assessment),
        source: v.assessment.source as "current_profile" | "selected_report",
      };
    }
    return {
      year: n,
      ref: v.reference === null ? null : this.objects.reference(v.reference, owner, n),
      legacy,
      assessment,
      responseSha: v.response_sha256,
    };
  }
  private reportReference(v: unknown): { report_id: string; report_revision: number } {
    if (!resultObject(v)) invalid();
    const n = typeof v.report_revision === "bigint" ? Number(v.report_revision) : v.report_revision;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) invalid();
    return { report_id: id(v.report_id), report_revision: n };
  }
  async read(
    owner: string,
    year: number,
    revision?: number,
  ): Promise<PublishedMemberShortlist | null> {
    const ref = await this.sql.read(owner, (tx) => this.pointer(tx, owner, year, revision));
    return ref ? { document: await this.objects.read(owner, year, ref), sha256: ref.sha256 } : null;
  }
  async replay(owner: string, key: string, digest: string): Promise<MemberShortlistReplay | null> {
    const value = await this.sql.read(owner, (tx) => this.replayIn(tx, owner, key, digest));
    if (!value) return null;
    const saved = value.ref
      ? {
        document: await this.objects.read(owner, value.year, value.ref),
        sha256: value.ref.sha256,
      }
      : null;
    return {
      year: value.year,
      saved,
      legacy: value.legacy,
      assessment: value.assessment,
      responseSha: value.responseSha,
    };
  }
  private async commit(input: MemberShortlistCommit, candidate: MemberJsonReference | null) {
    const { owner, year, expected, expectedSha, expectedLegacy, key, digest } = input;
    return await this.sql.write(owner, async (tx) => {
      const keyBytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`${owner}\0member-shortlist.update\0${key}`),
        ),
      );
      await tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        String(new DataView(keyBytes.buffer).getBigInt64(0, false)),
      ]);
      await lockMemberShortlist(tx, owner, year);
      const replay = await this.replayIn(tx, owner, key, digest);
      if (replay) {
        if (replay.year !== year) invalid();
        return replay.ref;
      }
      const current = await this.pointer(tx, owner, year);
      if ((current?.revision ?? 0) !== expected || (current?.sha256 ?? null) !== expectedSha) {
        throw new AccessError("revision_conflict", 409);
      }
      if (expected === 0) {
        const old = await this.legacy.legacyIn(tx, owner, year, true);
        if (
          (old === null) !== (expectedLegacy === null) ||
          old &&
            (old.report_id !== expectedLegacy?.report_id ||
              old.report_revision !== expectedLegacy.report_revision)
        ) throw new AccessError("revision_conflict", 409);
      }
      const reference = candidate ?? current;
      const result = nativeJsonText({
        year,
        reference,
        legacy: reference === null ? expectedLegacy : null,
        assessment: input.proof.assessment,
        response_sha256: input.proof.responseSha,
      }, true);
      if (new TextEncoder().encode(result).length > this.maxMetadataBytes) invalid();
      if (candidate) {
        await tx.query(MEMBER_POINTER_INSERT_SQL, [
          owner,
          "member-shortlist.publication",
          `${year}:${String(candidate.revision).padStart(16, "0")}`,
          candidate.sha256,
          nativeJsonText(candidate, true),
          input.now,
        ]);
      }
      await tx.query(MEMBER_POINTER_INSERT_SQL, [
        owner,
        "member-shortlist.update",
        key,
        digest,
        result,
        input.now,
      ]);
      return reference;
    });
  }
  async rememberNoOp(input: MemberShortlistCommit): Promise<void> {
    await input.assertCurrent();
    await this.commit(input, null);
    await input.assertCurrent();
  }
  async publish(
    input: Parameters<MemberShortlistPort["publish"]>[0],
  ): Promise<PublishedMemberShortlist> {
    const { owner, year, expected, expectedSha, document } = input;
    if (
      document.owner !== owner || document.year !== year || document.revision !== expected + 1 ||
      document.previous_sha256 !== expectedSha
    ) invalid();
    await input.assertCurrent();
    // Remote work is complete before the short owner/year CAS transaction starts.
    const candidate = await this.objects.create(document);
    await input.assertCurrent();
    const published = await this.commit(input, candidate);
    if (!published) invalid();
    const value = published.sha256 === candidate.sha256
      ? document
      : await this.objects.read(owner, year, published);
    await input.assertCurrent();
    return { document: value, sha256: published.sha256 };
  }
}
