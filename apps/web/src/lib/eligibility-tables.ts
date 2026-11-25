/**
 * 지원 필수 조건 표(담당자 v36 A1 92행)와 정식 판정 우선 105개 모집단위 지원자격 표(담당자 v38·v45 formal105).
 * 담당자 지시(v45, 2026-11-20): 명부는 저장소·브라우저 번들·공개 DTO에 넣지 않는다 → 화면 서버 KV(ELIGIBILITY_TABLES_KEY)에만 둔다.
 * 서버 코드(리포트 읽기)에서 한 번 읽어 이 isolate 안에 잠시 기억한다. 못 읽거나 형식이 어긋나면 빈 표로 본다
 * (그러면 '지원 조건 미충족'·105곳 안내가 붙지 않을 뿐, 서버 판정은 그대로다).
 */
export const ELIGIBILITY_TABLES_KEY = "eligibility-conditions:v1";
export const ELIGIBILITY_TABLES_FORMAT = "jungsi.eligibility-conditions/v1";

/** m: 수학 지정 선택과목, d·n: 인정 탐구 영역과 그 안의 최소 응시 과목 수, s: 과학 최소 과목 수, x: 같은 과학 Ⅰ·Ⅱ 조합 금지, g: 지역인재 증빙 */
export type RequiredCondition = { m?: string[]; d?: string[]; n?: number; s?: number; x?: 1 };
export type Formal105Condition = { d?: string[]; n?: number; g?: 1 };
export type EligibilityTables = { required: Readonly<Record<string, RequiredCondition>>; formal105: Readonly<Record<string, Formal105Condition>> };

const EMPTY: EligibilityTables = { required: {}, formal105: {} };
const PK = /^2027:[0-9]{1,12}$/;
const DOMAINS = new Set(["사회", "과학", "직업"]);
const TTL_MS = 10 * 60_000;
const MAX_ROWS = 5000;

let current: EligibilityTables = EMPTY;
let loadedAt = 0;

const strList = (v: unknown, ok: (s: string) => boolean) => Array.isArray(v) && v.length > 0 && v.length <= 10 && v.every((s) => typeof s === "string" && ok(s));
const smallInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4;

function checkRow(v: unknown, allowed: readonly string[]): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!allowed.includes(k)) return false;
  if (o.m !== undefined && !strList(o.m, (s) => s.length <= 20)) return false;
  if (o.d !== undefined && !strList(o.d, (s) => DOMAINS.has(s))) return false;
  if (o.n !== undefined && !smallInt(o.n)) return false;
  if (o.s !== undefined && !smallInt(o.s)) return false;
  if (o.x !== undefined && o.x !== 1) return false;
  if (o.g !== undefined && o.g !== 1) return false;
  return true;
}

/** KV 문자열을 검사해 표로 바꾼다. 하나라도 어긋나면 null(표 전체를 쓰지 않는다) */
export function parseEligibilityTables(text: string | null): EligibilityTables | null {
  if (text === null) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const { format, required, formal105 } = doc as Record<string, unknown>;
  if (format !== ELIGIBILITY_TABLES_FORMAT) return null;
  const table = (t: unknown, allowed: readonly string[]) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return null;
    const e = Object.entries(t as Record<string, unknown>);
    if (e.length > MAX_ROWS || e.some(([k, v]) => !PK.test(k) || !checkRow(v, allowed))) return null;
    return Object.fromEntries(e);
  };
  const r = table(required, ["m", "d", "n", "s", "x"]), f = table(formal105, ["d", "n", "g"]);
  return r && f ? { required: r as EligibilityTables["required"], formal105: f as EligibilityTables["formal105"] } : null;
}

/** 지금 기억한 표(아직 못 읽었으면 빈 표) */
export function eligibilityTables(): EligibilityTables {
  return current;
}

/** 시험용: 표를 직접 넣는다 */
export function setEligibilityTablesForTest(t: EligibilityTables | null): void {
  current = t ?? EMPTY;
  loadedAt = t ? Date.now() : 0;
}

/**
 * 리포트를 읽기 전에 부른다. 10분 안에 읽은 적이 있으면 다시 읽지 않는다. 실패는 조용히 지난 표(없으면 빈 표)를 둔다.
 * 2026-11-25: 진행 중인 읽기 하나를 여러 요청이 함께 기다리지 않는다. Cloudflare Workers 는 다른 요청이 시작한 I/O 를
 * 기다리는 요청을 깨우지 못해 'Worker's code had hung'으로 끊는다(11-24 12:51·21:30, 11-25 15:52 운영 1·3페이지 3건).
 * 요청마다 각자 읽고(KV 한 번, 가볍다), 3초 넘게 걸리면 기다리지 않는다.
 */
export async function ensureEligibilityTables(): Promise<void> {
  if (loadedAt && Date.now() - loadedAt < TTL_MS) return;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = (await getCloudflareContext({ async: true })).env as Record<string, unknown>;
    const kv = env.JT_SHARED_CACHE as { get(k: string, t: "text"): Promise<string | null> } | undefined;
    if (!kv || typeof kv.get !== "function") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const text = await Promise.race([
      kv.get(ELIGIBILITY_TABLES_KEY, "text"),
      new Promise<null>((done) => { timer = setTimeout(() => done(null), 3000); }),
    ]).finally(() => clearTimeout(timer));
    const parsed = parseEligibilityTables(text);
    if (parsed) { current = parsed; loadedAt = Date.now(); }
  } catch {
    /* 표를 못 읽어도 리포트는 그대로 보인다 */
  }
}
