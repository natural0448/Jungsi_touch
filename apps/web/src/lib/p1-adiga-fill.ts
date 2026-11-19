import type { Cell, Row } from "./p1-shape";

/**
 * 1페이지 빈 50%·70%컷 칸을 대학어디가 발표값으로 채운다(2026-11-17 대표님 결정).
 * - 값은 DB의 대학어디가 원문 관측만, 같은 칸 후보가 여럿이면 어디가 첫 화면 표와 일치하는 값만 쓴다(화면팀이 대조해 만든 표).
 * - 이미 보이는 값은 바꾸지 않는다. 빈칸만 채운다.
 * - 표는 공개 저장소가 아니라 화면 서버 KV(ADIGA_FILL_KEY)에 둔다.
 */
export const ADIGA_FILL_KEY = "p1-adiga-fill:v1";
export const ADIGA_FILL_FORMAT = "jungsi.p1-adiga-fill/v1";
export const ADIGA_FILL_STATUS = "screen_adiga_fill";
const BASIS = "대학 환산점수";
const SLOTS = [["c50", "50%컷", 50], ["c70", "70%컷", 70]] as const;
const KEY = /^(2024|2025|2026)\|[0-9]{1,12}\|(50|70)%컷$/;
const VALUE = /^[0-9]{1,4}(?:\.[0-9]{1,4})?$/;
const MAX = 20000;
const RANK_KEY = /^(2024|2025|2026)\|[0-9]{1,12}\|[^|]{1,80}\|[가나다]$/;
const RANK_VALUE = /^[1-9][0-9]{0,5}$/;
const FILL_VALUE = /^(?:0|[1-9][0-9]{0,5}|undisclosed|unavailable)$/;
/** 충원 칸 사유 코드(2026-11-19 대표님: 빈칸 없음, 발표 안 함·자료 없음은 '미발표') */
export const FILL_UNDISCLOSED = "fill_undisclosed";
/** 성적 칸 사유 코드: 3인 이하라 대학이 성적을 발표하지 않음 */
export const STATS_LE3 = "stats_le3_undisclosed";
const STAT_LABELS = new Set(["50%컷", "70%컷"]);
/** p1-published-stats 의 statName 과 같은 규칙으로 50·70%컷 이름만 맞춘다(시험이 TS 확장자 없이 불러오도록 값 가져오기를 두지 않음) */
const cutName = (l: string | null) => {
  const m = /^(\d{1,3})(?:%컷|%cut|_percent_cut|%)$/i.exec((l ?? "").replace(/\s+/g, ""));
  return m ? `${Number(m[1])}%컷` : null;
};

export type AdigaFill = ReadonlyMap<string, string>;

/** KV 문자열을 검사해 표로 바꾼다. 형식이 하나라도 어긋나면 표 전체를 쓰지 않는다(null). */
export function parseAdigaFill(text: string | null): AdigaFill | null {
  if (text === null) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const { format, cells, ranks, fills } = doc as { format?: unknown; cells?: unknown; ranks?: unknown; fills?: unknown };
  if (format !== ADIGA_FILL_FORMAT || !cells || typeof cells !== "object" || Array.isArray(cells)) return null;
  const entries = Object.entries(cells as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX) return null;
  const out = new Map<string, string>();
  for (const [k, v] of entries) {
    if (!KEY.test(k) || typeof v !== "string" || !VALUE.test(v)) return null;
    out.set(k, v);
  }
  // 최종 합격 예비번호(담당자 v41 후속 대조로 원문에서 확인된 양수, 2026-11-19). 키: 학년도|PK|전형|군
  if (ranks !== undefined) {
    if (!ranks || typeof ranks !== "object" || Array.isArray(ranks)) return null;
    const rs = Object.entries(ranks as Record<string, unknown>);
    if (rs.length > MAX) return null;
    for (const [k, v] of rs) {
      if (!RANK_KEY.test(k) || typeof v !== "string" || !RANK_VALUE.test(v)) return null;
      out.set(`R|${k}`, v);
    }
  }
  // 대학어디가 원본의 성적(50%·70%컷) 또는 3인 이하 미발표(le3). 키: 학년도|PK|전형|군
  const { stats } = doc as { stats?: unknown };
  if (stats !== undefined) {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
    const ss = Object.entries(stats as Record<string, unknown>);
    if (ss.length > MAX) return null;
    for (const [k, v] of ss) {
      if (!RANK_KEY.test(k)) return null;
      if (v === "le3") { out.set(`S|${k}`, "le3"); continue; }
      if (!Array.isArray(v) || v.length < 1 || v.length > 4) return null;
      for (const it of v) {
        const { label, value } = (it ?? {}) as { label?: unknown; value?: unknown };
        if (typeof label !== "string" || !STAT_LABELS.has(label) || typeof value !== "string" || !VALUE.test(value)) return null;
        out.set(`S|${k}|${label}`, value);
      }
    }
  }
  // 대학어디가 '전형 결과' 표의 충원인원(명, 2026-11-19 화면팀 원문 대조). 0은 원문 표 값이 0인 칸만 담는다
  if (fills !== undefined) {
    if (!fills || typeof fills !== "object" || Array.isArray(fills)) return null;
    const fs = Object.entries(fills as Record<string, unknown>);
    if (fs.length > MAX) return null;
    for (const [k, v] of fs) {
      if (!RANK_KEY.test(k) || typeof v !== "string" || !FILL_VALUE.test(v)) return null;
      out.set(`F|${k}`, v);
    }
  }
  return out;
}

