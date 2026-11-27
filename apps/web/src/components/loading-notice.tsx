import { BookLoading } from "./book-loading";

/**
 * 화면 내용을 불러오는 동안의 안내. 머리글·탭(레이아웃)은 먼저 보이고 이 자리만 결과로 바뀐다.
 * 2026-11-21 대표님 지적: 회색 스켈레톤·빙글 도는 표시를 쓰지 않고, 3페이지와 같은 로고 책 넘김 애니메이션으로 통일한다.
 * 페이지마다 실제로 불러오는 것을 적는다(1페이지는 입시결과만, 2페이지는 내 성적 리포트 …).
 * 결과를 지어내지 않는다 — 숫자·학교 이름은 넣지 않는다.
 */
export function LoadingNotice({ title, desc }: { title: string; desc?: string }) {
  return <BookLoading text={title} sub={desc ?? undefined} />;
}
