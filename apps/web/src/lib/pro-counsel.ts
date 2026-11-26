import type { BandCode } from "./dto";
import { BAND } from "./decision-labels";
import { ratioText } from "./format";

/*
  선생님용 상담 리포트의 학교별 상담 팁·최종 3개 선택 가이드(2026-11-22 대표님 결정, 설계 C:\j\w\pro_counsel\DESIGN.md).

  원칙
  - 문장은 정해진 틀만 쓴다. 틀의 빈칸은 서버가 준 판정·위치 숫자와 1페이지 학년도별 대학 발표 값으로만 채운다.
  - 빈칸에 넣을 숫자가 없으면 그 문장을 만들지 않는다(지어내지 않는다). 출처는 문장에 적지 않는다.
  - '합격 확률 몇 %' 같은 단정 숫자는 쓰지 않는다. 판정 단계, 한 단계 위·아래까지 남은 점수, 지난 학년도 경쟁률·충원 흐름으로만 말한다.
  - 지난 학년도 발표 성적은 그해 반영 방법으로 계산한 값이라 올해 환산점수와 직접 견주지 않는다(2026-10-22 원칙).
  화면(학생 화면·인쇄)이 같은 함수를 쓴다. 이 파일은 시험(tests/pro-counsel.test.mjs)이 tsx 없이 읽도록 상대 경로만 가져온다.
*/

export const BAND_ORDER: readonly BandCode[] = ["stable", "downward", "target", "aspirational", "upward", "challenge", "outside"];
export type Tier = "safe" | "fit" | "reach" | "out";
/** 안전권(안정·하향) · 적정권(적정·소신) · 도전권(상향·도전) · 불가 */
export const TIER_OF: Record<BandCode, Tier> = { stable: "safe", downward: "safe", target: "fit", aspirational: "fit", upward: "reach", challenge: "reach", outside: "out" };
export const TIER_LABEL: Record<Tier, string> = { safe: "안전권", fit: "적정권", reach: "도전권", out: "불가" };

/** 서버 band.position(가채점 중앙 추정 점수의 단계 안 위치). 값은 서버 문자열 그대로 */
export interface CounselPosition {
  score: string;
  better_gap: string | null;
  worse_gap: string | null;
  share_pct: number | null;
}
/** 1페이지 학년도 한 행에서 상담에 쓰는 값. 없으면 null(빈칸을 채우지 않는다) */
export interface CounselYear {
  year: number;
  quota: number | null;
  /** 경쟁률 원문(화면 표기 전) */
  ratio: string | null;
  /** 충원인원(= 최종 합격 예비번호, 2026-11-16 결정) */
  fill: number | null;
  /** 대학 발표 성적 ① 칸(50%컷 자리)·② 칸(70%컷 자리) */
  first: { label: string; value: string; unit: string | null } | null;
  second: { label: string; value: string; unit: string | null } | null;
}
export interface CounselSchool {
  offering_id: string;
  university_name: string;
  department: string;
  group: string;
  track?: string | null;
  campus?: string | null;
  /** 판정이 없으면 null */
  band: { code: BandCode; upper?: BandCode | null } | null;
  /** 가채점 판정이면 true(문장에 '가채점 추정'을 붙인다) */
  provisional: boolean;
  position?: CounselPosition | null;
  /** 9월 정식 판정의 환산 유불리(가채점에는 없다) */
  advantage?: { delta_pp: string; status: "favorable" | "unfavorable" | "neutral" } | null;
  /** 2027 최종 모집인원(모집 정보). 없으면 null */
  quota2027?: number | null;
  /** 1페이지 2024~2026 행(같은 학년도 여러 행이면 첫 행만 쓴다). null = 받지 못함 */
  years?: CounselYear[] | null;
}
export interface SchoolCounsel {
  /** 이 학교를 추천하는 이유 */
  why: string[];
  /** 합격 가능성 안내(가장 중요) */
  chance: string[];
  /** 지난 학년도 흐름 */
  history: string[];
  /** 원서접수 때 확인할 것: 올해 흐름을 어느 시점에 무엇으로 읽는지(2026-11-22 대표님 요청) */
  watch: string[];
  /** 함께 읽을 주의(문장마다 반복하지 않고 한 번) */
  cautions: string[];
}

