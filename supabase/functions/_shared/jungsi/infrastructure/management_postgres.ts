/** Current management scope from existing private tables; no role writes or user creation. */
import { AccessError } from "../application/access.ts";
import { CatalogService } from "../application/catalog.ts";
import type {
  ForecastAuthorityPort,
  ForecastAuthorityState,
  ManagementResourcePort,
  ManagementResourceScope,
} from "../application/ports.ts";
import { utcText } from "../domain/time.ts";
import { SupabaseSqlTransport } from "./transaction_sql.ts";
export const FORECAST_AUTHORITY_SQL = `SELECT university_id,can_edit,can_approve
 FROM jungsi_backend.forecast_authorities WHERE subject_id=$1 ORDER BY university_id COLLATE "C" LIMIT 4097`;
export const FORECAST_SCOPE_SQL = `SELECT draft_id,jsonb_typeof(body),jsonb_typeof(body->'context'),
 jsonb_typeof(body->'context'->'university_id'),body->'context'->>'university_id',
 jsonb_typeof(body->'draft_id'),body->>'draft_id'
 FROM jungsi_backend.forecast_drafts WHERE draft_id=$1`;
function invalid(): never {
  throw new AccessError("invalid_repository_result", 503);
}
function school(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    value.trim() === value;
}
export function forecastAuthorityState(
  rows: unknown[][],
  subjectId: string,
  nowUtc: bigint,
): ForecastAuthorityState {
  if (typeof nowUtc !== "bigint") invalid();
  utcText(nowUtc);
  if (
    !Array.isArray(rows) || rows.length > 4096 ||
    rows.some((r) =>
      !Array.isArray(r) || r.length !== 3 ||
      !school(r[0]) || typeof r[1] !== "boolean" || typeof r[2] !== "boolean"
    ) ||
    new Set(rows.map((r) => r[0])).size !== rows.length
  ) invalid();
  const edit = rows.filter((r) => r[1] === true).map((r) => r[0] as string);
  const approve = rows.filter((r) => r[2] === true).map((r) => r[0] as string);
  const universityIds = rows.filter((r) => r[1] === true || r[2] === true).map((r) =>
    r[0] as string
  );
  return Object.freeze({
    authority: "jungsi_backend.forecast_authorities",
    subjectId,
    evaluatedAtUtc: nowUtc,
    edit: edit.length > 0,
    approve: approve.length > 0,
    universityIds: Object.freeze(universityIds),
    editUniversityIds: Object.freeze(edit),
    approveUniversityIds: Object.freeze(approve),
  });
}
export class SupabaseForecastAuthorities implements ForecastAuthorityPort {
  constructor(private readonly sql: SupabaseSqlTransport) {}
  async readCurrent(subjectId: string, nowUtc: bigint): Promise<ForecastAuthorityState> {
    if (typeof nowUtc !== "bigint") invalid();
    utcText(nowUtc);
    return await this.sql.read(subjectId, async (tx) => {
      const rows = await tx.query(FORECAST_AUTHORITY_SQL, [subjectId]);
      return forecastAuthorityState(rows, subjectId, nowUtc);
    });
  }
}
export class SupabaseManagementResources implements ManagementResourcePort {
  private readonly maxDraftBytes: number;
  constructor(
    private readonly sql: SupabaseSqlTransport,
    private readonly catalog: CatalogService,
    limits: { readonly maxDraftBytes: number },
  ) {
    if (!limits || !Number.isSafeInteger(limits.maxDraftBytes) || limits.maxDraftBytes < 1) {
      throw new AccessError("storage_configuration_invalid", 503);
    }
    this.maxDraftBytes = limits.maxDraftBytes;
  }
  async readScope(
    kind: "offering" | "draft",
    id: string,
    subjectId: string,
  ): Promise<ManagementResourceScope | null> {
    if (
      !["offering", "draft"].includes(kind) || typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
    ) invalid();
    if (kind === "offering") {
      const release = await this.catalog.catalog();
      if (release === null) throw new AccessError("catalog_release_missing", 503);
      try {
        const offering = this.catalog.offering(release, id);
        if (!school(offering.university_id)) invalid();
        return Object.freeze({ kind, id, universityId: offering.university_id });
      } catch (e) {
        if (e instanceof AccessError && e.code === "offering_not_found") return null;
        throw e;
      }
    }
    return await this.sql.read(subjectId, async (tx) => {
      const rows = await tx.query(FORECAST_SCOPE_SQL, [id]);
      if (
        !Array.isArray(rows) || rows.length > 1 ||
        rows.some((r) => !Array.isArray(r) || r.length !== 7)
      ) invalid();
      if (!rows.length) return null;
      // Read only scope identity and native type tags before school authorization.
      const row = rows[0];
      if (
        row[0] !== id || row[1] !== "object" || row[2] !== "object" || row[3] !== "string" ||
        !school(row[4]) ||
        row[5] !== "string" || row[6] !== id ||
        new TextEncoder().encode(row[4]).byteLength > this.maxDraftBytes
      ) invalid();
      return Object.freeze({ kind, id, universityId: row[4] });
    });
  }
}
