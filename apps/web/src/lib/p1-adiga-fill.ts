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
  const { format, cells, ranks } = doc as { format?: unknown; cells?: unknown; ranks?: unknown };
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
    const rank = fill.get(`R|${r.y}|${r.pk}|${r.t ?? ""}|${r.g ?? ""}`);
    if (rank !== undefined && (r.rk?.v ?? "").trim() === "" && (r.ad?.v ?? "").trim() === "") {
      next = { ...r, rk: { v: rank, s: ADIGA_FILL_STATUS, r: null, u: "번", l: "최종 합격 예비번호", at: null, ctx: null } };
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
