import Link from "next/link";
import type { ShortlistItem } from "@/lib/contract";
import { page } from "@/lib/routes";

/** 핵심 지원 학교 띠. 3·4페이지가 같은 목록을 보여 주고 2페이지 리포트로 잇는다 */
export function ShortlistTray({ items, other }: { items: ShortlistItem[]; other: "PAGE-03" | "PAGE-04" }) {
  const to = page(other);
  return (
    <div className="tray">
      <div className="wrap">
        <div className="in">
          <span className="t">
            핵심 지원 학교 <b className="num">{items.length}</b>
          </span>
          <span className="names">
            {items.length ? (
              items.map((s) => <span key={s.offering_id}>{s.university_name.replace(/^예시/, "")} {s.unit_name}</span>)
            ) : (
              <span className="none">담은 곳이 없습니다. 담기를 누르세요.</span>
            )}
          </span>
          <Link className="btn" href={to.path}>{to.label}에서도 같은 목록</Link>
          <Link className="btn p" href={page("PAGE-02").path}>리포트에서 정리</Link>
        </div>
      </div>
    </div>
  );
}