const label = (c: BandCode) => BAND[c].label;
const idx = (c: BandCode) => BAND_ORDER.indexOf(c);
const DEC = /^-?\d{1,12}\.\d{2}$/;
const has = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
const eun = (w: string) => `${w}${has(w) ? "은" : "는"}`;
const ro = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  const jong = c >= 0 && c <= 11171 ? c % 28 : 0;
  return `${w}${jong === 0 || jong === 8 ? "로" : "으로"}`;
};
const gwa = (w: string) => `${w}${has(w) ? "과" : "와"}`;
/** "0.00" 은 '0.01점 미만' */
const gapText = (g: string) => (/^-?0\.00$/.test(g) ? "0.01점 미만" : `${g}점`);
/** 0.1점 미만은 숫자 대신 '턱밑·맨 끝' 같은 일상어로 말한다(2026-11-22 대표님: 선생님이 바로 알아듣는 말) */
const tiny = (g: string) => Math.abs(Number(g)) < 0.1;

/** 단계별 기대 수준(정해진 문장, 숫자 없음). 확률·예측 숫자를 쓰지 않는다 */
export const EXPECTATION: Record<BandCode, string> = {
  stable: "안정은 예상 합격권보다 충분히 앞선 위치입니다. 다른 군에서 적정·도전을 검토할 여지를 만들어 주는 자리로 볼 수 있습니다. 그래도 합격이 보장되는 것은 아닙니다.",
  downward: "하향은 예상 합격권보다 조금 앞선 위치입니다. 한 군을 안전하게 쓰려 할 때 검토하는 자리입니다.",
  target: "적정은 예상 합격권 안에서 앞쪽 절반에 드는 위치입니다. 지난 학년도와 비슷한 흐름이면 합격권으로 볼 수 있는 자리입니다. 올해 흐름이 지난해와 비슷한지는 아래 '원서접수 때 확인할 것'으로 판단합니다.",
  aspirational: "소신은 예상 합격권 안에서 뒤쪽 절반에 드는 위치입니다. 합격권 끝자락에 가까워 올해 지원 흐름에 따라 결과가 갈릴 수 있습니다.",
  upward: "상향은 예상 합격권에서 조금 벗어난 위치입니다. 최초 합격보다는 충원(추가 합격)이 많이 도는 해에 기대를 걸어 볼 수 있는 자리입니다.",
  challenge: "도전은 예상 합격권에서 꽤 벗어난 위치입니다. 충원이 크게 돌거나 지원이 덜 몰리는 해가 아니면 결과를 장담하기 어렵습니다. 다른 군에 안전권 학교를 두고 검토하세요.",
  outside: "불가는 합격선보다 크게 낮은 위치입니다(7단계 중 가장 아래). 지원 자격과는 관계없으며, 지원은 할 수 있습니다.",
};

/** 같은 단계 안 위치 이름(그 단계 점수대 맨 아래 0 ~ 맨 위 100). 위쪽 = 안전한 쪽 */
export function zoneOf(share: number | null | undefined): "위쪽" | "가운데" | "아래쪽" | null {
  if (typeof share !== "number" || !Number.isFinite(share)) return null;
  return share >= 67 ? "위쪽" : share <= 33 ? "아래쪽" : "가운데";
}

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const firstPerYear = (years: CounselYear[] | null | undefined) => {
  const m = new Map<number, CounselYear>();
  for (const y of [...(years ?? [])].sort((a, b) => a.year - b.year)) if (!m.has(y.year)) m.set(y.year, y);
  return [...m.values()];
};

