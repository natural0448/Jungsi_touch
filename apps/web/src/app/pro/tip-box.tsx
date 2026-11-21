import type { Category } from "@/lib/dto";
import type { ProReason } from "@/lib/pro-dto";
import { GRADE_RUMOR_NOTE, tipLine, tipTitle } from "@/lib/pro-tips";

/*
  모집단위 하나의 '왜 이 분류인가' 상자. 접힌 상태에서 제목과 근거 수만 보이고, 펼치면 영향이 큰 근거 3개,
  나머지는 '이유 더 보기'로 한 번 더 접는다. 보류 근거(동등화 전 비교 등)는 맨 아래 안내로만 보인다.
*/
export function TipBox({ reasons, category }: { reasons: ProReason[] | undefined; category: Category }) {
  const lines = (reasons ?? []).flatMap((r) => {
    const l = tipLine(r);
    return l ? [{ r, l }] : [];
  });
  const ready = lines.filter((x) => x.r.status === "ready");
  const pending = lines.filter((x) => x.r.status !== "ready");
  if (ready.length === 0) return null;
  const sources = [...new Map(ready.flatMap((x) => x.r.public_basis).map((b) => [b.title, b])).values()];
  const item = ({ l }: (typeof ready)[number], i: number) => (
    <li key={i}>
      {l.text}
      {l.caution && <span className="pro-tip-caution">{l.caution}</span>}
      {l.ref && <small className="pro-tip-ref">근거 번호 {l.ref}</small>}
    </li>
  );
  return (
    <details className="pro-tip">
      <summary>
        {tipTitle(category)} <small>근거 {ready.length}</small>
      </summary>
      <ol>{ready.slice(0, 3).map(item)}</ol>
      {ready.length > 3 && (
        <details className="pro-tip-more">
          <summary>이유 더 보기 ({ready.length - 3})</summary>
          <ol start={4}>{ready.slice(3).map((x, i) => item(x, i + 3))}</ol>
        </details>
      )}
      {pending.map(({ l }, i) => <p key={i} className="pro-note">{l.text}</p>)}
      <p className="pro-tip-note">{GRADE_RUMOR_NOTE}</p>
      {sources.length > 0 && <p className="pro-tip-src">출처: {sources.map((b) => b.title).join(" · ")}</p>}
    </details>
  );
}
