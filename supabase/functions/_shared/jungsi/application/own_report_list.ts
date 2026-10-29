/** Small, owner-bound report discovery. It never loads report bodies or saves a score. */
import { AccessError } from "./access.ts";
import type { RequestClockPort } from "./ports.ts";
import { SCORE_INPUT_STAGES, type ScoreInputStage } from "../domain/score_input_rights.ts";
import { sessionDto, type SessionSnapshot } from "./session_service.ts";
import { utcInstant, utcText } from "../domain/time.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const OWN_REPORT_LIST_MAX_LIMIT = 20;
export interface OwnReportListRow {
  readonly reportId: string;
  readonly reportOwner: string;
  readonly profileOwner: string;
  readonly examId: string | null;
  /** Null means no verified stage mapping; never infer a phase from the exam or date. */
  readonly stage: ScoreInputStage | null;
  /** Null means the latest state or its current report could not be established. */
  readonly isCurrent: boolean | null;
  readonly revision: number;
  readonly updatedAtUtc: bigint;
}
export interface OwnReportPosition {
  readonly format: "jungsi.own-report-cursor/v1";
  readonly owner: string;
  readonly examId: string | null;
  readonly asOfUtc: string;
  readonly expiresAtUtc: string;
  readonly afterUpdatedAtUtc: string;
  readonly afterReportId: string;
}
export interface OwnReportListPort {
  /** Owner predicates apply to both joined records; take includes the one-row lookahead. */
  read(input: {
    readonly owner: string;
    readonly examId: string | null;
    readonly asOfUtc: bigint;
    readonly after: { readonly updatedAtUtc: bigint; readonly reportId: string } | null;
    readonly take: number;
  }): Promise<readonly OwnReportListRow[]>;
}
export interface OwnReportCursorPort {
  seal(position: OwnReportPosition): Promise<string>;
  open(cursor: string): Promise<OwnReportPosition>;
}
function invalidCursor(): never {
  throw new AccessError("invalid_cursor", 422);
}
function unavailable(): never {
  throw new AccessError("storage_result_invalid", 503);
}
function instant(value: string): bigint {
  try {
    return utcInstant(value);
  } catch {
    return invalidCursor();
  }
}
function before(
  a: { updatedAtUtc: bigint; reportId: string },
  b: { updatedAtUtc: bigint; reportId: string },
): boolean {
  return a.updatedAtUtc < b.updatedAtUtc ||
    a.updatedAtUtc === b.updatedAtUtc && a.reportId < b.reportId;
}
export class OwnReportListService {
  constructor(
    private readonly rows: OwnReportListPort,
    private readonly cursors: OwnReportCursorPort,
    private readonly clock: RequestClockPort,
    private readonly cursorLifetimeMicroseconds: bigint,
  ) {
    if (typeof cursorLifetimeMicroseconds !== "bigint" || cursorLifetimeMicroseconds < 1n) {
      unavailable();
    }
  }
  async execute(session: SessionSnapshot, query: Readonly<Record<string, string>>) {
    const now = this.clock.nowUtc();
    sessionDto(session, now);
    if (Object.keys(query).some((k) => !["exam_id", "cursor", "limit"].includes(k))) {
      throw new AccessError("invalid_request", 422);
    }
    const owner = session.user.subjectId, examId = query.exam_id ?? null;
    if (examId !== null && !ID.test(examId)) throw new AccessError("invalid_identifier", 422);
    const rawLimit = query.limit ?? "10";
    if (!/^[1-9][0-9]*$/.test(rawLimit) || BigInt(rawLimit) > BigInt(OWN_REPORT_LIST_MAX_LIMIT)) {
      throw new AccessError("invalid_request", 422);
    }
    const limit = Number(rawLimit);
    let asOfUtc = now, expiresAtUtc = now + this.cursorLifetimeMicroseconds;
    let after: { updatedAtUtc: bigint; reportId: string } | null = null;
    if (query.cursor !== undefined) {
      const c = await this.cursors.open(query.cursor);
      if (
        c.format !== "jungsi.own-report-cursor/v1" || c.owner !== owner || c.examId !== examId ||
        !ID.test(c.afterReportId)
      ) invalidCursor();
      asOfUtc = instant(c.asOfUtc);
      expiresAtUtc = instant(c.expiresAtUtc);
      if (
        asOfUtc > now || expiresAtUtc <= asOfUtc ||
        expiresAtUtc - asOfUtc > this.cursorLifetimeMicroseconds
      ) invalidCursor();
      if (now >= expiresAtUtc) throw new AccessError("cursor_expired", 409);
      after = { updatedAtUtc: instant(c.afterUpdatedAtUtc), reportId: c.afterReportId };
      if (after.updatedAtUtc > asOfUtc) invalidCursor();
    }
    const records = await this.rows.read({ owner, examId, asOfUtc, after, take: limit + 1 });
    if (!Array.isArray(records) || records.length > limit + 1) unavailable();
    const seen = new Set<string>();
    let previous = after;
    for (const row of records) {
      if (
        !row || row.reportOwner !== owner || row.profileOwner !== owner || !ID.test(row.reportId) ||
        row.examId !== null && !ID.test(row.examId) ||
        examId !== null && row.examId !== examId ||
        row.stage !== null && !SCORE_INPUT_STAGES.includes(row.stage) ||
        row.isCurrent !== null && typeof row.isCurrent !== "boolean" ||
        row.stage === null && row.isCurrent !== null || !Number.isSafeInteger(row.revision) ||
        row.revision < 1 ||
        typeof row.updatedAtUtc !== "bigint" || row.updatedAtUtc > asOfUtc ||
        seen.has(row.reportId) || previous && !before(row, previous)
      ) unavailable();
      seen.add(row.reportId);
      previous = row;
    }
    const page = records.slice(0, limit), hasMore = records.length > limit;
    const last = page.at(-1);
    const nextCursor = hasMore && last
      ? await this.cursors.seal({
        format: "jungsi.own-report-cursor/v1",
        owner,
        examId,
        asOfUtc: utcText(asOfUtc),
        expiresAtUtc: utcText(expiresAtUtc),
        afterUpdatedAtUtc: utcText(last.updatedAtUtc),
        afterReportId: last.reportId,
      })
      : null;
    sessionDto(session, this.clock.nowUtc());
    return {
      format: "jungsi.own-report-list/v1",
      items: page.map((row) => ({
        report_id: row.reportId,
        exam_id: row.examId,
        stage: row.stage,
        is_current: row.isCurrent,
        report_version: row.revision,
        updated_at: utcText(row.updatedAtUtc),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  }
}
