/**
 * 분석 대기 화면(2026-11-18 대표님 요청). 에듀터치 로고의 펼친 책(남색 왼쪽 장·주황 오른쪽 장)에서
 * 오른쪽 장이 왼쪽으로 넘어가는 모양을 SVG 와 CSS 로 그린다(GIF 아님 — 선명하고 가볍다).
 * 결과를 지어내지 않는다 — 숫자·학교 이름은 넣지 않고, 지금 무엇을 하고 있는지만 적는다.
 * kind: favorable = 유리한 대학 찾기, possibilities = 전체 대학·학과 가능성 보기.
 */
// 로고(brand/logo-horizontal.png)의 책장 윤곽을 재서 옮긴 모양: 바깥 모서리는 둥글고, 윗선이 책등 쪽으로 크게 휘어 내려간다
const LEFT_PAGE = "M12 2.5 L58 20 C72 25.5 85 34 85 50 L85 105 L12 76 Q3 72.5 3 64 L3 11 Q3 -0.5 12 2.5 Z";
const RIGHT_PAGE = "M74 2.5 L28 20 C14 25.5 1 34 1 50 L1 105 L74 76 Q83 72.5 83 64 L83 11 Q83 -0.5 74 2.5 Z";

export function BookLoading({ name, kind }: { name: string; kind: "favorable" | "possibilities" }) {
  const who = <b className="jt-book-name">{name} 님</b>;
  return (
    <div className="wrap pg-body jt-book-wait" role="status" aria-live="polite">
      <div className="jt-book" aria-hidden="true">
        <svg className="jt-book-l" viewBox="0 0 86 108" preserveAspectRatio="none"><path fill="currentColor" d={LEFT_PAGE} /></svg>
        <svg className="jt-book-r" viewBox="0 0 86 108" preserveAspectRatio="none"><path fill="currentColor" d={RIGHT_PAGE} /></svg>
        <svg className="jt-book-flip" viewBox="0 0 86 108" preserveAspectRatio="none"><path fill="currentColor" d={RIGHT_PAGE} /></svg>
        <svg className="jt-book-flip jt-book-flip2" viewBox="0 0 86 108" preserveAspectRatio="none"><path fill="currentColor" d={RIGHT_PAGE} /></svg>
      </div>
      {kind === "favorable" ? (
        <p className="jt-book-text">현재 {who}의 성적을 분석하여 {who}의 정시 지원에 유리한 대학을 찾고 있습니다.</p>
      ) : (
        <p className="jt-book-text">현재 {who}의 성적을 분석하여 전국 대학에서 {who}의 정시 가·나·다군 지원에서의 유불리를 분석 중입니다.</p>
      )}
      <p className="jt-book-sub">잠시만 기다려 주세요. 화면을 닫지 않아도 됩니다.</p>
    </div>
  );
}
