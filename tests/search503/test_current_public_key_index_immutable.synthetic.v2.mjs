/** REVIEW ONLY. Fake references, fake key index, injected bytes. No DB or network. */
import assert from "node:assert/strict";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { publicKeyRawHash } from "../../supabase/functions/_shared/current_public_key_index.ts";
import { CurrentPublicMetadataKeyIndex as Candidate } from "../../supabase/functions/_shared/current_public_key_index.ts";

const META = "a".repeat(64),
  GUIDE = "b".repeat(64),
  PAYLOAD = "c".repeat(64),
  COVERAGE = "d".repeat(64);
const query = {
  academic_year: null,
  university_q: "",
  department_q: "",
  region: "",
  group: "",
  limit: 1,
};

function rootDoc() {
  const lookup = { object_key: "synthetic/a", bytes: 2, sha256: "e".repeat(64) };
  return {
    format: "jungsi.current-public-key-index/v3",
    metadata_sha256: META,
    guide_command_state_sha256: GUIDE,
    admission_head: { command_id: "SYNTHETIC", payload_sha256: PAYLOAD },
    coverage: {
      scope: "all_eligible_current_db_observations_at_head",
      review_receipt_sha256: COVERAGE,
      snapshot_sha256: "f".repeat(64),
      history_rows: 0,
    },
    history: [],
    offerings: [],
    lookups: { "0": lookup, "1": lookup },
    limits: { max_shards_per_search: 12, max_shard_rows: 256 },
  };
}
async function data() {
  const a = JSON.stringify(rootDoc()), b = a.replaceAll("synthetic/a", "synthetic/b");
  const original = new TextEncoder().encode(a), altered = new TextEncoder().encode(b);
  assert.equal(original.length, altered.length);
  return {
    original,
    altered,
    hashA: await publicKeyRawHash(original),
    hashB: await publicKeyRawHash(altered),
  };
}
function basis(bytes, sha) {
  return {
    requiredFormat: "jungsi.current-public-key-index/v3",
    root: { object_key: "synthetic/root", bytes, sha256: sha },
    metadataSha256: META,
    guideCommandStateSha256: GUIDE,
    admissionHead: { command_id: "SYNTHETIC", payload_sha256: PAYLOAD },
    coverageReceiptSha256: COVERAGE,
  };
}
async function lookupRequest(index, observed) {
  try {
    await index.resolve(["2027:SYNTHETIC"], false);
  } catch (error) {
    assert.equal(error.message, "SYNTHETIC_STOP");
  }
  assert.equal(observed.length, 1);
  return observed[0];
}
async function race(Index, shared = false) {
  const sample = await data(), offset = shared ? 3 : 0;
  const buffer = shared
    ? new SharedArrayBuffer(sample.original.length + offset + 2)
    : new ArrayBuffer(sample.original.length);
  const input = new Uint8Array(buffer, offset, sample.original.length);
  input.set(sample.original);
  const calls = [], trusted = basis(input.length, sample.hashA);
  const index = new Index(trusted, (ref) => {
    if (ref.object_key === "synthetic/root") return Promise.resolve(input);
    calls.push(ref.object_key);
    throw new Error("SYNTHETIC_STOP");
  });
  const originalDigest = crypto.subtle.digest;
  let first = true, entered, release;
  const started = new Promise((resolve) => entered = resolve),
    gate = new Promise((resolve) => release = resolve);
  crypto.subtle.digest = async function (...args) {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return await Reflect.apply(originalDigest, crypto.subtle, args);
  };
  try {
    const running = index.select("offerings", query, null);
    await started;
    input.set(sample.altered);
    release();
    assert.deepEqual((await running).keys, []);
    return await lookupRequest(index, calls);
  } finally {
    crypto.subtle.digest = originalDigest;
  }
}
async function pinRace(Index) {
  const sample = await data(), trusted = basis(sample.original.length, sample.hashA), calls = [];
  let receivedPin;
  const index = new Index(trusted, (ref) => {
    if (ref.object_key === "synthetic/root") {
      receivedPin = ref.sha256;
      trusted.root.sha256 = sample.hashB;
      return Promise.resolve(sample.altered);
    }
    calls.push(ref.object_key);
    throw new Error("SYNTHETIC_STOP");
  });
  let error;
  try {
    await index.select("offerings", query, null);
  } catch (e) {
    error = e;
  }
  assert.equal(receivedPin, sample.hashA);
  return { index, calls, error };
}
async function simpleIndex(input, sha) {
  const calls = [];
  const index = new Candidate(basis(input.length, sha), (ref) => {
    if (ref.object_key === "synthetic/root") return Promise.resolve(input);
    calls.push(ref.object_key);
    throw new Error("SYNTHETIC_STOP");
  });
  assert.deepEqual((await index.select("offerings", query, null)).keys, []);
  return await lookupRequest(index, calls);
}
Deno.test("digest-parse race retains verified A when returned bytes change to B", async () => {
  assert.equal(await race(Candidate), "synthetic/a");
});
Deno.test("approval pin is copied before awaited injected read", async () => {
  const fixed = await pinRace(Candidate);
  assert.ok(fixed.error instanceof AccessError);
  assert.equal(fixed.error.code, "current_catalog_key_index_unapproved");
});
Deno.test("valid ordinary view remains readable", async () => {
  const v = await data();
  assert.equal(await simpleIndex(v.original, v.hashA), "synthetic/a");
});
Deno.test("only the exact padded view is hashed and parsed", async () => {
  const v = await data(), buffer = new ArrayBuffer(v.original.length + 8);
  const view = new Uint8Array(buffer, 4, v.original.length);
  view.set(v.original);
  assert.equal(await simpleIndex(view, v.hashA), "synthetic/a");
});
Deno.test("shared-buffer mutation after snapshot cannot replace verified data", async () => {
  assert.equal(await race(Candidate, true), "synthetic/a");
});
Deno.test("user iterator and byteLength accessors cannot choose the copied bytes", async () => {
  const v = await data();
  Object.defineProperty(v.original, Symbol.iterator, {
    value: () => {
      throw new Error("SYNTHETIC_ITERATOR");
    },
  });
  Object.defineProperty(v.original, "byteLength", {
    get() {
      throw new Error("SYNTHETIC_GETTER");
    },
  });
  assert.equal(await simpleIndex(v.original, v.hashA), "synthetic/a");
});
Deno.test("size mismatch is rejected before digest", async () => {
  const v = await data(), pin = basis(v.original.length + 1, v.hashA);
  const index = new Candidate(pin, () => Promise.resolve(v.original));
  await assert.rejects(
    () => index.select("offerings", query, null),
    (error) =>
      error instanceof AccessError && error.code === "current_catalog_key_index_unapproved",
  );
});
Deno.test("correct digest never upgrades invalid JSON", async () => {
  const bad = new TextEncoder().encode("{");
  const index = new Candidate(
    basis(bad.length, await publicKeyRawHash(bad)),
    () => Promise.resolve(bad),
  );
  await assert.rejects(
    () => index.select("offerings", query, null),
    (error) =>
      error instanceof AccessError && error.code === "current_catalog_key_index_unapproved",
  );
});
Deno.test("root cache preserves the original read count and returned page shape", async () => {
  const sample = await data(), pin = basis(sample.original.length, sample.hashA);
  let reads = 0;
  const index = new Candidate(pin, () => {
    reads++;
    return Promise.resolve(sample.original);
  });
  const first = await index.select("offerings", query, null);
  const second = await index.select("offerings", query, null);
  assert.equal(reads, 1);
  assert.deepEqual(first, {
    keys: [],
    nextAfter: null,
    admissionHead: { command_id: "SYNTHETIC", payload_sha256: PAYLOAD },
    coverage: "all_eligible_current_db_observations_at_head",
    indexSha256: sample.hashA,
  });
  assert.deepEqual(second, first);
});