/** 학교 하나의 상담 팁. 빈칸을 채울 값이 없는 문장은 만들지 않는다 */
export function schoolCounsel(s: CounselSchool): SchoolCounsel {
  const why: string[] = [], chance: string[] = [], history: string[] = [], watch: string[] = [], cautions: string[] = [];
  const name = `${s.university_name} ${s.department}`;
  const est = s.provisional ? "가채점 추정으로 " : "";
  const b = s.band && BAND[s.band.code] ? s.band : null;
  const upper = b?.upper && BAND[b.upper] && idx(b.upper) > idx(b.code) ? b.upper : null;
  // ── 이 학교를 추천하는 이유
  if (b) {
    why.push(upper
      ? `${s.group}군 ${eun(name)} ${est}${label(b.code)}~${label(upper)} 범위에 있습니다.`
      : `${s.group}군 ${eun(name)} ${est}${label(b.code)} 단계입니다. ${BAND[b.code].desc}`);
  } else {
    why.push(`${s.group}군 ${eun(name)} 아직 판정이 없습니다. 판정이 나오면 이 칸을 채웁니다.`);
  }
  if (s.advantage && /^-?\d+(\.\d+)?$/.test(s.advantage.delta_pp)) {
    const d = s.advantage.delta_pp.replace(/^-/, "");
    if (s.advantage.status === "favorable") why.push(`이 대학 반영 방식이 이 학생에게 유리합니다(환산 유불리 +${d}%p).`);
    else if (s.advantage.status === "unfavorable") why.push(`이 대학 반영 방식은 이 학생에게 불리합니다(환산 유불리 -${d}%p).`);
  }
  // ── 합격 가능성 안내
  const p = s.position;
  if (b && !upper && p && DEC.test(p.score)) {
    chance.push(`이 대학 방식으로 계산한 ${s.provisional ? "가채점 환산점수(추정 가운데 값)" : "환산점수"}는 ${p.score}점입니다. 아래 점수 차이도 모두 이 점수 기준입니다.`);
    const zone = zoneOf(p.share_pct);
    const zoneWord = zone === "위쪽" ? "위쪽(한 단계 위에 가까운 쪽)" : zone === "아래쪽" ? "아래쪽(한 단계 아래에 가까운 쪽)" : "가운데쯤";
    if (zone && num(p.share_pct)) chance.push(`같은 ${label(b.code)} 안에서도 ${zoneWord}입니다. ${ro(label(b.code))} 판정되는 점수대를 맨 아래 0, 맨 위 100으로 놓으면 ${p.share_pct} 정도입니다.`);
    const better = idx(b.code) > 0 ? BAND_ORDER[idx(b.code) - 1] : null;
    const worse = idx(b.code) < 6 ? BAND_ORDER[idx(b.code) + 1] : null;
    // 2026-11-26 대표님 결정: 수능이 끝나 바꿀 수 없는 '부족·모자람'은 쓰지 않고, 위 경계와의 거리(얼마나 경계에 있는지)로 쓴다
    if (better && p.better_gap && DEC.test(p.better_gap)) chance.push(tiny(p.better_gap)
      ? `한 단계 위인 ${gwa(label(better))} 0.1점도 차이 나지 않는, ${label(better)} 바로 아래 점수입니다.`
      : `한 단계 위인 ${label(better)} 점수대와는 ${gapText(p.better_gap)} 차이입니다.`);
    if (worse && p.worse_gap && DEC.test(p.worse_gap)) chance.push(tiny(p.worse_gap)
      ? `반대로 아주 조금만(0.1점 미만) 낮아져도 한 단계 아래인 ${ro(label(worse))} 내려갑니다. ${label(b.code)} 판정의 맨 끝에 걸린 점수입니다.`
      : `반대로 ${gapText(p.worse_gap)} 이상 낮아지면 한 단계 아래인 ${ro(label(worse))} 내려갑니다.`);
  } else if (b && upper) {
    chance.push(`가채점 원점수로는 과목별 표준점수가 한 값으로 정해지지 않아 점수 범위에 따라 ${label(b.code)}부터 ${label(upper)}까지 나옵니다. 실채점 성적이 나오면 한 단계로 다시 판정합니다.`);
  }
  if (b) chance.push(EXPECTATION[upper ?? b.code]);
  // 충원 흐름(지난 학년도): 모집인원과 충원인원이 함께 있는 해만
  const ys = firstPerYear(s.years);
  const fills = ys.filter((y) => num(y.fill) && num(y.quota) && y.quota! > 0);
  if (fills.length > 0) {
    chance.push(`지난 학년도 충원(추가 합격): ${fills.map((y) => `${y.year} ${y.fill}명(모집 ${y.quota}명)`).join(", ")}.`);
    const rates = fills.map((y) => y.fill! / y.quota!);
    const code = upper ?? b?.code ?? null;
    const reaching = code === "upward" || code === "challenge" || code === "aspirational";
    if (fills.length >= 2 && rates.every((r) => r >= 1)) {
      chance.push(`${fills.length}개 학년도 모두 충원인원이 모집인원 이상이었습니다.${reaching ? " 충원이 많이 돈 학과라 이 단계에서도 추가 합격을 기대해 볼 근거가 있습니다. 실제 기대 수준은 최초 합격 발표 뒤 받은 예비 순위로 다시 확인합니다." : ""}`);
    } else if (fills.length >= 2 && rates.every((r) => r < 0.3)) {
      chance.push(`${fills.length}개 학년도 모두 충원인원이 모집인원의 30%보다 적었습니다.${reaching ? " 충원이 적었던 학과라 이 단계에서 추가 합격을 크게 기대하기는 어렵습니다." : ""}`);
    }
    cautions.push("충원 흐름은 지난 학년도 결과이며 올해도 같다는 보장은 없습니다.");
  }
  // ── 지난 학년도 흐름
  const q26 = ys.find((y) => y.year === 2026)?.quota ?? null;
  if (num(s.quota2027) && num(q26)) {
    const d = s.quota2027 - q26;
    if (d === 0) history.push(`모집인원은 2026학년도와 같은 ${s.quota2027}명입니다.`);
    else {
      history.push(`모집인원이 2026학년도 ${q26}명에서 2027학년도 ${s.quota2027}명으로 ${Math.abs(d)}명 ${d < 0 ? "줄었습니다" : "늘었습니다"}.`);
      if (d < 0) cautions.push("뽑는 인원이 줄면 같은 점수라도 합격선이 오를 수 있습니다.");
    }
  }
  const ratios = ys.filter((y) => y.ratio && /^\d+(\.\d+)?$/.test(y.ratio.trim()));
  if (ratios.length > 0) {
    let t = `경쟁률: ${ratios.map((y) => `${y.year} ${ratioText(y.ratio!.trim())}대 1`).join(" → ")}.`;
    if (ratios.length >= 3) {
      const v = ratios.map((y) => Number(ratioText(y.ratio!.trim())));
      if (v.every((x, i) => i === 0 || x > v[i - 1])) t += " 해마다 올랐습니다.";
      else if (v.every((x, i) => i === 0 || x < v[i - 1])) t += " 해마다 내렸습니다.";
    }
    history.push(t);
  }
  for (const slot of ["second", "first"] as const) {
    const cells = ys.flatMap((y) => (y[slot] ? [{ year: y.year, ...y[slot]! }] : []));
    if (cells.length === 0) continue;
    // 같은 통계 이름·단위끼리만 한 줄로 잇는다(다른 통계를 섞지 않는다)
    const byName = new Map<string, typeof cells>();
    for (const c of cells) {
      const k = `${c.label}|${c.unit ?? ""}`;
      byName.set(k, [...(byName.get(k) ?? []), c]);
    }
    for (const list of byName.values()) {
      let t = `대학 발표 ${list[0].label}: ${list.map((c) => `${c.year} ${c.value}${c.unit ?? ""}`).join(" · ")}.`;
      const vals = list.map((c) => Number(c.value)).filter((x) => Number.isFinite(x));
      if (vals.length >= 2 && vals.length === list.length) {
        const spread = Math.max(...vals) - Math.min(...vals);
        const digits = Math.max(...list.map((c) => (c.value.split(".")[1] ?? "").length));
        t += ` 해마다 최대 ${spread.toFixed(Math.min(digits, 2))}${list[0].unit ?? ""} 차이가 났습니다.`;
      }
      history.push(t);
    }
  }
  // ── 원서접수 때 확인할 것(시점 순서: 접수 전 → 접수 중 → 발표 뒤). 이 학교 숫자가 있는 것만
  const code = upper ?? b?.code ?? null;
  const safeSide = code === "stable" || code === "downward" || code === "target";
  if (num(s.quota2027)) {
    watch.push(`접수 전 — 대학이 발표하는 최종 모집인원을 확인하세요(지금 자료 ${s.quota2027}명). 수시에서 못 뽑은 인원이 넘어와 인원이 늘면 합격선이 내려갈 여지가 생기고, 그대로이거나 줄면 이 판정을 그대로 보면 됩니다.`);
  }
  const last = ratios.at(-1);
  if (last) {
    const r = ratioText(last.ratio!.trim());
    watch.push(`접수 중 — 대학이 공개하는 경쟁률을 지난 ${last.year}학년도 최종 경쟁률 ${r}대 1과 견주어 보세요. 경쟁률은 마감이 다가올수록 오르는 경우가 많고, 대학에 따라 마감 전에 공개를 멈추기도 하므로 마지막으로 공개된 값을 기준으로 봅니다. 그 값이 이미 ${r}대 1을 넘었다면 지난해보다 지원이 몰린 것이고, 최종 경쟁률은 그보다 더 오를 수 있습니다.`);
    if (code) watch.push(safeSide
      ? `읽는 법 — 마지막 공개 경쟁률이 지난해보다 뚜렷이 높으면 '지난 학년도와 비슷한 흐름'이 아닙니다. ${label(code)}이라도 안심하기 어려우니 다른 군을 더 안전하게 두는 쪽을 검토하세요. 지난해와 비슷하거나 낮으면 이 판정을 그대로 믿어도 되는 쪽입니다.`
      : `읽는 법 — 마지막 공개 경쟁률이 지난해보다 낮으면 지원이 덜 몰린 해로, ${label(code)}에서도 기대를 걸어 볼 근거가 됩니다. 지난해보다 뚜렷이 높으면 기대를 낮추고, 다른 군의 안전권 학교를 지키는 쪽으로 판단하세요.`);
  }
  if (fills.length > 0) {
    const f = fills.at(-1)!;
    watch.push(`발표 뒤 — 충원은 최초 합격자가 다른 군 대학에 등록하면서 생깁니다. 최초 합격 발표 때 예비 순위를 알려 주는 대학이라면, 받은 순위를 지난 ${f.year}학년도 충원인원 ${f.fill}명과 견주어 보세요. 순위가 그 안쪽이면 추가 합격을 기대해 볼 근거가 되고, 크게 바깥이면 기대를 낮추는 것이 좋습니다.`);
  }
  if (history.some((h) => h.startsWith("대학 발표"))) cautions.push("지난 학년도 발표 성적은 그해 반영 방법으로 계산한 값이라 올해 환산점수와 바로 견주지 않습니다.");
  if (s.provisional && b) cautions.push("가채점 원점수로 추정한 판정입니다. 실채점 성적이 나오면 달라질 수 있습니다.");
  return { why, chance, history, watch, cautions };
}