const filled = (label: string, p: number, v: string): Cell => ({
  v, s: ADIGA_FILL_STATUS, r: null, u: null, l: label, b: BASIS, co: "final_registrants", cc: "final_registrants",
  p, bc: "university_converted_score", at: null, ctx: null, url: null,
});

/** 행을 바꾸지 않고, 채운 칸이 있는 행만 새 객체로 돌려준다. */
export function applyAdigaFill(rows: Row[], fill: AdigaFill | null): Row[] {
  if (!fill || fill.size === 0) return rows;
  return rows.map((r) => {
    if (r.pk === null || r.y >= 2027) return r;
    let next: Row | null = null;
    // 예비번호·충원 칸이 모두 비었을 때만 원문 확인된 예비번호로 채운다
    // 모집군은 화면 자료에 '가'·'가군' 두 표기가 있어 '가'로 맞춘다
    const key = `${r.y}|${r.pk}|${r.t ?? ""}|${(r.g ?? "").replace(/군$/, "")}`;
    const rank = fill.get(`R|${key}`), people = fill.get(`F|${key}`);
    if ((r.rk?.v ?? "").trim() === "" && (r.ad?.v ?? "").trim() === "") {
      // 담당자가 원문으로 확인한 예비번호가 먼저, 없으면 대학어디가 충원인원, 발표 안 함·자료 없음은 사유만
      if (rank !== undefined) next = { ...r, rk: { v: rank, s: ADIGA_FILL_STATUS, r: null, u: "번", l: "최종 합격 예비번호", at: null, ctx: null } };
      else if (people === "undisclosed" || people === "unavailable") next = { ...r, ad: { v: null, s: ADIGA_FILL_STATUS, r: FILL_UNDISCLOSED, u: null, l: "충원인원", at: null, ctx: null } };
      else if (people !== undefined) next = { ...r, ad: { v: people, s: ADIGA_FILL_STATUS, r: null, u: "명", l: "충원인원", at: null, ctx: null } };
    }
    const le3 = fill.get(`S|${key}`) === "le3";
    for (const [slot, label, p] of SLOTS) {
      const cur = (next ?? r)[slot];
      if (cur.v !== null && cur.v.trim() !== "") continue;
      const v = fill.get(`S|${key}|${label}`);
      if (v !== undefined) {
        next ??= { ...r };
        next[slot] = filled(label, p, v);
      } else if (le3 && slot === "c50" && ((next ?? r).c70.v ?? "").trim() === "") {
        next ??= { ...r };
        next.c50 = { ...cur, r: STATS_LE3 };
      }
    }
    for (const [slot, label, p] of SLOTS) {
      const cur = r[slot];
      if (cur.v !== null && cur.v.trim() !== "") continue;
      const v = fill.get(`${r.y}|${r.pk}|${label}`);
      if (v === undefined) continue;
      // 같은 이름·같은 기준의 다른 값이 이미 있으면 화면이 둘 다 숨기므로 채우지 않는다
      if (r.alt.e.some((e) => cutName(e.l) === label && e.v !== null && e.v.trim() !== "" && (e.b ?? null) === BASIS)) continue;
      next ??= { ...r };
      next[slot] = filled(label, p, v);
    }
    return next ?? r;
  });
}
