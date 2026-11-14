/**
 * OWNER PUBLISHER REVIEW CANDIDATE ONLY: no general-user API, transaction creation, role change,
 * grant, actual DB execution, publication, atomic publication head or runtime wiring is installed.
 * Owner credentials/transactions must remain exclusively in the separate Owner publisher process.
 * Index use, operational compatibility, physical cancellation and actual authority are NOT_RUN.
 */
import { AccessError } from "../application/access.ts";

export const OWNER_V25_VIEW = "jungsi_data_ingest.admission_v25_p1_read_20261111_v1" as const;
export const PUBLISHER_VALUE_FIELDS = [
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
type PublisherField = typeof PUBLISHER_VALUE_FIELDS[number];
export type OwnerPublisherKey = Readonly<{ academicYear: number; offeringPk: string }>;
export type OwnerPublisherRow = Readonly<
  OwnerPublisherKey & {
    values: Readonly<Record<PublisherField, string | null>>;
  }
>;
/** Input JSON is bound as $1, never interpolated; both physical key columns remain uncast. */
export const OWNER_V25_BATCH_SQL = `
WITH requested AS MATERIALIZED (
  SELECT input.obj->>'academicYear' AS academic_year,
         input.obj->>'offeringPk' AS offering_pk,
         input.ordinality
  FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS input(obj, ordinality)
)
SELECT src."학년도" AS academic_year, src."모집행PK" AS offering_pk,
       src."최초모집인원", src."수시이월인원", src."최종모집인원",
       src."모집인원_발표기준미명시", src."경쟁률", src."충원합격인원_명",
       src."최종합격예비번호_번", src."충원발표값_정의확인대기",
       src."원문충원항목명", src."발표모집집단", src."공동발표학과목록",
       src."조회자료상태", src."최종합격예비번호_발표기준"
FROM requested k
JOIN jungsi_data_ingest.admission_v25_p1_read_20261111_v1 src
  ON src."학년도" = k.academic_year AND src."모집행PK" = k.offering_pk
ORDER BY k.ordinality
`;
/** Internal publisher command only; the proof must be verified independently by the authority. */
export type OwnerPublisherCommand = Readonly<{ commandId: string; authorityProof: unknown }>;
export interface OwnerReadOnlyTransaction {
  /** Must be an already-open owner-only read-only transaction. Resolve/reject only after physical
   * query termination; never keep work detached beyond the returned promise. */
  query(
    statement: typeof OWNER_V25_BATCH_SQL,
    parameters: readonly [string],
    signal: AbortSignal,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}
export interface OwnerPublisherAuthority {
  /**
   * Independently verify the exact publisher command/proof and cancellation state, transaction
   * identity/owner role, READ ONLY mode and snapshot, approved view definition/source head, and
   * publisher authority. A caller claim or a structural TypeScript type is not such proof.
   */
  assertOwnerReadOnly(
    command: OwnerPublisherCommand,
    signal: AbortSignal,
    transaction: OwnerReadOnlyTransaction,
  ): Promise<void>;
}
function unavailable(): never {
  throw new AccessError("security_policy_unavailable", 503);
}
function id(year: number, pk: string): string {
  return JSON.stringify([year, pk]);
}

/** Owner-process source read only. Returns source rows, not a published snapshot or head. */
export async function readOwnerPublisherSourceBatch(
  command: OwnerPublisherCommand,
  keys: readonly OwnerPublisherKey[],
  signal: AbortSignal,
  tx: OwnerReadOnlyTransaction,
  authority: OwnerPublisherAuthority,
): Promise<readonly OwnerPublisherRow[]> {
  if (
    !command || typeof command.commandId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.commandId) || !command.authorityProof ||
    !signal || signal.aborted || !tx || typeof tx.query !== "function" ||
    !authority || typeof authority.assertOwnerReadOnly !== "function" ||
    !Array.isArray(keys) || keys.length < 1 || keys.length > 100
  ) unavailable();
  const commandId = command.commandId, proof = command.authorityProof;
  const check = () => {
    if (signal.aborted || command.commandId !== commandId || command.authorityProof !== proof) {
      unavailable();
    }
  };
  const allowed = new Set<string>();
  const input = keys.map((key) => {
    if (
      !key || ![2024, 2025, 2026].includes(key.academicYear) ||
      typeof key.offeringPk !== "string" || !key.offeringPk ||
      key.offeringPk.length > 512 || key.offeringPk.trim() !== key.offeringPk
    ) unavailable();
    const token = id(key.academicYear, key.offeringPk);
    if (allowed.has(token)) unavailable();
    allowed.add(token);
    return Object.freeze({ academicYear: String(key.academicYear), offeringPk: key.offeringPk });
  });
  await authority.assertOwnerReadOnly(command, signal, tx);
  check();
  const rows = await tx.query(OWNER_V25_BATCH_SQL, [JSON.stringify(input)], signal);
  check();
  if (!Array.isArray(rows) || rows.length > input.length) unavailable();
  const seen = new Set<string>();
  const output = rows.map((row) => {
    if (
      !row || typeof row !== "object" || Array.isArray(row) ||
      !Object.hasOwn(row, "academic_year") || !Object.hasOwn(row, "offering_pk") ||
      typeof row.academic_year !== "string" || !/^(2024|2025|2026)$/.test(row.academic_year) ||
      typeof row.offering_pk !== "string"
    ) unavailable();
    const year = Number(row.academic_year), pk = row.offering_pk;
    const token = id(year, pk);
    if (!allowed.has(token) || seen.has(token)) unavailable();
    seen.add(token);
    const values: Partial<Record<PublisherField, string | null>> = {};
    for (const field of PUBLISHER_VALUE_FIELDS) {
      const desc = Object.getOwnPropertyDescriptor(row, field);
      if (!desc || !("value" in desc) || (desc.value !== null && typeof desc.value !== "string")) {
        unavailable();
      }
      values[field] = desc.value as string | null;
    }
    return Object.freeze({
      academicYear: year,
      offeringPk: pk,
      values: Object.freeze(values) as Readonly<Record<PublisherField, string | null>>,
    });
  });
  await authority.assertOwnerReadOnly(command, signal, tx);
  check();
  return Object.freeze(output);
}
