import "server-only";
import { headers } from "next/headers";
import { apiMode } from "@/lib/api";
import { supabaseServer } from "@/lib/supabase/server";

/*
  유료 화면의 회원 식별 표시와 조회 기록(2026-10-16 최종 관리자 결정, 에듀터치 요청
  "정시터치-요청-회원식별표시_조회기록-20261016.md"). 자료 유출·무단 도용이 생겼을 때 어느 계정에서
  나왔는지 확인하려는 것이다.
  - 회원 id 는 에듀터치 로그인 쿠키에서 읽기만 한다(갱신·쓰기 없음, lib/supabase/read-only.ts).
  - 기록은 회원 본인 세션으로 에듀터치 DB 함수 log_content_view 를 부른다. 실패해도 화면은 그대로 보인다.
  - live 모드에서만 동작한다(합성·로컬 시험 모드에는 에듀터치 회원이 없다).
*/

export type ContentKind = "analysis" | "possibility" | "recommend" | "report";

/**
 * 지금 요청의 에듀터치 회원 id. 없거나 live 가 아니면 null.
 * 쿠키를 풀어 읽은 값(getSession)은 쿠키 안 사용자 정보를 바꿔 넣을 수 있으므로 쓰지 않는다 — Supabase Auth 가
 * 토큰을 확인해 돌려준 사용자(getUser)만 쓴다(담당자 독립 검토 P2, 2026-10-21). 토큰 갱신은 하지 않는다
 */
export async function viewerId(): Promise<string | null> {
  if (apiMode() !== "live") return null;
  try {
    const supabase = await supabaseServer();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 유료 데이터를 응답한 화면 하나에 한 번 남긴다. 링크 미리 불러오기(prefetch)는 사람이 연 화면이 아니므로 남기지 않는다.
 * 경로는 300자로 자른다. 오류는 무시한다.
 */
export async function logContentView(kind: ContentKind, path: string): Promise<void> {
  if (apiMode() !== "live") return;
  try {
    const h = await headers();
    if (h.get("next-router-prefetch") || h.get("purpose") === "prefetch") return;
    const supabase = await supabaseServer();
    if (!supabase) return;
    await supabase.rpc("log_content_view", {
      p_app: "jeongsi",
      p_path: path.slice(0, 300),
      p_kind: kind,
      p_ip: visitorIp(h),
      p_user_agent: h.get("user-agent"),
    });
  } catch {
    // 기록 실패로 유료 화면을 막지 않는다
  }
}

/*
  방문자 IP. 에듀터치 본체 프록시를 거치면 cf-connecting-ip 는 Cloudflare 내부 주소가 된다(2026-10-16 실측 2a06:98c0:…).
  본체는 원래 방문자 IP 를 x-edutouch-client-ip 로 덮어써 넘긴다(에듀터치 PR #210). 워커 주소로 직접 온 요청은
  누구나 이 헤더를 넣을 수 있으므로 두 조건이 모두 맞을 때만 믿는다(담당자 독립 검토 P2, 2026-10-21 보완):
  ① cf-connecting-ip 가 Cloudflare 주소(워커가 넘긴 요청) ② CF-Worker 가 edutouch.co.kr — Cloudflare 가 워커의 하위 요청에
  그 워커의 영역 이름으로 붙이는 표지라 다른 영역의 워커는 이 값을 만들 수 없다(2026-10-21 운영 기록 52/52 확인).
  B단계(edutouch.co.kr/jeongsi* 라우트를 이 워커에 직결)가 되면 cf-connecting-ip 가 다시 방문자 IP 이므로 헤더 읽기를 뺀다.
*/
const CF_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const CF_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

function v4(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((a, x) => a * 256 + Number(x), 0);
}
/** IPv6 → 16비트 묶음 8개. 형식이 틀리면 null */
function v6(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || (ip.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const groups = tail === null ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}
/** 앞 bits 비트가 같은지 */
function samePrefix6(x: number[], y: number[], bits: number): boolean {
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((x[i] & mask) !== (y[i] & mask)) return false;
  }
  return true;
}
export function isCloudflareIp(ip: string): boolean {
  const n4 = v4(ip);
  if (n4 !== null) {
    return CF_V4.some((c) => {
      const [base, bits] = c.split("/");
      const size = 2 ** (32 - Number(bits));
      return Math.floor(n4 / size) === Math.floor((v4(base) as number) / size);
    });
  }
  const n6 = v6(ip);
  if (n6 === null) return false;
  return CF_V6.some((c) => {
    const [base, bits] = c.split("/");
    return samePrefix6(n6, v6(base) as number[], Number(bits));
  });
}
/** 방문자 IP 를 넘겨도 되는 본체 워커의 영역 */
const EDUTOUCH_ZONE = "edutouch.co.kr";
export function visitorIp(h: Headers): string | null {
  const cf = h.get("cf-connecting-ip")?.trim() || null;
  const forwarded = h.get("x-edutouch-client-ip")?.trim() || null;
  if (cf && forwarded && isCloudflareIp(cf) && h.get("cf-worker")?.trim().toLowerCase() === EDUTOUCH_ZONE) return forwarded;
  return cf ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** 페이지 쿼리 → 기록용 경로 문자열 */
export function viewPath(route: string, sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  const s = q.toString();
  return `/jeongsi${route === "/" ? "" : route}${s ? `?${s}` : ""}`;
}
