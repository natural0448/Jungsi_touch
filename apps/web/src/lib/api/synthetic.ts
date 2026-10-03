import "server-only";
import { cookies } from "next/headers";
import type { OfferingSearchResult } from "@/lib/contract";
import { AccessDenied, type JungsiSource } from "./source";
import { HISTORY, syntheticRecruitment } from "./synthetic-history";
import { ANALYSES, BASIS, CANDIDATE_SCHOOLS, OFFERINGS, STATISTICS, WILDCARDS } from "./synthetic-fixtures";

/*
  HTTP 핸들러 연결 전 화면 제작용 합성 응답(프레젠테이션 작업 인계: '명시적인 합성 응답').
  실제 계산·로그인·자료 연결이 아니다. 화면에는 합성 응답 띠가 늘 함께 보인다.
  보기 상태(일반·유료·성적 유무)와 핵심 지원 학교는 이 브라우저 쿠키에만 남는다. 권한이 아니다.
*/

export const SYN_COOKIE = { state: "jt_syn_state", pick: "jt_syn_pick" } as const;
export type SyntheticState = "paid" | "noscore" | "standard" | "guest";
export const SYN_STATES: { v: SyntheticState; label: string }[] = [
  { v: "paid", label: "유료 · 성적 있음" },
  { v: "noscore", label: "유료 · 성적 없음" },
  { v: "standard", label: "일반 회원" },
  { v: "guest", label: "비회원" },
];

export async function readSyntheticState(): Promise<SyntheticState> {
  const v = (await cookies()).get(SYN_COOKIE.state)?.value;
  return SYN_STATES.some((s) => s.v === v) ? (v as SyntheticState) : "paid";
}

async function readPicks(): Promise<string[]> {
  const raw = (await cookies()).get(SYN_COOKIE.pick)?.value;
  if (raw === undefined) return ["syn-g2", "syn-h2"]; // 처음 보는 사람도 담긴 모습을 보도록
  return raw.split(",").filter((id) => OFFERINGS.some((o) => o.offering_id === id));
}

const norm = (v?: string) => v?.replace(/\s/g, "") || undefined;

async function requireMember() {
  if ((await readSyntheticState()) === "guest") throw new AccessDenied(401, "authentication_required");
}

async function requirePaid() {
  const s = await readSyntheticState();
  if (s === "guest") throw new AccessDenied(401, "authentication_required");
  if (s === "standard") throw new AccessDenied(403, "paid_required");
  return s;
}

export const syntheticSource: JungsiSource = {
  kind: "synthetic",

  async searchHistory(_caller, { academic_year, university_q, department_q, region, group, cursor, limit = 50 }) {
    await requireMember();
    const u = norm(university_q);
    const d = norm(department_q);
    const rows = HISTORY.filter(
      (h) =>
        (!academic_year || h.academic_year === academic_year) &&
        (!u || h.university_name.replace(/\s/g, "").includes(u)) &&
        (!d || h.department.replace(/\s/g, "").includes(d)) &&
        (!region || h.region === region) &&
        (!group || h.group === group),
    );
    // 커서는 조회 조건과 위치를 함께 묶는다(다른 조건에서 쓰면 무시하고 처음부터)
    const key = [academic_year, u, d, region, group].join("|");
    const [ck, co] = (cursor ?? "").split("@");
    const start = ck === key && Number(co) > 0 ? Number(co) : 0;
    const size = Math.max(1, Math.min(100, limit));
    const end = start + size;
    return {
      status: "ready",
      reason_code: null,
      items: rows.slice(start, end),
      matching_offering_count: new Set(rows.map((r) => r.offering_id)).size,
      matching_school_count: new Set(rows.map((r) => r.university_id)).size,
      catalog_version: "SYNTHETIC-catalog-v1",
      as_of: "2026-09-10",
      next_cursor: end < rows.length ? `${key}@${end}` : null,
    };
  },

  async readRecruitment(_caller, offeringId) {
    await requireMember();
    return syntheticRecruitment(offeringId);
  },

  async getSession() {
    const s = await readSyntheticState();
    if (s === "guest") return null;
    if (s === "standard") return { format: "jungsi.session/v1", member_tier: "standard", entitlement_expires_at: null };
    // 2027-02-28 23:59:59 서울 = 14:59:59 UTC
    return { format: "jungsi.session/v1", member_tier: "paid", entitlement_expires_at: "2027-02-28T14:59:59Z" };
  },

  async searchOfferings(_caller, { university, unit, region, group, page = 1 }) {
    await requirePaid();
    const u = norm(university);
    const d = norm(unit);
    const items = OFFERINGS.filter(
      (o) =>
        (!u || o.university.name.replace(/\s/g, "").includes(u)) &&
        (!d || o.unit_name.replace(/\s/g, "").includes(d)) &&
        (!region || o.university.region === region) &&
        (!group || o.group === group),
    );
    const page_size = 30;
    return {
      items: items.slice((page - 1) * page_size, page * page_size),
      total_offerings: items.length,
      total_universities: new Set(items.map((o) => o.university.university_id)).size,
      regions: Array.from(new Set(OFFERINGS.map((o) => o.university.region))).sort((a, b) => a.localeCompare(b, "ko")),
      page,
      page_size,
    } satisfies OfferingSearchResult;
  },

  async analyze(_caller, offeringIds) {
    const s = await requirePaid();
    if (s === "noscore") return { state: "score_required" };
    return { state: "ready", basis: BASIS, results: ANALYSES.filter((a) => offeringIds.includes(a.offering_id)) };
  },

  async buildCandidates() {
    const s = await requirePaid();
    if (s === "noscore") return { state: "score_required" };
    return { state: "ready", basis: BASIS, schools: CANDIDATE_SCHOOLS, wildcards: WILDCARDS };
  },

  async getStatistics(_caller, offeringIds) {
    await requirePaid();
    return offeringIds.map(
      (id) => STATISTICS.find((x) => x.offering_id === id) ?? { offering_id: id, status: "pending", recommended_count: null, selected_count: null, my_rank: null, tie_count: null, updated_at: null },
    );
  },

  async listShortlist() {
    await requirePaid();
    return (await readPicks()).map((id) => {
      const o = OFFERINGS.find((x) => x.offering_id === id)!;
      return { offering_id: id, university_name: o.university.name, unit_name: o.unit_name };
    });
  },

  async setShortlist(_caller, offeringId, selected) {
    await requirePaid();
    if (!OFFERINGS.some((o) => o.offering_id === offeringId)) return;
    const picks = (await readPicks()).filter((id) => id !== offeringId);
    if (selected) picks.push(offeringId);
    (await cookies()).set(SYN_COOKIE.pick, picks.join(","), { path: "/jeongsi", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  },
};
