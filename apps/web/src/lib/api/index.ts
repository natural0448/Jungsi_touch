import "server-only";
import { supabaseConfig, supabaseServer } from "@/lib/supabase/server";
import { liveSource } from "./live";
import { ConnectionError, type Caller, type JungsiSource } from "./source";
import { syntheticSource } from "./synthetic";

/*
  연결 방식(DEV-006 mode_rules + 로컬_검증_연결 frontend_connection)
  - JUNGSI_API_MODE=synthetic : 명시적으로 고른 화면 제작·검토용 합성 응답
  - JUNGSI_API_MODE=live      : 우리 서비스 API(JUNGSI_API_URL)와 에듀터치 Supabase 로그인
  - JUNGSI_API_MODE=local     : 담당자의 로컬 검증 서버(127.0.0.1 전용)와 발급받은 시험 사용자 토큰.
                                localhost 화면은 에듀터치 로그인 쿠키를 받을 수 없으므로, Git 제외
                                설정의 토큰을 이 서버 전용 모듈에서만 쓴다(브라우저에 내보내지 않는다).
  - 값이 없거나 그 방식의 설정이 빠졌으면 '연결 설정 대기'. 합성 응답이나 일반 회원으로 대신하지 않는다.
  실서버가 실패해도 합성 응답으로 바꾸지 않는다(live.ts 가 ConnectionError 를 던진다).
*/

export type ApiMode = "synthetic" | "live" | "local" | "unconfigured";

/** local 방식은 loopback 주소만 허용한다(로컬 검증 서버의 bind·Host·Origin 검사와 같은 경계) */
const LOOPBACK = /^http:\/\/(127(\.\d{1,3}){3}|localhost|\[::1\])(:\d+)?$/;

/**
 * 로컬 검증용 시험 사용자 토큰. 담당자 issue 명령으로 받은 값을 Git 제외 .env.local 에만 둔다.
 * JUNGSI_LOCAL_ROLE(general·paid·editor·approver)이 있으면 역할별 토큰(JUNGSI_LOCAL_TOKEN_PAID 등)을
 * 고르고, 없으면 JUNGSI_LOCAL_TOKEN 하나를 쓴다. 화면은 토큰을 해석하거나 역할·등급을 정하지
 * 않는다(로컬 서버의 allowlist 가 만료·미등록·역할을 판단한다).
 */
function localToken(): string | null {
  const role = process.env.JUNGSI_LOCAL_ROLE?.toUpperCase();
  const byRole = role ? process.env[`JUNGSI_LOCAL_TOKEN_${role}`] : undefined;
  return byRole ?? process.env.JUNGSI_LOCAL_TOKEN ?? null;
}

export function apiMode(): ApiMode {
  const m = process.env.JUNGSI_API_MODE;
  if (m === "synthetic") return "synthetic";
  if (m === "live" && process.env.JUNGSI_API_URL && supabaseConfig()) return "live";
  if (m === "local" && LOOPBACK.test(process.env.JUNGSI_API_URL ?? "") && localToken()) return "local";
  return "unconfigured";
}

/** 무엇이 빠졌는지(화면 안내용). 값 자체는 보이지 않는다 */
export function missingConfig(): string[] {
  const out: string[] = [];
  const m = process.env.JUNGSI_API_MODE;
  if (m !== "synthetic" && m !== "live" && m !== "local") out.push("JUNGSI_API_MODE");
  if (m === "live") {
    if (!process.env.JUNGSI_API_URL) out.push("JUNGSI_API_URL");
    if (!supabaseConfig()) out.push("NEXT_PUBLIC_SUPABASE_URL·NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (m === "local") {
    if (!LOOPBACK.test(process.env.JUNGSI_API_URL ?? "")) out.push("JUNGSI_API_URL(127.0.0.1 로컬 주소)");
    if (!localToken()) out.push("JUNGSI_LOCAL_TOKEN(또는 JUNGSI_LOCAL_ROLE 의 역할별 토큰)");
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
  return mode === "synthetic" ? syntheticSource : mode === "live" || mode === "local" ? liveSource : unconfiguredSource;
}

/**
 * 지금 요청의 사용자.
 * - live  : 에듀터치와 같은 Supabase 쿠키에서 access token 을 꺼내 우리 API 에 전달만 한다.
 * - local : Git 제외 설정의 시험 사용자 토큰을 전달한다. 이 함수는 서버에서만 돌고(server-only),
 *           토큰은 화면 props·클라이언트 컴포넌트로 내려보내지 않는다.
 * 화면은 토큰을 해석하거나 회원 등급을 정하지 않는다(서버가 검증).
 */
export async function getCaller(): Promise<Caller> {
  const mode = apiMode();
  if (mode === "local") return { accessToken: localToken() };
  if (mode !== "live") return { accessToken: null };
  const supabase = await supabaseServer();
  if (!supabase) return { accessToken: null };
  const { data } = await supabase.auth.getSession();
  return { accessToken: data.session?.access_token ?? null };
}

export { AccessDenied, ConnectionError } from "./source";
export type { Caller, ForecastRevisionRef, JungsiSource, OfferingSearchQuery, Result, StatusScanRequest } from "./source";

/** 화면 첫머리의 로그인 상태. 연결이 안 되면 down 으로 돌려 화면이 연결 대기를 그리게 한다 */
export async function sessionOrDown(src: JungsiSource, caller: Caller) {
  try {
    return { session: await src.getSession(caller), down: null };
  } catch (e) {
    if (e instanceof ConnectionError) return { session: null, down: e };
    throw e;
  }
}
