// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
import { assert, equal } from "./fixture.ts";
import { resolveReferenceTransition } from "../../supabase/functions/_shared/jungsi/infrastructure/reference_projection_transition.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

Deno.test("only absence of evidence selects the existing authority", async () => {
  const signal = new AbortController().signal;
  let oldCalls = 0, newCalls = 0, checks = 0, captures = 0, settled = 0;
  const legacy = {
    async assertCurrent() {
      checks++;
    },
    authorizes() {
      return true;
    },
  };
  const input = {
    signal,
    async readOwnedCurrent() {
      return { body: {} };
    },
    async resolveLegacy() {
      oldCalls++;
      return legacy;
    },
    async resolveProven() {
      newCalls++;
      return null;
    },
    async captureReceipt() {
      captures++;
      return {
        assertCurrent() {
          checks++;
        },
      };
    },
    assertSettledRequest() {
      settled++;
    },
  };
  const authority = await resolveReferenceTransition(input);
  assert(authority);
  await authority.assertCurrent(signal);
  authority.assertSettled!(signal);
  equal(oldCalls, 1);
  equal(newCalls, 0);
  equal(captures, 1);
  equal(settled, 1);
  equal(checks, 3);
});
Deno.test("invalid or null evidence never falls back to the existing authority", async () => {
  const signal = new AbortController().signal;
  let oldCalls = 0, newCalls = 0;
  for (const proof of [null, {}, "forged"]) {
    const result = await resolveReferenceTransition({
      signal,
      async readOwnedCurrent() {
        return { body: { _reference_evidence: proof } };
      },
      async resolveLegacy() {
        oldCalls++;
        return null;
      },
      async resolveProven() {
        newCalls++;
        return null;
      },
      async captureReceipt() {
        return { assertCurrent() {} };
      },
      assertSettledRequest() {},
    });
    equal(result, null);
  }
  equal(oldCalls, 0);
  equal(newCalls, 3);
});
Deno.test("expired or revoked receipt blocks settled legacy delivery without new I/O", async () => {
  const request = new AbortController();
  let valid = true, captures = 0, reads = 0;
  const authority = await resolveReferenceTransition({
    signal: request.signal,
    async readOwnedCurrent() {
      reads++;
      return { body: {} };
    },
    async resolveLegacy() {
      return {
        async assertCurrent() {},
        authorizes() {
          return true;
        },
      };
    },
    async resolveProven() {
      return null;
    },
    async captureReceipt() {
      captures++;
      return {
        assertCurrent() {
          if (!valid) throw new Error("expired or replaced head");
        },
      };
    },
    assertSettledRequest() {},
  });
  assert(authority);
  await authority.assertCurrent(request.signal);
  authority.assertSettled!(request.signal);
  valid = false;
  let rejected = false;
  try {
    authority.assertSettled!(request.signal);
  } catch {
    rejected = true;
  }
  assert(rejected);
  equal(reads, 2);
  equal(captures, 1);
});
Deno.test("ownership read failure or proof verification error never falls back", async () => {
  const signal = new AbortController().signal;
  let oldCalls = 0;
  for (const stage of ["ownership", "proof"]) {
    const attempt = resolveReferenceTransition({
      signal,
      async readOwnedCurrent() {
        if (stage === "ownership") throw Error("denied");
        return { body: { _reference_evidence: {} } };
      },
      async resolveLegacy() {
        oldCalls++;
        return null;
      },
      async resolveProven() {
        throw Error("invalid proof");
      },
      async captureReceipt() {
        return { assertCurrent() {} };
      },
      assertSettledRequest() {},
    });
    assert(await attempt.then(() => false, () => true));
  }
  equal(oldCalls, 0);
});
Deno.test("a report changed after routing cannot use the old authority", async () => {
  const signal = new AbortController().signal;
  let changed = false, captures = 0;
  const authority = await resolveReferenceTransition({
    signal,
    async readOwnedCurrent() {
      const body: NativeObject = changed ? { _reference_evidence: null } : {};
      return { body };
    },
    async resolveLegacy() {
      return {
        async assertCurrent() {},
        authorizes() {
          return true;
        },
      };
    },
    async resolveProven() {
      return null;
    },
    async captureReceipt() {
      captures++;
      return { assertCurrent() {} };
    },
    assertSettledRequest() {},
  });
  assert(authority);
  changed = true;
  assert(await authority.assertCurrent(signal).then(() => false, () => true));
  equal(captures, 0);
});
