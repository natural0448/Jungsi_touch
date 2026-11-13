import test from "node:test";
import assert from "node:assert/strict";

const { emptyProfile, profileProblem, profileToTags, splitItems, tagsToProfile, PROFILE_FIELDS } = await import("../src/lib/pro-profile.ts");

const full = () => {
  const p = emptyProfile();
  for (const f of PROFILE_FIELDS) p[f.key] = ["가나다라마바사아자차카타파하가나", "둘", "셋", "넷", "다섯"];
  return p;
};

test("each profile field becomes one server tag within the 5-tag, 100-char, unique contract", () => {
  const tags = profileToTags(full());
  assert.equal(tags.length, 5);
  assert.equal(new Set(tags).size, 5);
  for (const t of tags) assert.ok(t.length <= 100, t);
  assert.equal(profileProblem(full()), null);
});

test("empty fields make no tag and the round trip keeps items", () => {
  const p = emptyProfile();
  p.univ = ["서울대", "연세대"];
  p.etc = ["재수"];
  const tags = profileToTags(p);
  assert.deepEqual(tags, ["희망 대학: 서울대, 연세대", "기타: 재수"]);
  assert.deepEqual(tagsToProfile(tags), p);
});

test("old tags without a field prefix are read as 기타", () => {
  const p = tagsToProfile(["정시", "희망 지역: 서울, 경기"]);
  assert.deepEqual(p.etc, ["정시"]);
  assert.deepEqual(p.region, ["서울", "경기"]);
});

test("limits: at most 5 items and 16 characters per item", () => {
  const p = emptyProfile();
  p.major = splitItems("a, b, c, d, e, f");
  assert.equal(profileProblem(p), "희망 전공은 5개까지 넣을 수 있습니다.");
  const e = emptyProfile();
  e.etc = ["1", "2", "3", "4", "5", "6"];
  assert.equal(profileProblem(e), "기타는 5개까지 넣을 수 있습니다.");
  const q = emptyProfile();
  q.track = ["가".repeat(17)];
  assert.match(profileProblem(q), /16자/);
  assert.deepEqual(splitItems(" 서울대 ,연세대·서울대\n고려대 "), ["서울대", "연세대", "고려대"]);
});
