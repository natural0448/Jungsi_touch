import "server-only";
import { liveSource } from "./live";
import type { Caller, JungsiSource } from "./source";
import { syntheticSource } from "./synthetic";

/**
 * JUNGSI_API_MODE=synthetic | live (wrangler.jsonc vars)
 * 애플리케이션 계층의 HTTP 핸들러가 연결되면 live 로 바꾼다. 값이 없으면 합성 응답.
 */
export function source(): JungsiSource {
  return process.env.JUNGSI_API_MODE === "live" ? liveSource : syntheticSource;
}

/**
 * 지금 요청의 사용자. 에듀터치 Supabase 로그인 세션에서 access token 을 읽어 API 에 전달한다.
 * 세션 읽기는 live 연결 때 붙인다(PR #5 의 Supabase Auth 세션 공유 제안 승인 후).
 * 화면은 토큰을 해석하거나 DB 를 조회하지 않는다.
 */
export async function getCaller(): Promise<Caller> {
  return { accessToken: null };
}

export { AccessDenied } from "./source";
export type { Caller, JungsiSource, OfferingSearchQuery, Result } from "./source";
