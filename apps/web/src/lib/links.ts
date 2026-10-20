/**
 * 에듀터치 본체(같은 도메인, /jeongsi 밖)로 가는 주소. next/link 는 basePath(/jeongsi)를 붙이므로
 * 본체로 갈 때는 이 함수로 만든 주소를 <a> 에 쓴다.
 */
export function edutouch(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * 이용권 구매는 에듀터치 본체가 맡는다(2026-10-15 에듀터치 결제 체계). 가격·환불·보호자 동의 안내가
 * 그 화면에 있으므로 정시터치는 가격 숫자를 적지 않고 안내 화면으로 보낸다. 로그아웃 상태여도
 * 본체가 로그인 뒤 같은 화면으로 돌려보낸다.
 */
export const PASS_HREF = edutouch("/pass");

/** 에듀터치 로그인. 끝나면 정시터치의 그 화면으로 돌아온다 */
export function loginHref(jungsiPath: string): string {
  return edutouch(`/login?next=${encodeURIComponent(`/jeongsi${jungsiPath}`)}`);
}

/** 고객센터(성적 정정 요청 등). 에듀터치 본체의 기존 문의 접수 화면을 쓴다 — 새 주소를 만들지 않는다 */
export const SUPPORT_HREF = edutouch("/contact");
