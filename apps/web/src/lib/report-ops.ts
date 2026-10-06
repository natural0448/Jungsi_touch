import "server-only";
import type { Caller, JungsiSource } from "@/lib/api";
import type { AssessmentDto, OfferingDto, ReportDto, ShortlistEntryDto } from "@/lib/dto";
import { getReportId } from "@/lib/report-ref";

/*
  3·4페이지(와 2페이지 유료 부분)가 리포트에 묶인 분석을 쓰는 방법.
  - 개인 분석은 report.analyses 에, 후보는 report.candidates 에, 선택은 report.shortlist 에 있다(API_DTO 계약).
  - 화면에 필요한 모집행이 아직 분석되지 않았으면 university.analyze / candidates.build 로 리포트를 갱신한다.
  - 요청 키는 (리포트, revision, 대상)으로 정해 같은 화면을 다시 열어도 한 번만 쓰이고,
    다른 화면이 먼저 갱신해 revision_conflict 가 나면 새로 읽어 한 번만 다시 시도한다.
*/

/** 요청 키: [A-Za-z0-9._:-] 128자 이내(서버의 등록 토큰 형식) */
function key(prefix: string, report: ReportDto, extra = "") {
  let h = 2166136261;
  for (const ch of `${report.report_id}|${report.report_version}|${extra}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${prefix}-${report.report_version}-${h.toString(36)}`.slice(0, 128);
}

export type ReportState = { kind: "none" } | { kind: "ready"; report: ReportDto } | { kind: "score_required"; report: ReportDto | null };

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
    if (res.code !== "revision_conflict") throw new Error(`정시터치 리포트 갱신 실패: ${res.code}`);
    const fresh = await src.readReport(caller, current.report_id);
    if (!fresh) return { kind: "none" };
    current = fresh;
  }
  return { kind: "ready", report: current };
}

/** 보이는 모집행 중 아직 분석이 없는 것만 university.analyze 로 채운다(한 번에 100개까지) */
export async function ensureAnalyses(src: JungsiSource, caller: Caller, report: ReportDto, ids: string[]): Promise<ReportState> {
  const missing = ids.filter((id) => !report.analyses?.[id]).slice(0, 100);
  if (missing.length === 0) return { kind: "ready", report };
  return retryOnConflict(src, caller, report, (r) =>
    src.analyzeUniversities(caller, r.report_id, r.report_version, missing, key("ua", r, missing.join(","))),
  );
}

/** 후보가 아직 없으면 candidates.build 로 만든다 */
export async function ensureCandidates(src: JungsiSource, caller: Caller, report: ReportDto): Promise<ReportState> {
  if (report.candidates) return { kind: "ready", report };
  return retryOnConflict(src, caller, report, (r) => src.buildCandidates(caller, r.report_id, r.report_version, key("cb", r)));
}

/** 담기·빼기: 최신 revision 으로 shortlist.update. 같은 상태 쓰기는 서버가 revision 을 올리지 않는다 */
export async function togglePickOn(src: JungsiSource, caller: Caller, report: ReportDto, offeringId: string, selected: boolean): Promise<ReportState> {
  return retryOnConflict(src, caller, report, (r) =>
    src.updateShortlist(caller, r.report_id, offeringId, selected, r.report_version, key("sl", r, `${offeringId}:${selected}`)),
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
