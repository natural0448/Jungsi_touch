import test from "node:test";
import assert from "node:assert/strict";
import { historicalConditionLabel } from "../src/lib/p1-shape.ts";

const row = (y, track, group = "가", campus = null) => ({ y, t: track, g: group, c: campus });

test("shows the original historical track when the confirmed 2027 track changed", () => {
  const old = row(2024, "수능(가상전형A)");
  const current = row(2027, "수능(가상전형B)");
  assert.equal(historicalConditionLabel(old, [old, current]), "당시 전형 수능(가상전형A) · 모집군 가");
});

test("does not repeat unchanged conditions", () => {
  const old = row(2025, "수능(가상전형)");
  const current = row(2027, "수능(가상전형)");
  assert.equal(historicalConditionLabel(old, [old, current]), null);
});

test("without 2027 compares against the unique most recent historical row", () => {
  const old = row(2024, "수능(가상전형A)");
  const latest = row(2026, "수능(가상전형B)");
  assert.equal(historicalConditionLabel(old, [old, latest]), "당시 전형 수능(가상전형A) · 모집군 가");
  assert.equal(historicalConditionLabel(latest, [old, latest]), null);
});

test("does not invent missing track or an ambiguous current reference", () => {
  const unknown = row(2024, null);
  const old = row(2024, "수능(가상전형A)");
  const first = row(2027, "수능(가상전형B)");
  const second = row(2027, "수능(가상전형C)");
  assert.equal(historicalConditionLabel(unknown, [unknown, first]), null);
  assert.equal(historicalConditionLabel(old, [old, first, second]), null);
});

test("does not choose between duplicate latest historical references", () => {
  const old = row(2024, "수능(가상전형A)");
  assert.equal(historicalConditionLabel(old, [old, row(2026, "B"), row(2026, "C")]), null);
});

test("shows the original group when the recruitment group changes", () => {
  const old = row(2024, "수능(가상전형)", "나");
  const current = row(2027, "수능(가상전형)", "다");
  assert.equal(historicalConditionLabel(old, [old, current]), "당시 전형 수능(가상전형) · 모집군 나");
});
