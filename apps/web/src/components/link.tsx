import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * 정시터치 공용 링크: 기본으로 미리 불러오기(prefetch)를 끈다(2026-10-20).
 * 화면에 보이는 링크를 Next 가 미리 불러올 때마다 서버가 정시터치 API(회원 확인 등)를 불러, 계정 동시 처리 한도
 * (일반 1·유료 2)를 사람이 누르지도 않은 요청이 차지했다 — 3페이지 한 번에 지역·모집군 칩 등 20건 넘게 관측.
 * 꼭 미리 불러와야 하는 곳은 prefetch 를 직접 넘긴다.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
