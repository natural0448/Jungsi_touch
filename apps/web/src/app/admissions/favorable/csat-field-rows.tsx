"use client";

import { StarButton } from "@/components/star-button";
import { CsatBadge } from "@/components/csat-badge";
import type { ReferenceBandDto } from "@/lib/dto";
import { csatUpper } from "@/lib/provisional-view";

/** 계열 하나의 학과 줄(가채점 7단계). 2026-11-28 속도(대표님 승인 ㉡): 서버가 줄 모양(화면 조각)을 미리 만들어 보내면
 *  접힌 계열 약 930줄이 문서 785KB를 차지했다(전문가용 ②). 가벼운 자료만 보내고 펼칠 때 브라우저가 그린다 */
export interface CsatFieldRow {
  id: string;
  department: string;
  sub: string;
  name: string;
  band: ReferenceBandDto | null;
  fav: boolean;
}
export function CsatFieldRows({ rows, stars }: { rows: CsatFieldRow[]; stars: boolean }) {
  return (
    <ul>
      {rows.map((r) => {
        const upper = r.band ? csatUpper(r.band) : null;
        return (
          // 범위 판정이면 학과 줄에 범위임을 한 번 더 적는다(배지는 '적정~소신')
          <li key={r.id}>
            <span className="u">
              <b>{r.department}</b>
              <small>{r.sub}</small>
            </span>
            <span className="rf-m">
              <CsatBadge band={r.band} id={r.id} />
              {r.band && upper && <small className="rf-adv">가채점 점수 범위에 따른 판정</small>}
            </span>
            {stars && <StarButton id={r.id} on={r.fav} name={r.name} />}
          </li>
        );
      })}
    </ul>
  );
}
