/*
  로그인 쿠키의 주인은 에듀터치 본체다. 본체 proxy 가 /jeongsi 를 넘기기 전에 토큰을 갱신해 새 쿠키를
  실어 보내므로, 정시터치는 쿠키를 읽기만 하고 갱신·삭제하지 않는다.

  2026-10-16 live 첫 연결에서 정시터치 proxy 도 갱신하다가, 한 화면의 미리 불러오기 10여 건이 동시에
  /token 을 불러 Supabase 가 429(over_request_rate_limit)로 거절했다. 갱신에 실패한 라이브러리가
  세션 쿠키를 지우는 Set-Cookie 를 내보내 에듀터치 로그인까지 풀렸다. 그래서 갱신 요청 자체를 막는다.
*/

const REFRESH = /\/auth\/v1\/token\?grant_type=refresh_token/;

/** refresh_token 교환만 네트워크로 보내지 않는다. 나머지(getUser·profiles 조회)는 그대로 */
export const noRefreshFetch: typeof fetch = (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (REFRESH.test(href)) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "refresh_disabled", error_description: "session is owned by edutouch" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  return fetch(input, init);
};

/** 쿠키를 쓰지 않는다 — 갱신 실패 때 라이브러리가 보내는 삭제도 막힌다 */
export function ignoreCookieWrites() {}
