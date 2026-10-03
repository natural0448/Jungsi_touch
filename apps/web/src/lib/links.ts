/**
 * 에듀터치 본체(같은 도메인, /jeongsi 밖)로 가는 주소. next/link 는 basePath(/jeongsi)를 붙이므로
 * 본체로 갈 때는 이 함수로 만든 주소를 <a> 에 쓴다.
 */
export function edutouch(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** 에듀터치 로그인. 끝나면 정시터치의 그 화면으로 돌아온다 */
export function loginHref(jungsiPath: string): string {
  return edutouch(`/login?next=${encodeURIComponent(`/jeongsi${jungsiPath}`)}`);
}
