/**
 * 화면 내용을 불러오는 동안의 안내. 머리글·탭(레이아웃)은 먼저 보이고 이 자리만 결과로 바뀐다.
 * 정시 API 는 요청마다 2초 안팎이 걸리고 1페이지는 여러 번 순서대로 부르므로(동시 호출 상한) 빈 화면이 길었다(2026-10-18).
 * 결과를 지어내지 않는다 — 자리만 잡고 숫자·학교 이름은 넣지 않는다.
 */
export default function Loading() {
  return (
    <div className="wrap pg-body jt-loading" role="status" aria-live="polite">
      <div className="jt-loading-card">
        <span className="jt-spinner" aria-hidden="true" />
        <div>
          <p className="jt-loading-title">자료를 불러오고 있습니다</p>
          <p className="jt-loading-desc">대학 발표 결과와 내 성적 분석을 확인하는 중입니다. 몇 초에서 20초 정도 걸릴 수 있습니다.</p>
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
