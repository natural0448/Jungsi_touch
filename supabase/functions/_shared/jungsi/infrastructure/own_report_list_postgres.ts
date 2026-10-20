/** Bounded own-report summaries on existing tables; no COUNT, report body, or schema changes. */
import { AccessError } from "../application/access.ts";
import type { OwnReportListPort, OwnReportListRow } from "../application/own_report_list.ts";
import { OWN_REPORT_LIST_MAX_LIMIT } from "../application/own_report_list.ts";
import { utcInstant, utcText } from "../domain/time.ts";
import { sqlIntegerText, sqlUtcText } from "./sql_values.ts";
import type { SupabaseSqlTransport } from "./transaction_sql.ts";

export const OWN_REPORT_LIST_SQL = `SELECT r.report_id,r.owner_id,p.owner_id,
 p.scores->>'exam_id',r.revision::text,
 to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 FROM jungsi_backend.reports r
 JOIN jungsi_backend.profiles p ON (r.profile_id,r.owner_id)=(p.profile_id,p.owner_id)
 WHERE r.owner_id=$1 AND p.owner_id=$1
 AND ($2::text IS NULL OR p.scores->>'exam_id'=$2)
 AND r.updated_at<=$3::timestamptz
 AND ($4::timestamptz IS NULL OR (r.updated_at,r.report_id COLLATE "C")<($4::timestamptz,$5::text COLLATE "C"))
 ORDER BY r.updated_at DESC,r.report_id COLLATE "C" DESC LIMIT $6::integer`;

function invalid(): never {
  throw new AccessError("storage_result_invalid", 503);
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SupabaseOwnReportList implements OwnReportListPort {
  constructor(private readonly sql: SupabaseSqlTransport) {}
  async read(
    input: Parameters<OwnReportListPort["read"]>[0],
  ): Promise<readonly OwnReportListRow[]> {
    if (
      !input || !UUID.test(input.owner) || input.examId !== null && !ID.test(input.examId) ||
      typeof input.asOfUtc !== "bigint" || !Number.isSafeInteger(input.take) || input.take < 1 ||
      input.take > OWN_REPORT_LIST_MAX_LIMIT + 1 ||
      input.after !== null &&
        (typeof input.after.updatedAtUtc !== "bigint" || !ID.test(input.after.reportId))
    ) invalid();
    return await this.sql.read(input.owner, async (tx) => {
      const rows = await tx.query(OWN_REPORT_LIST_SQL, [
        input.owner,
        input.examId,
        utcText(input.asOfUtc),
        input.after ? utcText(input.after.updatedAtUtc) : null,
        input.after?.reportId ?? null,
        input.take,
      ]);
      if (!Array.isArray(rows) || rows.length > input.take) invalid();
      return rows.map((row) => {
        if (
          !Array.isArray(row) || row.length !== 6 || row[1] !== input.owner ||
          row[2] !== input.owner ||
          typeof row[0] !== "string" || !ID.test(row[0]) ||
          row[3] !== null && (typeof row[3] !== "string" || !ID.test(row[3]))
        ) invalid();
        const revision = BigInt(sqlIntegerText(row[4]));
        if (revision < 1n || revision > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
        return {
          reportId: row[0],
          reportOwner: input.owner,
          profileOwner: input.owner,
          examId: row[3],
          revision: Number(revision),
          updatedAtUtc: utcInstant(sqlUtcText(row[5])),
        };
      });
    });
  }
}