/* ── 최종 3개 선택 가이드 ── */

export interface GuideRow {
  school: CounselSchool;
  tier: Tier | null;
  /** 줄 끝에 붙이는 짧은 위치 문구(예: '적정 · 구간 위쪽', '적정~소신') */
  tag: string;
}
export interface GuideGroup {
  group: string;
  rows: GuideRow[];
  lines: string[];
}
export interface GuideCombo {
  name: string;
  picks: GuideRow[];
  line: string;
}
export interface ChoiceGuide {
  groups: GuideGroup[];
  combos: GuideCombo[];
  notes: string[];
}

export function shortTag(s: CounselSchool): string {
  if (!s.band || !BAND[s.band.code]) return "판정 없음";
  const up = s.band.upper && BAND[s.band.upper] && idx(s.band.upper) > idx(s.band.code) ? s.band.upper : null;
  if (up) return `${label(s.band.code)}~${label(up)}`;
  const z = zoneOf(s.position?.share_pct);
  return z ? `${label(s.band.code)} · ${z}` : label(s.band.code);
}
/** 같은 군 안 순서: 판정 단계(안정 → 불가), 같은 단계면 구간 위쪽(안전한 쪽) 먼저, 판정 없음은 맨 뒤 */
function rowOrder(a: CounselSchool, b: CounselSchool): number {
  const ia = a.band ? idx(a.band.code) : 99, ib = b.band ? idx(b.band.code) : 99;
  if (ia !== ib) return ia - ib;
  const sa = a.position?.share_pct ?? -1, sb = b.position?.share_pct ?? -1;
  if (sa !== sb) return sb - sa;
  return a.offering_id < b.offering_id ? -1 : a.offering_id > b.offering_id ? 1 : 0;
}
const nameOf = (s: CounselSchool) => `${s.university_name} ${s.department}`;
const GROUPS = ["가", "나", "다"];
const tierOf = (s: CounselSchool): Tier | null => (s.band && BAND[s.band.code] ? TIER_OF[s.band.upper && idx(s.band.upper) > idx(s.band.code) ? s.band.upper : s.band.code] : null);

