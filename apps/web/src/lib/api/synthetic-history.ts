import type { HistoryMetricDto, OfferingDto, RecruitmentDto } from "@/lib/dto";
import { OFFERINGS } from "./synthetic-fixtures";

/*
  1페이지 합성 자료 — 대학이 발표한 지표 형식의 예시. 대학·값은 모두 지어낸 것이다.
  대학마다 발표하는 지표가 다르다(50%/70%/평균/최종 합격선). 서로 바꾸어 쓰지 않는다.
  2027 모집행은 아직 결과가 없어 값 null + 미발표. 일부 지난 해도 미발표로 둔다.
*/

const AS_OF = "2026-09-10";
const SRC = "https://example.invalid/synthetic-admission-results";

type MetricDef = { name: string; definition: string; unit: string; scale: string; base: number; step: number; digits: number };
const METRICS: Record<string, MetricDef[]> = {
  "syn-gaon": [
    { name: "최종등록자 50%", definition: "최종 등록한 학생을 점수순으로 줄 세웠을 때 가운데 학생의 점수", unit: "점", scale: "대학 환산점수(1000점 만점)", base: 921, step: 1.7, digits: 2 },
    { name: "최종등록자 70%", definition: "최종 등록자 중 위에서 70% 지점 학생의 점수. 최저 합격점이 아님", unit: "점", scale: "대학 환산점수(1000점 만점)", base: 914, step: 1.9, digits: 2 },
  ],
  "syn-haesol": [{ name: "최종등록자 평균", definition: "최종 등록자 수능 점수의 평균", unit: "점", scale: "국어·수학·탐구 백분위 평균", base: 88, step: 0.6, digits: 1 }],
  "syn-daon": [{ name: "최종 합격선", definition: "충원 합격까지 포함한 최종 합격자 중 가장 낮은 점수", unit: "점", scale: "대학 환산점수(800점 만점)", base: 695, step: 1.2, digits: 1 }],
  "syn-raon": [
    { name: "최종등록자 50%", definition: "최종 등록자 점수의 가운데 값", unit: "점", scale: "대학 환산점수(700점 만점)", base: 652, step: 1.1, digits: 2 },
    { name: "최종등록자 70%", definition: "최종 등록자 중 위에서 70% 지점 점수", unit: "점", scale: "대학 환산점수(700점 만점)", base: 646, step: 1.3, digits: 2 },
  ],
  "syn-saebit": [{ name: "최종등록자 평균", definition: "최종 등록자 환산점수의 평균", unit: "점", scale: "대학 환산점수(500점 만점)", base: 468, step: 0.9, digits: 2 }],
  "syn-hanbit": [{ name: "최종등록자 70%", definition: "최종 등록자 중 위에서 70% 지점 점수(수능 부분, 면접 제외)", unit: "점", scale: "대학 환산점수(1000점 만점, 수능 부분)", base: 897, step: 2.1, digits: 2 }],
};

const REGION: Record<string, string> = Object.fromEntries(OFFERINGS.map((o) => [o.university.university_id, o.university.region]));
const WILD: Record<string, OfferingDto["wildcard_group"]> = { 간호학과: "nursing", 임상병리학과: "health", 물리치료학과: "health", 초등교육과: "education" };
// 2024학년도에는 이름이 달랐던 모집단위(이름 바꿈 예시)
const OLD_NAME: Record<string, string> = { "syn-r2": "응용통계학과", "syn-d1": "미디어학과" };
// 대학이 그해 발표하지 않은 칸
const UNPUBLISHED = new Set(["syn-h2-2024", "syn-g4-2025", "syn-g4-2024"]);

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export const HISTORY_OFFERINGS: OfferingDto[] = [];
export const HISTORY: HistoryMetricDto[] = [];

for (const o of OFFERINGS) {
  for (const year of [2027, 2026, 2025, 2024]) {
    const id = `${o.offering_id}-${year}`;
    const off: OfferingDto = {
      offering_id: id,
      academic_year: year,
      university_id: o.university.university_id,
      university_name: o.university.name,
      campus: null,
      department: year === 2024 && OLD_NAME[o.offering_id] ? OLD_NAME[o.offering_id] : o.unit_name,
      track: o.admission_name,
      group: o.group,
      region: REGION[o.university.university_id] ?? null,
      wildcard_group: WILD[o.unit_name] ?? null,
    };
    HISTORY_OFFERINGS.push(off);
    for (const m of METRICS[o.university.university_id] ?? []) {
      const published = year < 2027 && !UNPUBLISHED.has(id);
      const wobble = ((hash(id + m.name) % 100) / 100 - 0.5) * m.step * 2;
      const value = published ? (m.base - (2026 - year) * m.step * 0.4 + wobble).toFixed(m.digits) : null;
      HISTORY.push({
        ...off,
        metric_name: m.name,
        metric_definition: m.definition,
        value,
        unit: m.unit,
        original_scale: m.scale,
        publication_status: published ? "published" : "not_published",
        source_url: published ? SRC : null,
        source_as_of: published ? `${year}-03-1${hash(id) % 9}` : null,
      });
    }
  }
}

/** recruitment.read 합성 응답. 올해(2027) 모집행만 모집 정보가 있다 */
export function syntheticRecruitment(offeringId: string): RecruitmentDto | null {
  const off = HISTORY_OFFERINGS.find((x) => x.offering_id === offeringId);
  if (!off) return null;
  if (off.academic_year !== 2027) {
    return { status: "pending", reason_code: "recruitment_not_published", offering: off, recruitment: null, catalog_version: null };
  }
  const base = OFFERINGS.find((x) => offeringId.startsWith(`${x.offering_id}-`))!;
  const r = base.recruitment;
  return {
    status: "ready",
    reason_code: null,
    offering: off,
    recruitment: {
      initial_count: r.initial,
      rollover_change: r.change,
      final_count: r.final,
      count_status: r.final === null ? "not_published" : "confirmed",
      changes:
        r.change && r.final !== null
          ? [{ kind: "quota_change", delta: r.change, announced_date: "2026-09-08", announced_at: "2026-09-08T01:00:00Z", source_url: SRC, status: "source_verified", reason: "모집인원 변경 공고", revision: 1 }]
          : [],
      source_url: SRC,
      source_as_of: AS_OF,
      deadline: "2027-01-03",
      deadline_at: "2027-01-03T09:00:00Z",
    },
    catalog_version: "SYNTHETIC-catalog-v1",
  };
}
