import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
  브라우저 묶음 경계 검사(2026-11-22 ship54 운영 빌드 실패 재발 방지).
  "use client" 파일에서 시작해 값 import(import type 제외)를 따라가며, 서버 전용 모듈
  (import "server-only" 또는 next/headers 를 쓰는 파일)에 닿으면 실패한다.
  "use server" 파일(서버 액션)은 브라우저에는 참조만 실리므로 그 안으로는 따라가지 않는다.
  tsc·다른 시험으로는 잡히지 않고 next build 에서만 드러나던 오류다.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const EXT = [".ts", ".tsx", ".js", ".mjs"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.includes(path.extname(p))) out.push(p);
  }
  return out;
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const directive = (s, d) => new RegExp(`^\\s*["']${d}["'];?`).test(strip(s));

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // 패키지
  const cands = [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, "index" + e))];
  return cands.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** 값 import·export-from·side-effect import 의 지정자(import type / export type 은 뺀다) */
function valueSpecs(src) {
  const s = strip(src);
  const out = [];
  const re = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?["']([^"']+)["']/g;
  for (let m; (m = re.exec(s)); ) {
    if (m[2]) continue;
    if (m[1] === "export" && !m[3]) continue;
    // import { type A, type B } from — 모두 type 이면 값 import 가 아니다
    const clause = m[3] ?? "";
    const brace = clause.match(/^\s*\{([^}]*)\}\s+from\s+$/);
    if (brace && brace[1].split(",").map((x) => x.trim()).filter(Boolean).every((x) => x.startsWith("type "))) continue;
    out.push(m[4]);
  }
  for (const m of s.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

const files = walk(root);
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const serverOnly = (f) => {
  const specs = valueSpecs(text.get(f));
  return specs.includes("server-only") || specs.includes("next/headers");
};

test("브라우저 컴포넌트('use client')는 서버 전용 모듈을 import 하지 않는다", () => {
  const roots = files.filter((f) => directive(text.get(f), "use client"));
  assert.ok(roots.length > 10, "use client 파일을 찾지 못했다");
  const bad = [];
  for (const start of roots) {
    const seen = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const f = queue.shift();
      if (f !== start && directive(text.get(f), "use server")) continue;
      if (serverOnly(f)) {
        const chain = [];
        for (let x = f; x; x = seen.get(x)) chain.unshift(path.relative(root, x).replaceAll("\\", "/"));
        bad.push(chain.join(" → "));
        continue;
      }
      for (const spec of valueSpecs(text.get(f))) {
        const r = resolveSpec(f, spec);
        if (r && text.has(r) && !seen.has(r)) { seen.set(r, f); queue.push(r); }
      }
    }
  }
  assert.deepEqual(bad, [], "서버 전용 모듈이 브라우저 묶음에 끌려 들어간다:\n" + bad.join("\n"));
});
