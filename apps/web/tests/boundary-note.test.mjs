import { test } from "node:test";
import assert from "node:assert/strict";
import { boundaryNote } from "../src/lib/boundary-note.ts";

const pos = (share, better = "2.70", worse = "1.50") => ({ score: "612.40", better_gap: better, worse_gap: worse, share_pct: share });
const run = (p, extra = {}) => boundaryNote({ label: "적정", better: "하향", worse: "소신", pos: p, final: false, ...extra });

test("2026-11-26 대표님: '부족'은 쓰지 않고 경계에 얼마나 가까운지를 말로", () => {
  assert.match(run(pos(90)).lead, /위쪽으로, 하향 경계에 가깝습니다/);
  assert.match(run(pos(10)).lead, /아래쪽으로, 소신 경계에 가깝습니다/);
  assert.match(run(pos(50)).lead, /가운데쯤/);
  for (const s of [0, 10, 50, 90, 100]) assert.doesNotMatch(JSON.stringify(run(pos(s))), /부족/);
});
test("정확한 점수는 따로 한 줄(유료로만 보낼 줄)", () => {
  const n = run(pos(36));
  assert.equal(n.exact, "내 환산점수(가운데 추정) 612.40점 · 하향 경계 615.10점과 2.70점 차이 · 소신 경계 610.90점보다 1.50점 위");
  assert.equal(boundaryNote({ label: "적정", better: "하향", worse: "소신", pos: pos(36), final: true }).exact.startsWith("내 환산점수 612.40점"), true);
});
test("맨 위·맨 아래 단계와 값 없음", () => {
  assert.equal(boundaryNote({ label: "안정", better: null, worse: "하향", pos: pos(null, null, "3.00"), final: false }).lead, "가장 좋은 단계입니다.");
  assert.equal(boundaryNote({ label: "불가", better: "도전", worse: null, pos: pos(null, "1.00", null), final: false }).lead, "가장 낮은 단계입니다.");
  assert.equal(run(null), null);
});
