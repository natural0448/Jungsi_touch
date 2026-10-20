import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/*
  회원끼리 함께 쓰는 짧은 조회 저장(2026-10-20 사용자 결정, 고객 대기 시간 단축).
  대상은 개인 정보가 없는 공개 발표 자료 조회 결과뿐이다 — 개인 성적·리포트·커서·토큰은 넣지 않는다.
  1단: 이 워커 인스턴스 메모리(빠르지만 인스턴스마다 따로) / 2단: Cloudflare KV(JT_SHARED_CACHE, 인스턴스끼리 공유).
  호출하는 쪽이 회원 확인(session)을 먼저 끝낸 뒤에만 쓴다. 저장 실패는 조회 실패로 만들지 않는다.
*/

type Kv = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

const MEM_MAX = 64;
const mem = new Map<string, { until: number; value: unknown }>();

async function kv(): Promise<Kv | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ((env as Record<string, unknown>).JT_SHARED_CACHE as Kv | undefined) ?? null;
  } catch {
    return null; // 로컬 개발(next dev) 등 워커 밖에서는 메모리 저장만 쓴다
  }
}

export async function cacheKey(parts: unknown): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * key 로 저장본이 있으면 돌려주고, 없으면 load() 를 불러 keep 이 참일 때만 ttl 초 동안 저장한다.
 * load 가 던진 예외는 그대로 올린다(오류는 저장하지 않는다).
 */
export async function sharedCached<T>(key: string, ttlSec: number, load: () => Promise<{ value: T; keep: boolean }>): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const store = await kv();
  if (store) {
    try {
      const v = (await store.get(key, "json")) as { until: number; value: T } | null;
      if (v && v.until > now) {
        remember(key, v.until, v.value);
        return v.value;
      }
    } catch {
      /* KV 읽기 실패는 원래 조회로 넘어간다 */
    }
  }
  const { value, keep } = await load();
  if (keep) {
    const until = now + ttlSec * 1000;
    remember(key, until, value);
    if (store) {
      try {
        await store.put(key, JSON.stringify({ until, value }), { expirationTtl: Math.max(60, ttlSec) });
      } catch {
        /* 저장 실패는 무시 — 다음 요청이 다시 조회한다 */
      }
    }
  }
  return value;
}

function remember(key: string, until: number, value: unknown) {
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value as string);
  mem.set(key, { until, value });
}