/**
 * 담은 학교로 만든 최종 3개 선택 가이드. 범위 판정(적정~소신)은 나쁜 끝으로 권역을 정한다(보수적으로).
 * 조합 예시는 담은 학교만으로 만든다 — 안정형(군마다 가장 안전한 학교), 균형형(안전권·적정권·도전권 하나씩),
 * 도전형(도전권 둘 + 안전권 하나). 만들 수 없는 조합은 보이지 않는다.
 */
export function choiceGuide(schools: CounselSchool[]): ChoiceGuide {
  const groups: GuideGroup[] = [];
  const notes: string[] = [];
  for (const g of GROUPS) {
    const list = schools.filter((s) => s.group === g).sort(rowOrder);
    const rows = list.map((s) => ({ school: s, tier: tierOf(s), tag: shortTag(s) }));
    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push(`${g}군에 담은 학교가 없습니다. ${g}군 지원 여부를 먼저 정하세요.`);
    } else {
      lines.push(`${g}군 ${rows.length}곳: ${rows.map((r) => `${nameOf(r.school)}(${r.tag})`).join(", ")}.`);
      const tiers = new Set(rows.map((r) => r.tier));
      if (tiers.size === 1 && tiers.has("reach")) lines.push(`${g}군에는 상향·도전만 담겨 있습니다. 이 군을 도전으로 쓰려면 다른 두 군 중 한 곳은 안전권으로 두는 것을 검토하세요.`);
      else if (tiers.size === 1 && tiers.has("safe")) lines.push(`${g}군에는 안전권(안정·하향)만 있습니다. 이 군을 안전하게 쓰고 다른 군에서 적정·도전을 검토할 수 있습니다.`);
      const fit = rows.filter((r) => r.tier === "fit"), reach = rows.filter((r) => r.tier === "reach");
      if (fit.length > 0 && reach.length > 0) {
        const f = fit[0], r = reach[0];
        let t = `${g}군은 ${nameOf(f.school)}(${f.tag})${gwa(f.tag).slice(f.tag.length)} ${nameOf(r.school)}(${r.tag}) 중에서 고르는 문제입니다.`;
        const fg = f.school.position?.worse_gap, rg = r.school.position?.better_gap;
        const fb = f.school.band && !f.school.band.upper ? f.school.band.code : null, rb = r.school.band && !r.school.band.upper ? r.school.band.code : null;
        const parts: string[] = [];
        if (fg && DEC.test(fg) && fb && idx(fb) < 6) parts.push(tiny(fg) ? `${label(fb)} 쪽은 ${label(fb)}의 맨 끝이라 조금만 낮아져도 ${ro(label(BAND_ORDER[idx(fb) + 1]))} 내려갑니다` : `${label(fb)} 쪽은 한 단계 아래(${label(BAND_ORDER[idx(fb) + 1])})로 내려가기까지 ${gapText(fg)} 여유가 있습니다`);
        if (rg && DEC.test(rg) && rb && idx(rb) > 0) parts.push(tiny(rg) ? `${label(rb)} 쪽은 한 단계 위(${label(BAND_ORDER[idx(rb) - 1])}) 바로 턱밑입니다` : `${label(rb)} 쪽은 한 단계 위(${label(BAND_ORDER[idx(rb) - 1])})에 ${gapText(rg)} 모자랍니다`);
        if (parts.length > 0) t += ` ${parts.join(". ")}.`;
        lines.push(t);
      }
    }
    groups.push({ group: g, rows, lines });
  }
  const pick = (g: GuideGroup, tier: Tier, prefer: "safest" | "boldest") => {
    const list = g.rows.filter((r) => r.tier === tier);
    return list.length === 0 ? null : prefer === "safest" ? list[0] : list[list.length - 1];
  };
  const combos: GuideCombo[] = [];
  const line = (picks: GuideRow[]) => picks.map((r) => `${r.school.group}군 ${nameOf(r.school)}(${r.tag})`).join(" / ");
  const filled = groups.filter((g) => g.rows.some((r) => r.tier && r.tier !== "out"));
  if (filled.length === 3) {
    // 안정형: 군마다 가장 안전한 학교(불가 제외)
    const safest = filled.map((g) => g.rows.find((r) => r.tier && r.tier !== "out")!);
    combos.push({ name: "안정형", picks: safest, line: line(safest) });
    // 균형형: 세 군에 안전권·적정권·도전권을 하나씩. 군 배정은 가·나·다 순서로 먼저 맞는 것
    const perms: [number, number, number][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const [si, fi, ri] of perms) {
      // 안전권은 그 군에서 가장 과감한 쪽(하향 먼저), 적정권은 가장 안전한 쪽, 도전권은 가장 안전한 쪽(상향 먼저)
      const s = pick(filled[si], "safe", "boldest"), f = pick(filled[fi], "fit", "safest"), r = pick(filled[ri], "reach", "safest");
      if (s && f && r) {
        const picks = [s, f, r].sort((a, b) => GROUPS.indexOf(a.school.group) - GROUPS.indexOf(b.school.group));
        combos.push({ name: "균형형", picks, line: line(picks) });
        break;
      }
    }
    // 도전형: 두 군은 도전권(가장 안전한 쪽), 한 군은 안전권
    for (let si = 0; si < 3; si++) {
      const s = pick(filled[si], "safe", "boldest");
      const rs = filled.filter((_, i) => i !== si).map((g) => pick(g, "reach", "safest"));
      if (s && rs.every(Boolean)) {
        const picks = [s, ...(rs as GuideRow[])].sort((a, b) => GROUPS.indexOf(a.school.group) - GROUPS.indexOf(b.school.group));
        combos.push({ name: "도전형", picks, line: line(picks) });
        break;
      }
    }
  } else if (schools.length > 0) {
    notes.push(`판정이 있는 학교가 ${filled.length}개 군에만 있어 세 군 조합 예시는 만들지 않았습니다.`);
  }
  if (schools.length > 0 && !groups.some((g) => g.rows.some((r) => r.tier === "safe"))) {
    notes.push("세 군 모두 안전권(안정·하향) 학교가 없습니다. 한 군은 안정·하향 학교를 더 담아 비교해 보세요.");
  }
  if (schools.length > 0) notes.push("조합은 담은 학교만으로 만든 예시이며 정답이 아닙니다. 판정 단계는 합격 확률이 아닙니다. 최종 선택은 학생이 합니다.");
  return { groups, combos, notes };
}
