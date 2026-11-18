import { StarButton } from "@/components/star-button";
import Link from "@/components/link";
import { ChevronIcon } from "@/components/icons";
import { AdvantageCell, CATEGORY, CategoryBadge, EnrichedReasonList, PickButton, ScoreCell } from "@/components/offering-parts";
import { StatsSlot, type StatsPromise } from "@/components/stats-slot";
import type { CandidatesDto, Category } from "@/lib/dto";
import { page } from "@/lib/routes";
import { SchoolReflectedLine } from "@/components/school-reflected";
import { FIELD_UNKNOWN, groupByField } from "@/lib/field-group";
import { hrefWith, type Query } from "./query";

type Group = CandidatesDto["basic_university_groups"][number];

/** 학교 안 학과들 중 가장 큰 환산 유불리(%p). 없으면 null */
export function bestDelta(g: Group): number | null {
  const v = g.offerings.map((o) => (o.assessment.advantage ? Number(o.assessment.advantage.delta_pp) : NaN)).filter((n) => !Number.isNaN(n));
  return v.length ? Math.max(...v) : null;
}

/**
 * 기본 학교 목록의 학교 한 곳(candidates.basic_university_groups 한 묶음).
 * 응답에 학교 분류가 없으므로 학교에 색을 칠하지 않고, 색이 있는 판단은 학과마다 따로 붙인다(REQ-05).
 * '찾은 이유'는 서버가 만든 학과별 이유(recommendation_reasons, 1.7.0)를 그대로 쓰고, 없으면 응답 숫자만으로 적는다.
 */
