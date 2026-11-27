import type { CandidatesDto } from "@/lib/dto";
import { CSAT_CANDIDATE_LABEL, csatCandidateView, type CsatCandidateGroup } from "@/lib/provisional-view";
import Link from "@/components/link";
import { PATH as POSSIBILITIES } from "../possibilities/query";
import { CsatGroups } from "./csat-groups";
import { FREE_LOCK_NOTE } from "@/lib/free-provisional";

/*
  가채점 후보(2026-11-23 대표님 결정, 담당자 검토안의 '가채점 참고 후보' — 화면에는 '참고' 꼬리표를 달지 않는다, 11-22 결정). 학교별 가채점 7단계를 도전·핵심·여유로 묶어 기본 후보 자리에 보인다
  (안정·하향 → 여유, 적정 → 핵심, 소신·상향 → 도전, 범위가 두 그룹에 걸치면 보류). 정식 판정 후보가 아니라 가채점 판정으로 고른 후보다.
  그룹마다 3페이지 참고 목록과 같은 대학 → 계열 → 학과 묶음·배지·별표로 그린다. 핵심만 펼친 채로 시작한다.
*/
const ORDER: CsatCandidateGroup[] = ["challenge", "core", "room"];
/** 그룹 → 4페이지 지원가능성 필터 단계(전국을 빠짐없이 찾는다) */
const STAGES: Record<CsatCandidateGroup, string> = { challenge: "aspirational,upward", core: "target", room: "stable,downward" };
const lead = (exam: string): Record<CsatCandidateGroup, string> => ({
  challenge: `${exam} 판정이 소신·상향인 학과입니다. 점수 변동에 따라 결과가 크게 달라질 수 있는 도전 지원 후보입니다.`,
  core: `${exam} 판정이 적정인 학과입니다. 지원의 중심으로 검토할 후보입니다.`,
  room: `${exam} 판정이 안정·하향인 학과입니다. 안정적으로 검토할 수 있는 후보입니다.`,
});

/** final: 수능 실채점 리포트(12-14 전환 뒤) */
export function CsatCandidates({ c, favs, p3Label, final = false, pointBased = false, allHref }: { c: CandidatesDto | null | undefined; favs: Set<string> | null; p3Label: string; final?: boolean; pointBased?: boolean; allHref?: (st: string) => string }) {
  const v = csatCandidateView(c, pointBased);
  const EXAM = final ? "실채점" : "가채점";
  const LEAD = lead(EXAM);
  const total = v.counts.challenge + v.counts.core + v.counts.room;
  // 3페이지 응답에는 크기 상한이 있어 학과가 많으면 일부만 온다(2026-11-24 대표님: '전체 보기'로 4페이지 단계 필터에 연결)
  const sum = c?.reference_threshold_summary;
  const cut = !!sum && ((typeof sum.delivered === "number" && typeof sum.listed === "number" && sum.delivered < sum.listed) || sum.complete === false);
  // 전체 대학·학과 가능성 보기(지원가능성 필터). 3·4페이지 순서가 바뀌어 page 번호 대신 경로 상수를 쓴다
  const p4 = POSSIBILITIES;
  // 무료 공개(2026-11-26 대표님): 묶음마다 대학 10곳까지만 온다. 서버가 보이지 않은 대학 수를 알려 준다(reach·core·safe)
  const hiddenRaw = sum?.free_hidden_by_bucket;
  const hidden: Record<CsatCandidateGroup, number> = { challenge: hiddenRaw?.reach ?? 0, core: hiddenRaw?.core ?? 0, room: hiddenRaw?.safe ?? 0 };
  if (total === 0) return null;
  return (
    <section className="fv-csat-cands" aria-labelledby="csat-cand-t">
      <div className="fv-sec-hd">
        <h2 id="csat-cand-t">{EXAM} 후보</h2>
        <span>
          {EXAM} 성적을 학교마다 그 대학 방식으로 계산한 판정으로 도전 <b className="num">{v.counts.challenge}</b> · 핵심 <b className="num">{v.counts.core}</b> · 여유{" "}
          <b className="num">{v.counts.room}</b>개 학과를 골랐습니다.{final ? "" : " 성적표가 나오면 정식 후보로 다시 확인해 주세요."}
        </span>
      </div>
      {ORDER.map((g) =>
        v.groups[g].length ? (
          <details key={g} className="fv-cand-g" open={g === "core"}>
            <summary>
              <b>{CSAT_CANDIDATE_LABEL[g]}</b> <span className="num">{v.counts[g]}</span>개 학과 · <span className="num">{v.groups[g].length}</span>개 대학
            </summary>
            <CsatGroups pointBased={pointBased} universities={v.groups[g]} favs={favs} outsideBand={0} p3Label={p3Label} heading={`${CSAT_CANDIDATE_LABEL[g]} 후보`} lead={LEAD[g]} note={false} hid={`csat-cand-${g}`} compact />
            {hidden[g] > 0 && <p className="fv-lock-note">이 묶음의 나머지 <b className="num">{hidden[g]}</b>개 대학은 {FREE_LOCK_NOTE}.</p>}
            <p className="fv-ref-note">
              {cut && !hidden[g] ? "학과가 많아 이 목록에는 일부만 보입니다. " : ""}
              <Link href={allHref ? allHref(STAGES[g]) : `${p4}?st=${STAGES[g]}`}>{CSAT_CANDIDATE_LABEL[g]} 단계 학과 전국에서 모두 보기 →</Link>
            </p>
          </details>
        ) : null,
      )}
      {v.held > 0 && <p className="fv-ref-note">{pointBased ? `대표 성적의 판정 근거가 없는 ${v.held}개 학과는 자동 추천에 포함되지 않습니다.` : `점수 범위에 따라 판정이 두 그룹에 걸친 ${v.held}개 학과는 자동 추천 기준 밖입니다. 아래 유리한 대학 목록에서 확인할 수 있습니다.`}</p>}
    </section>
  );
}
