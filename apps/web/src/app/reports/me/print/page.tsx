import type { Metadata } from "next";
import Link from "next/link";
import { AdvantageCell, ScoreCell, SupportBadge } from "@/components/offering-parts";
import { AccessDenied, getCaller, source } from "@/lib/api";
import type { OfferingAnalysis, ShortlistItem } from "@/lib/contract";
import type { SnapshotDto } from "@/lib/dto";
import { seoulDate } from "@/lib/format";
import { getReportId } from "@/lib/report-ref";
import { page } from "@/lib/routes";
import { AbsoluteGrades, OverallCard, SubjectsTable } from "../report-view";
import { PrintButton } from "./print-button";
import "../report.css";

export const metadata: Metadata = { title: "상담 리포트" };

/**
 * 상담 리포트 인쇄용 화면 — report.export(유료·본인·확인 성적)의 고정 revision 을 그대로 그린다.
 * 인쇄 시 머리글·탭·띠는 숨긴다(styles/jungsi.css @media print).
 */
export default async function Page() {
  const back = page("PAGE-02").path;
  const caller = await getCaller();
  const src = source();
  const reportId = await getReportId();
  let snap: SnapshotDto | null = null;
  let shortlist: ShortlistItem[] = [];
  let analyses = new Map<string, OfferingAnalysis>();
  try {
    snap = reportId ? await src.exportReport(caller, reportId) : null;
    if (snap) {
      shortlist = await src.listShortlist(caller);
      const a = await src.analyze(caller, shortlist.map((s) => s.offering_id));
      if (a.state === "ready") analyses = new Map(a.results.map((r) => [r.offering_id, r]));
    }
  } catch (e) {
    if (!(e instanceof AccessDenied)) throw e;
    return (
      <div className="wrap pg-body">
        <section className="gate">
          <h2>상담 리포트 인쇄는 이용권 회원 전용입니다</h2>
          <p>전체 성적 위치는 내 성적 리포트에서 그대로 볼 수 있습니다.</p>
          <div className="acts"><Link className="btn" href={back}>내 성적 리포트로</Link></div>
        </section>
      </div>
    );
  }
  if (!snap) {
    return (
      <div className="wrap pg-body">
        <section className="gate">
          <h2>인쇄할 리포트가 없습니다</h2>
          <p>먼저 성적을 넣어 리포트를 만들어 주세요.</p>
          <div className="acts"><Link className="btn p" href={back}>성적 입력하기</Link></div>
        </section>
      </div>
    );
  }
  const a = snap.report.overall;

  return (
    <div className="wrap pg-body pr">
      <div className="pr-tools">
        <Link className="btn" href={back}>돌아가기</Link>
        <PrintButton />
      </div>
      <article className="pr-sheet">
        <header className="pr-hd">
          <div>
            <p className="pr-brand">에듀터치 정시터치 · 상담 리포트</p>
            <h1>{a.exam.academic_year}학년도 {a.exam.exam_type} 기준</h1>
          </div>
          <dl>
            <div><dt>리포트 판</dt><dd className="num">{snap.snapshot_version}</dd></div>
            <div><dt>발행</dt><dd className="num">{seoulDate(snap.generated_at)}</dd></div>
          </dl>
        </header>

        <OverallCard a={a} />
        <h2>과목별 결과</h2>
        <SubjectsTable a={a} />
        <AbsoluteGrades a={a} />

        <h2>핵심 지원 학교 <span className="num">{shortlist.length}</span></h2>
        {shortlist.length === 0 ? (
          <p className="rp-foot">담은 학교가 없습니다.</p>
        ) : (
          <div className="tblwrap">
            <table className="tb rp-short">
              <thead>
                <tr>
                  <th scope="col">대학 · 모집단위</th>
                  <th scope="col" className="r">내 환산점수</th>
                  <th scope="col">지원가능성</th>
                  <th scope="col" className="r">환산 유불리</th>
                  <th scope="col">근거</th>
                </tr>
              </thead>
              <tbody>
                {shortlist.map((s) => {
                  const r = analyses.get(s.offering_id) ?? null;
                  return (
                    <tr key={s.offering_id}>
                      <th scope="row">{s.university_name}<small> {s.unit_name}</small></th>
                      <td className="r"><ScoreCell a={r} /></td>
                      <td>{r ? <SupportBadge status={r.support.status} /> : "─"}</td>
                      <td className="r"><AdvantageCell a={r} /></td>
                      <td className="why">{r?.support.reason ?? "─"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="pr-foot">
          지원가능성은 합격 확률이 아닙니다. 대학마다 만점과 반영 방식이 달라 다른 대학의 환산점수와 크기를 비교할 수 없습니다. 모의지원 서비스에서 모집군·지원 조건·모집인원 변경을 다시 확인하세요.
        </footer>
      </article>
    </div>
  );
}