export function SchoolCard({ g, cur, picked, favs, stats, statsKey }: { g: Group; cur: Query; picked: Set<string>; favs: Set<string> | null; stats: StatsPromise; statsKey: string }) {
  const open = cur.open === g.university_id;
  const counts = new Map<Category, number>();
  for (const o of g.offerings) counts.set(o.assessment.category, (counts.get(o.assessment.category) ?? 0) + 1);
  const best = bestDelta(g);
  const first = g.offerings[0]?.offering;
  // 유불리가 가장 큰 학과의 서버 이유를 학교의 첫 이유로 보인다
  const lead = [...g.offerings].sort((x, y) => Number(y.assessment.advantage?.delta_pp ?? -99) - Number(x.assessment.advantage?.delta_pp ?? -99))[0];
  const leadReasons = lead?.assessment.recommendation_reasons ?? [];
  const toggle = `${hrefWith(cur, { open: open ? undefined : g.university_id, field: undefined })}#${g.university_id}`;
  // 학교 안 학과를 계열로 묶는다(대표님 요청 2026-11-18). 계열을 누르면 그 계열의 학과가 열린다
  const fields = groupByField(g.offerings, (x) => x.offering.offering_id);
  const fieldHref = (label: string) => `${hrefWith(cur, { open: g.university_id, field: open && cur.field === label ? undefined : label })}#${g.university_id}`;
  const p3 = page("PAGE-03").path;

  return (
    <article id={g.university_id} className={`sc${open ? " open" : ""}`} aria-labelledby={`h-${g.university_id}`}>
      <header className="sc-hd">
        <div className="ttl">
          <h3 id={`h-${g.university_id}`}>{g.university_name}</h3>
          {first && <p>{[first.region, first.campus].filter(Boolean).join(" · ")}</p>}
        </div>
      </header>

      <div className="sc-why">
        <span>찾은 이유</span>
        {leadReasons.length > 0 ? (
          <div>
            <b className="lead-unit">{lead.offering.department}</b>
            <EnrichedReasonList a={lead.assessment} max={2} />
          </div>
        ) : best !== null && best > 0 ? (
          `이 학교 환산에서 총점보다 위치가 최대 ${best.toFixed(2)}%p 올라가는 학과가 있습니다.`
        ) : (
          `내 성적으로 지원 검토 범위(도전·핵심·여유)에 드는 학과가 ${g.offerings.length}곳 있습니다.`
        )}
      </div>

      <div className="sc-sum">
        <div className="n">
          <small>학과별 판단</small>
          <div className="mix">
            {(Object.keys(CATEGORY) as Category[])
              .filter((k) => counts.get(k))
              .map((k) => (
                <span key={k} className="mixi">
                  <span className={`st ${CATEGORY[k].cls}`}>{CATEGORY[k].label}</span> <b className="num">{counts.get(k)}</b>
                </span>
              ))}
          </div>
        </div>
        <div className="n">
          <small>환산 유불리 최대</small>
          {best !== null ? <b className={`num big ${best >= 0.1 ? "up" : best <= -0.1 ? "down" : "even"}`}>{best > 0 ? "+" : ""}{best.toFixed(2)}%p</b> : <span className="need">판단 보류</span>}
        </div>
        <div className="n">
          <small>후보 학과</small>
          <b className="num big">{g.offerings.length}</b>
        </div>
      </div>

      <div className="sc-fields" aria-label="계열별 후보 학과">
        <small>계열</small>
        {fields.map((f) => (
          <Link key={f.label} className={`sc-field${open && cur.field === f.label ? " on" : ""}${f.label === FIELD_UNKNOWN ? " none" : ""}`} href={fieldHref(f.label)} scroll={false} aria-expanded={open && cur.field === f.label}>
            {f.label} <b className="num">{f.items.length}</b>
          </Link>
        ))}
        {fields.some((f) => f.provisional) && <span className="sc-fnote">계열은 2025 분류 참고</span>}
      </div>

      <Link className="sc-toggle" href={toggle} scroll={false} aria-expanded={open}>
        {open ? "학과별 지원 범위 접기" : `학과별 지원 범위 보기 (${g.offerings.length})`}
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
          {fields.map((f) => (
            <details key={f.label} className="sc-fg" open={cur.field ? cur.field === f.label : fields.length === 1}>
              <summary>
                <b>{f.label}</b>
                <span className="num">학과 {f.items.length}</span>
                {f.provisional && <small>2025 분류 참고</small>}
              </summary>
          <ul>
            {f.items.map(({ offering: o, assessment: a }) => (
              <li key={o.offering_id} className="sc-row">
                <div className="line">
                  <Link className="u" href={`${p3}?university=${encodeURIComponent(o.university_name)}&unit=${encodeURIComponent(o.department)}&open=${o.offering_id}#${o.offering_id}`}>
                    <b>{o.department}</b>
                    <small>{o.track ?? "일반전형"}</small>
                  </Link>
                  <span className="c-grp"><span className="grp">{o.group}</span></span>
                  <span className="c-score r"><ScoreCell a={a} /></span>
                  <span className="c-st"><CategoryBadge a={a} /></span>
                  <span className="c-adv r"><AdvantageCell a={a} /></span>
                  <span className="c-pick">
                    {favs && <StarButton id={o.offering_id} on={favs.has(o.offering_id)} name={`${o.university_name} ${o.department}`} />}
                    <PickButton id={o.offering_id} on={picked.has(o.offering_id)} />
                  </span>
                </div>
                <SchoolReflectedLine a={a} compact />
                {(a.recommendation_reasons?.length ?? 0) > 0 && <EnrichedReasonList a={a} max={2} />}
                <StatsSlot p={stats} id={o.offering_id} k={statsKey} />
              </li>
            ))}
          </ul>
            </details>
          ))}
          <p className="sc-note">
            계열을 누르면 그 계열의 학과가 열립니다. 별표(☆)한 학과는 {page("PAGE-03").label}의 즐겨찾기에도 그대로 보입니다. 학과 이름을 누르면 {page("PAGE-03").label}에서 판단 이유의 체감 근거(과거 발표값과의 대조)와 모집 정보를 자세히 봅니다. 추천·담음 인원은 이 서비스 안의 집계이며 실제 지원자 수가 아닙니다.
          </p>
        </div>
      )}
    </article>
  );
}
