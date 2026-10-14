/** Entirely invented catalog, publication states and counts. Never an official release. */
import type { CatalogRelease } from "../../supabase/functions/_shared/jungsi/application/catalog.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
export function syntheticCatalog(): CatalogRelease {
  const offering = (
    id: string,
    year: number,
    university: string,
    department: string,
    group: string,
    practical = false,
  ): NativeObject => ({
    offering_id: id,
    academic_year: year,
    university_id: university,
    university_name: university === "SYNTHETIC-u1" ? "가상 Straße 대학" : "가상대학나",
    campus: "가상캠퍼스",
    department,
    track: "가상일반전형",
    group,
    region: "가상지역",
    wildcard_group: null,
    practical_required: practical,
    private_source: "SYNTHETIC-PRIVATE",
  });
  const a = offering("SYNTHETIC-a", 2027, "SYNTHETIC-u1", "가상간호", "가"),
    b = offering("SYNTHETIC-b", 2027, "SYNTHETIC-u2", "가상예술 비실기", "나"),
    c = offering("SYNTHETIC-c", 2026, "SYNTHETIC-u1", "가상간호", "가"),
    d = offering("SYNTHETIC-d", 2027, "SYNTHETIC-u2", "가상실기", "나", true);
  a.recruitment = {
    initial_count: 0,
    rollover_change: null,
    final_count: 0,
    count_status: "published",
    source_url: "https://example.org/SYNTHETIC/recruitment",
    source_as_of: "2026-10-14",
    deadline: "2027-01-01",
    deadline_at: "2027-01-01T09:00:00.123456",
    source_timezone: "Asia/Seoul",
    changes: [{
      kind: "initial",
      delta: 0,
      announced_date: "2026-10-14",
      announced_at: "2026-10-14T09:00:00.123456",
      source_url: "https://example.org/SYNTHETIC/change",
      status: "published",
      reason: null,
      revision: "1",
      private_source: "SYNTHETIC-PRIVATE",
    }],
  };
  const history = (
    row: NativeObject,
    metric: string,
    value: number | null,
  ): NativeObject => ({
    ...row,
    metric_name: metric,
    metric_definition: "SYNTHETIC 발표 지표 정의",
    value,
    unit: "번",
    original_scale: null,
    publication_status: value === null ? "not_published" : "published",
    source_url: "https://example.org/SYNTHETIC/history",
    source_as_of: "2026-10-14",
    verification_status: "verified_official",
  });
  return {
    version: "SYNTHETIC-catalog.v1",
    status: "approved",
    asOfUtc: 1791936000123456n,
    offerings: [a, b, c, d],
    history: [
      history(a, "SYNTHETIC-rank", 5),
      history(a, "SYNTHETIC-zero", 0),
      history(b, "SYNTHETIC-unpublished", null),
      history(c, "SYNTHETIC-old", 3),
      history(d, "SYNTHETIC-practical", 2),
      {
        ...history(a, "SYNTHETIC-unverified", 0),
        verification_status: "pending",
        value: true,
      },
    ],
  };
}
