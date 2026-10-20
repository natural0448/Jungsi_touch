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
const mem = new Map<string, Entry<unknown>>();

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

type Entry<T> = { fresh: number; stale: number; value: T };
const refreshing = new Set<string>();

/**
 * key 로 저장본을 돌려준다. 신선(freshSec 이내)하면 그대로, 오래됐지만 보관 기간(staleSec) 안이면 **먼저 돌려주고**
 * 뒤에서 load() 로 새로 받아 바꿔 둔다(같은 인스턴스에서 같은 key 는 한 번만). 저장본이 없으면 load() 를 기다린다.
 * keep 이 거짓인 결과(오류 뒤 일부·미발행)는 저장하지 않는다. load 가 던진 예외는 저장본이 없을 때만 올린다.
 */
export async function sharedCached<T>(
  key: string,
  freshSec: number,
  staleSec: number,
  load: () => Promise<{ value: T; keep: boolean }>,
): Promise<T> {
  const now = Date.now();
  const store = await kv();
  let entry = mem.get(key) as Entry<T> | undefined;
  if ((!entry || entry.stale <= now) && store) {
    try {
      entry = ((await store.get(key, "json")) as Entry<T> | null) ?? undefined;
      if (entry) remember(key, entry);
    } catch {
      /* KV 읽기 실패는 원래 조회로 넘어간다 */
    }
  }
  const save = async (r: { value: T; keep: boolean }) => {
    if (!r.keep) return;
    const at = Date.now();
    const e: Entry<T> = { fresh: at + freshSec * 1000, stale: at + staleSec * 1000, value: r.value };
    remember(key, e);
    if (store) {
      try {
        await store.put(key, JSON.stringify(e), { expirationTtl: Math.max(60, staleSec) });
      } catch {
        /* 저장 실패는 무시 — 다음 요청이 다시 조회한다 */
      }
    }
  };
  if (entry && entry.stale > now) {
    if (entry.fresh <= now && !refreshing.has(key)) {
      refreshing.add(key);
      const job = load()
        .then(save)
        .catch(() => undefined)
        .finally(() => refreshing.delete(key));
      await background(job);
    }
    return entry.value;
  }
  const r = await load();
  await save(r);
  return r.value;
}

/** 응답을 돌려준 뒤에도 워커가 작업을 마치게 한다(waitUntil). 워커 밖(로컬 개발)에서는 기다리지 않고 흘려보낸다 */
async function background(job: Promise<unknown>) {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    (ctx as { waitUntil(p: Promise<unknown>): void }).waitUntil(job);
  } catch {
    void job;
  }
}

function remember(key: string, e: Entry<unknown>) {
  if (mem.size >= MEM_MAX && !mem.has(key)) mem.delete(mem.keys().next().value as string);
  mem.set(key, e);
}
