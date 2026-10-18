/**
 * 화면 내용을 불러오는 동안의 안내. 머리글·탭(레이아웃)은 먼저 보이고 이 자리만 결과로 바뀐다.
 * 페이지마다 실제로 불러오는 것을 적는다(1페이지는 입시결과만, 2페이지는 내 성적 리포트 …).
 * 결과를 지어내지 않는다 — 자리만 잡고 숫자·학교 이름은 넣지 않는다.
 */
export function LoadingNotice({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="wrap pg-body jt-loading" role="status" aria-live="polite">
      <div className="jt-loading-card">
        <span className="jt-spinner" aria-hidden="true" />
        <div>
          <p className="jt-loading-title">{title}</p>
          <p className="jt-loading-desc">{desc}</p>
        </div>
      </div>
      <div className="jt-skel" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
