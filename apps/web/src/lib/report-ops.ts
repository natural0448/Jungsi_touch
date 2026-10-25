import "server-only";
import type { Caller, JungsiSource } from "@/lib/api";
import type { AssessmentDto, OfferingDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import { getReportId } from "@/lib/report-ref";

/*
  3·4페이지(와 2페이지 유료 부분)가 리포트에 묶인 분석을 쓰는 방법.
  - 개인 분석은 report.analyses 에, 후보는 report.candidates 에, 선택은 report.shortlist 에 있다(API_DTO 계약).
  - 회원이 분석 버튼을 눌렀을 때만 university.analyze / candidates.build 로 리포트를 갱신한다.
  - 요청 키는 (operation, 리포트, revision, 실제 요청 본문)으로 정해 같은 요청을 중복 실행하지 않고,
    다른 화면이 먼저 갱신해 revision_conflict 가 나면 새로 읽어 한 번만 다시 시도한다.
*/

/** 요청 키: [A-Za-z0-9._:-] 128자 이내(서버의 등록 토큰 형식) */
async function key(prefix: string, report: ReportDto, body: object) {
  const bytes = new TextEncoder().encode(JSON.stringify([prefix, report.report_id, report.report_version, body]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

/** 같은 집합은 같은 순서·본문으로 보낸다. 공란·중복으로 100개 한도를 소비하지 않는다. */
export function canonicalOfferingIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

/** failed: 서버가 갱신을 거절했다(사유 코드). 화면 전체를 깨지 않고 갱신 전 리포트로 그리며 사유만 안내한다 */
export type ReportState =
  | { kind: "none" }
  | { kind: "ready"; report: ReportDto }
  | { kind: "score_required"; report: ReportDto | null }
  | { kind: "failed"; report: ReportDto; code: string };

/** 내 리포트(이 브라우저가 기억한 번호). 없으면 성적 입력이 먼저다 */
export async function loadMine(src: JungsiSource, caller: Caller): Promise<ReportDto | null> {
  const id = await getReportId();
  return id ? src.readReport(caller, id) : null;
}

async function retryOnConflict(src: JungsiSource, caller: Caller, report: ReportDto, run: (r: ReportDto) => ReturnType<JungsiSource["analyzeUniversities"]>): Promise<ReportState> {
  let current = report;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await run(current);
    if (res.ok) return { kind: "ready", report: res.value };
    if (res.code === "score_confirmation_required") return { kind: "score_required", report: current };
    if (res.code !== "revision_conflict") return { kind: "failed", report: current, code: res.code };
    if (attempt === 1) return { kind: "failed", report: current, code: res.code };
    const fresh = await src.readReport(caller, current.report_id);
    if (!fresh) return { kind: "none" };
    current = fresh;
  }
  return { kind: "failed", report: current, code: "revision_conflict" };
}

/** 보이는 모집행 중 아직 분석이 없는 것만 university.analyze 로 채운다(한 번에 100개까지) */
export async function ensureAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<ReportState> {
  const targets = canonicalOfferingIds(ids);
  return retryOnConflict(src, caller, report, async (r) => {
    const missing = targets.filter((id) => !r.analyses?.[id]).slice(0, 100);
    if (missing.length === 0) return { ok: true, value: r };
    const body = { expected_version: r.report_version, offering_ids: missing };
    return src.analyzeUniversities(caller, r.report_id, r.report_version, missing, await key("ua", r, body));
  });
}

/** 후보가 아직 없으면 candidates.build 로 만든다 */
export async function ensureCandidates(src: JungsiSource, caller: Caller, report: ReportDto): Promise<ReportState> {
  return retryOnConflict(src, caller, report, async (r) => {
    if (r.candidates) return { ok: true, value: r };
    return src.buildCandidates(caller, r.report_id, r.report_version, await key("cb", r, { expected_version: r.report_version }));
  });
}

/** 담기·빼기: 최신 revision 으로 shortlist.update. 같은 상태 쓰기는 서버가 revision 을 올리지 않는다 */
export async function togglePickOn(src: JungsiSource, caller: Caller, report: ReportDto, offeringId: string, selected: boolean): Promise<ReportState> {
  return retryOnConflict(src, caller, report, async (r) =>
    src.updateShortlist(caller, r.report_id, offeringId, selected, r.report_version, await key("sl", r, { offering_id: offeringId, selected, expected_version: r.report_version })),
  );
}

export interface PickedItem {
  offering: OfferingDto | null; // 카탈로그에서 빠졌으면 null
  offering_id: string;
  entry: ShortlistEntryDto;
  assessment: AssessmentDto | null;
}

/** 선택된 항목만, 이름은 offering.read 로 붙인다(report.shortlist 에는 이름이 없다) */
export async function pickedItems(src: JungsiSource, caller: Caller, report: ReportDto, known: OfferingDto[] = []): Promise<PickedItem[]> {
  const entries = Object.entries(report.shortlist ?? {}).filter(([, e]) => e.selected);
  return Promise.all(
    entries.map(async ([id, entry]) => {
      const offering = known.find((o) => o.offering_id === id) ?? (await src.readOffering(caller, id))?.offering ?? null;
      return { offering, offering_id: id, entry, assessment: report.analyses?.[id] ?? null };
    }),
  );
}
