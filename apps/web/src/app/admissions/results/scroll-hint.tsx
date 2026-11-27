"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
  표가 화면보다 넓을 때(주로 휴대폰) 옆으로 넘길 수 있다는 것을 알린다(2026-11-02 사용자 승인).
  넘칠 때만 안내 한 줄을 보이고, 아직 남은 쪽 가장자리에 그림자를 둔다. 학년도 열 고정은 results.css.
*/
export function ScrollHint({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ over: false, left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdge({ over: max > 1, left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return (
    <>
      {edge.over && <p className="rs-swipe" aria-hidden="true">표를 옆으로 넘기면 나머지 칸이 보입니다 →</p>}
      <div className={`rs-scroll${edge.right ? " more-r" : ""}${edge.left ? " more-l" : ""}`}>
        <div ref={ref} className="tblwrap">{children}</div>
      </div>
    </>
  );
}
