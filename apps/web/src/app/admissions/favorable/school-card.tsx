import Link from "next/link";
import { ChevronIcon } from "@/components/icons";
import { AdvantageCell, PickButton, ScoreCell, StatsLine, SupportBadge, SUPPORT } from "@/components/offering-parts";
import type { CandidateSchool, OfferingStatistics, SupportStatus } from "@/lib/contract";
import { page } from "@/lib/routes";
import { BUCKETS, hrefWith, type Query } from "./query";

/**
 * 기본 학교 목록의 학교 한 곳. 학교 분류(도전·핵심·여유)는 전체 성적 1차 선별이라 무채색 꼬리표로만 두고,
 * 색이 있는 판단은 학과마다 따로 붙인다(REQ-05: 학교 분류를 학과에 복사하지 않는다).
 */
export function SchoolCard({ s, cur, picked, stats }: { s: CandidateSchool; cur: Query; picked: Set<string>; stats: Map<string, OfferingStatistics> }) {
  const open = cur.open === s.university.university_id;
  const bucket = BUCKETS.find((b) => b.v === s.bucket)!;
  const counts = new Map<SupportStatus, number>();
  for (const o of s.offerings) counts.set(o.analysis.support.status, (counts.get(o.analysis.support.status) ?? 0) + 1);
  const best = s.offerings
    .map((o) => (o.analysis.advantage.status === "computed" && o.analysis.advantage.pp ? Number(o.analysis.advantage.pp) : null))
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a)[0];
  const toggle = `${hrefWith(cur, { open: open ? undefined : s.university.university_id })}#${s.university.university_id}`;
  const p3 = page("PAGE-03").path;

  return (
    <article id={s.university.university_id} className={`sc${open ? " open" : ""}`} aria-labelledby={`h-${s.university.university_id}`}>
      <header className="sc-hd">
        <span className={`bucket ${s.bucket}`}>{bucket.label}</span>
        <div className="ttl">
          <h3 id={`h-${s.university.university_id}`}>{s.university.name}</h3>
          <p>
            {s.university.region} · {s.university.founding} · 환산 기준 {s.university.score_scale_label}
          </p>
        </div>
      </header>

      <p className="sc-why">
        <span>찾은 이유</span>
        {s.reason}
      </p>

      <div className="sc-sum">
        <div className="n">
          <small>학과별 판단</small>
          <div className="mix">
            {(Object.keys(SUPPORT) as SupportStatus[])
              .filter((k) => counts.get(k))
              .map((k) => (
                <span key={k} className="mixi">
                  <SupportBadge status={k} /> <b className="num">{counts.get(k)}</b>
                </span>
              ))}
          </div>
        </div>
        <div className="n">
          <small>환산 유불리 최대</small>
          {best !== undefined ? <b className={`num big ${best >= 0.1 ? "up" : best <= -0.1 ? "down" : "even"}`}>{best > 0 ? "+" : ""}{best.toFixed(2)}%p</b> : <span className="need">판단 보류</span>}
        </div>
        <div className="n">
          <small>비교한 모집단위</small>
          <b className="num big">
            {s.reviewed_offerings}
            <i> / {s.total_offerings}</i>
          </b>
        </div>
      </div>

      <Link className="sc-toggle" href={toggle} scroll={false} aria-expanded={open}>
        {open ? "학과별 지원 범위 접기" : `학과별 지원 범위 보기 (${s.offerings.length})`}
        <ChevronIcon />
      </Link>

      {open && (
        <div className="sc-rows">
          <div className="sc-rhd" aria-hidden="true">
            <span>학과 · 전형</span>
            <span>군</span>
            <span className="r">내 환산점수</span>
            <span>지원가능성</span>
            <span className="r">환산 유불리</span>
            <span />
          </div>
          <ul>
            {s.offerings.map(({ offering: o, analysis: a }) => (
              <li key={o.offering_id} className={`sc-row${a.support.status === "ineligible" ? " inel" : ""}`}>
                <div className="line">
                  <Link className="u" href={`${p3}?university=${encodeURIComponent(o.university.name)}&unit=${encodeURIComponent(o.unit_name)}&open=${o.offering_id}#${o.offering_id}`}>
                    <b>{o.unit_name}</b>
                    <small>{o.admission_name}</small>
                  </Link>
                  <span className="c-grp"><span className="grp">{o.group}</span></span>
                  <span className="c-score r"><ScoreCell a={a} /></span>
                  <span className="c-st"><SupportBadge status={a.support.status} /></span>
                  <span className="c-adv r"><AdvantageCell a={a} /></span>
                  <span className="c-pick"><PickButton id={o.offering_id} on={picked.has(o.offering_id)} /></span>
                </div>
                <p className="why">{a.support.reason}</p>
                <StatsLine s={stats.get(o.offering_id)} />
              </li>
            ))}
          </ul>
          <p className="sc-note">
            {s.reviewed_offerings < s.total_offerings && (
              <>
                이 학교의 다른 모집단위 <b className="num">{s.total_offerings - s.reviewed_offerings}</b>곳은 아직 비교하지 못했습니다. 비교하지 못한 곳을 여유로 보지 않습니다.{" "}
              </>
            )}
            학과 이름을 누르면 전체 대학·학과 가능성 보기에서 모집 정보와 지난 기준을 자세히 봅니다. 추천·담음 인원은 이 서비스 안의 집계이며 실제 지원자 수가 아닙니다.
          </p>
        </div>
      )}
    </article>
  );
}
