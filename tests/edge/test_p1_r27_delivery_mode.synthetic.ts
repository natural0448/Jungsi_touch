/** Synthetic v2-only delivery invariant; no real source or storage. */
import { assertP1R27DeliveryMode } from "../../supabase/functions/_shared/jungsi/application/p1_r27_delivery_mode.ts";
import {
  HistorySnapshotService,
  type SnapshotPublication,
  validateQualifiedHistorySnapshotPayload,
} from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import { validateP1PreparedPartsGlobal } from "../../supabase/functions/_shared/jungsi/application/p1_r27_global_parts.ts";
import { SYNTHETIC_RUNTIME_NOW as NOW } from "./synthetic_runtime_binding.ts";
import {
  syntheticSnapshotPart,
  syntheticSnapshotPublication,
} from "./synthetic_history_snapshot.ts";
import { assert } from "./fixture.ts";
const full = syntheticSnapshotPart(false, null),
  part = syntheticSnapshotPart(false, "SYNTHETIC-part");
const base = syntheticSnapshotPublication();
const v2 = (fullValue: typeof full | null, parts: typeof part[]): SnapshotPublication => ({
  ...base,
  schemaVersion: "jungsi.history-snapshot/v2",
  full: fullValue,
  parts,
});
async function rejected(work: () => unknown | Promise<unknown>) {
  let failed = false;
  try {
    await work();
  } catch {
    failed = true;
  }
  assert(failed);
}
Deno.test("v2 permits exactly one full or one parts representation; v1 keeps both", async () => {
  assertP1R27DeliveryMode(v2(full, []));
  assertP1R27DeliveryMode(v2(null, [part]));
  await rejected(() => assertP1R27DeliveryMode(v2(full, [part])));
  await rejected(() => assertP1R27DeliveryMode(v2(null, [])));
  assertP1R27DeliveryMode({ ...base, full, parts: [part] });
});
Deno.test("publisher global gate rejects both before copying any part bytes", async () => {
  const original = Uint8Array.prototype.set;
  let copies = 0;
  Uint8Array.prototype.set = function (...args) {
    copies++;
    return original.apply(this, args);
  };
  try {
    await rejected(() =>
      validateP1PreparedPartsGlobal(v2(full, [part]), [new Uint8Array(part.decodedBytes)], {
        maxParts: 2,
        maxRows: 10,
        maxDecodedBytes: 4096,
        maxPartBytes: 4096,
        maxDepth: 32,
      })
    );
    assert(copies === 0);
  } finally {
    Uint8Array.prototype.set = original;
  }
});
Deno.test("qualified direct validator rejects mixed mode before inspecting body", async () => {
  let reads = 0;
  const raw = new Proxy({}, {
    ownKeys() {
      reads++;
      throw new Error("unexpected");
    },
  });
  await rejected(() => validateQualifiedHistorySnapshotPayload(raw, part, v2(full, [part])));
  assert(reads === 0);
});
Deno.test("v2 head and read service rejects mixed mode before requesting body", async () => {
  let reads = 0, finishes = 0;
  const mixed = v2(full, [part]);
  const source = {
    current: () => Promise.resolve(mixed),
    read: () => {
      reads++;
      return Promise.reject(new Error("unexpected"));
    },
    assertCurrent: () => {
      finishes++;
      return Promise.resolve();
    },
  };
  const service = new HistorySnapshotService(source, { nowUtc: () => NOW }, base.scopeSha256);
  const session = {
    user: { subjectId: "SYNTHETIC-owner", expiresAtUtc: NOW + 120000000n },
    evaluatedAtUtc: NOW,
    tier: "standard" as const,
    paidUntilUtc: null,
  };
  await rejected(() => service.head(session, {}));
  await rejected(() => service.read(session, base.snapshotId, {}));
  assert(reads === 0 && finishes === 0);
});
Deno.test("v1 head still accepts legacy simultaneous full and parts", async () => {
  const p = { ...base, full, parts: [part] };
  let finished = 0;
  const source = {
    current: () => Promise.resolve(p),
    read: () => Promise.reject(new Error("unexpected")),
    assertCurrent: () => {
      finished++;
      return Promise.resolve();
    },
  };
  const service = new HistorySnapshotService(source, { nowUtc: () => NOW }, base.scopeSha256);
  const session = {
    user: { subjectId: "SYNTHETIC-owner", expiresAtUtc: NOW + 120000000n },
    evaluatedAtUtc: NOW,
    tier: "standard" as const,
    paidUntilUtc: null,
  };
  const output = await service.head(session, {});
  assert(output.delivery_mode === "full" && finished === 1);
});

Deno.test("v2 delivery accessor is refused without invoking it", async () => {
  let touched = false;
  const p = v2(null, [part]);
  Object.defineProperty(p, "full", {
    enumerable: true,
    get() {
      touched = true;
      throw new Error("unexpected");
    },
  });
  await rejected(() => assertP1R27DeliveryMode(p));
  assert(!touched);
});
