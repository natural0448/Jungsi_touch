"use client";

/** 브라우저 인쇄 창을 연다. 인쇄·PDF 저장 렌더링은 프레젠테이션 담당(API_DTO 계약 snapshot) */
export function PrintButton() {
  return (
    <button className="btn p" type="button" onClick={() => window.print()}>
      인쇄 · PDF로 저장
    </button>
  );
}
