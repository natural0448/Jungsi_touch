import "server-only";
import { supabaseConfig, supabaseServer } from "@/lib/supabase/server";
import { liveSource } from "./live";
import { ConnectionError, type Caller, type JungsiSource } from "./source";
import { syntheticSource } from "./synthetic";

/*
  연결 방식(DEV-006 mode_rules)
  - JUNGSI_API_MODE=synthetic : 명시적으로 고른 화면 제작·검토용 합성 응답
  - JUNGSI_API_MODE=live      : 우리 서비스 API(JUNGSI_API_URL)와 에듀터치 Supabase 로그인
  - 값이 없거나 live 설정이 빠졌으면 '연결 설정 대기'. 합성 응답이나 일반 회원으로 대신하지 않는다.
  실서버가 실패해도 합성 응답으로 바꾸지 않는다(live.ts 가 ConnectionError 를 던진다).
*/

export type ApiMode = "synthetic" | "live" | "unconfigured";

export function apiMode(): ApiMode {
  const m = process.env.JUNGSI_API_MODE;
  if (m === "synthetic") return "synthetic";
  if (m === "live" && process.env.JUNGSI_API_URL && supabaseConfig()) return "live";
  return "unconfigured";
}

/** 무엇이 빠졌는지(화면 안내용). 값 자체는 보이지 않는다 */
export function missingConfig(): string[] {
  const out: string[] = [];
  const m = process.env.JUNGSI_API_MODE;
  if (m !== "synthetic" && m !== "live") out.push("JUNGSI_API_MODE");
  if (m === "live") {
    if (!process.env.JUNGSI_API_URL) out.push("JUNGSI_API_URL");
    if (!supabaseConfig()) out.push("NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return out;
}

/** 설정이 없을 때: 모든 요청이 연결 대기로 끝난다 */
const unconfiguredSource = new Proxy({ kind: "live" } as JungsiSource, {
  get(target, prop) {
    if (prop === "kind") return target.kind;
    return () => Promise.reject(new ConnectionError("unconfigured", "api_connection_not_configured"));
  },
});

export function source(): JungsiSource {
  const mode = apiMode();
  return mode === "synthetic" ? syntheticSource : mode === "live" ? liveSource : unconfiguredSource;
}

/**
 * 지금 요청의 사용자. 에듀터치와 같은 Supabase 쿠키에서 access token 을 꺼내 우리 API 에 전달만 한다.
 * 화면은 토큰을 해석하거나 회원 등급을 정하지 않는다(서버가 /auth/v1/user 로 검증).
 */
export async function getCaller(): Promise<Caller> {
  if (apiMode() !== "live") return { accessToken: null };
  const supabase = await supabaseServer();
  if (!supabase) return { accessToken: null };
  const { data } = await supabase.auth.getSession();
  return { accessToken: data.session?.access_token ?? null };
}

export { AccessDenied, ConnectionError } from "./source";
export type { Caller, ForecastRevisionRef, JungsiSource, OfferingSearchQuery, Result } from "./source";

/** 화면 첫머리의 로그인 상태. 연결이 안 되면 down 으로 돌려 화면이 연결 대기를 그리게 한다 */
export async function sessionOrDown(src: JungsiSource, caller: Caller) {
  try {
    return { session: await src.getSession(caller), down: null };
  } catch (e) {
    if (e instanceof ConnectionError) return { session: null, down: e };
    throw e;
  }
}
