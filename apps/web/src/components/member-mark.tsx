import { logContentView, viewerId, type ContentKind } from "@/lib/content-view";

/**
 * 유료 화면 회원 식별 표시(워터마크) + 조회 기록. 유료 데이터를 그린 화면에만 둔다.
 * `ET-` + 회원 id 앞 8자리(대문자) · 한국 시각. 이름·이메일은 넣지 않는다.
 * 관리자는 에듀터치 /admin/members 에서 `ET-…` 로 회원을 찾는다.
 * 화면 전체를 덮는 고정 레이어에 옅게(7%) 비스듬히 반복하고, 클릭을 막지 않으며 인쇄에도 찍힌다.
 */
export async function MemberMark({ kind, path }: { kind: ContentKind; path: string }) {
  const userId = await viewerId();
  if (!userId) return null;
  await logContentView(kind, path);
  const code = `ET-${userId.slice(0, 8).toUpperCase()}`;
  const stamp = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date());
  const text = `${code} · ${stamp}`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='190'>` +
    `<text x='10' y='110' transform='rotate(-24 170 95)' font-family='sans-serif' font-size='14' fill='rgba(15,23,42,0.07)'>${text}</text></svg>`;
  return (
    <div
      aria-hidden
      className="member-mark"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    />
  );
}
