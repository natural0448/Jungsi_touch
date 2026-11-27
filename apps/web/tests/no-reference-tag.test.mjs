import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*
  대표님 결정(2026-11-22 새벽): 화면에 보이는 '참고' 꼬리표·표현을 모두 지운다(3·4페이지, 와일드카드, 상세 카드, 2페이지, 인쇄, 전문가용).
  src 의 .ts/.tsx 에서 주석을 뺀 코드에 '참고'가 남아 있으면 실패한다. 남겨도 되는 것은 아래 허용 목록뿐이다.
*/
const root = fileURLToPath(new URL("../src", import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
});
/** 주석(블록·JSX·줄 끝)을 지운다. 'https://' 같은 문자열 안의 // 는 남긴다 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");

/** 허용 목록: '참고' 꼬리표가 아닌 말 */
const ALLOW = [
  // 전문가용 학생 '상담 참고'(희망 계열·전공·대학·지역·기타 항목 이름, 2026-11-13 최종관리자 결정) — 점수·판정 꼬리표가 아니다
  /상담 참고/g,
];

test("화면 문자열에 '참고' 꼬리표·표현이 남지 않는다(허용 목록 밖은 0곳)", () => {
  const left = [];
  for (const f of walk(root)) {
    let code = strip(readFileSync(f, "utf8"));
    for (const a of ALLOW) code = code.replace(a, "");
    code.split("\n").forEach((line, i) => {
      if (line.includes("참고")) left.push(`${relative(root, f).split(sep).join("/")}: ${line.trim()}`);
    });
  }
  assert.deepEqual(left, []);
});

test("검사기 자체: 주석 속 '참고'는 세지 않고, 문자열·JSX 속 '참고'는 센다", () => {
  assert.doesNotMatch(strip("const a = 1; // 참고\n/* 참고 */\n{/* 참고 */}"), /참고/);
  assert.match(strip('const t = "내 참고 환산점수";'), /참고/);
  assert.match(strip("<small>참고</small>"), /참고/);
  assert.match(strip('const u = "https://x.kr"; const t = "참고";'), /참고/);
});

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("바꾼 말: 상세 카드 제목·상태 칩·계열 근거 표시", () => {
  const parts = src("../src/app/admissions/possibilities/parts.tsx");
  assert.match(parts, /<h3>내 환산점수<\/h3>/);
  assert.match(parts, /label: ref \? "계산됨"/);
  assert.match(parts, /label: refPct \? "추정됨"/);
  assert.match(parts, /"합격선 대비 위치" : "판정 근거 부족"/);
  assert.match(parts, /label: referenceBandOf\(a\) \? "판정"/);
  assert.match(parts, /<span className="tag">학교 수능 반영분<\/span>/);
  assert.match(parts, /<h3>환산 유불리<\/h3>/);
  // 계열 근거 표시는 남기되 '기준'으로(예외 규칙)
  const fg = src("../src/lib/field-group.ts");
  assert.match(fg, /"2025": "2025 분류 기준"/);
  for (const f of ["../src/app/admissions/favorable/csat-groups.tsx", "../src/app/admissions/favorable/reference-groups.tsx", "../src/app/admissions/favorable/school-card.tsx"]) {
    assert.match(src(f), /2025 분류 기준/);
  }
});
