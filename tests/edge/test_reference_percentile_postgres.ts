// deno-lint-ignore-file require-await
// 합성 포트 대역의 기존 비동기 반환과 실행 순서를 보존한다.
/** Synthetic current DB rows only; no real credentials, values, uploads or SQL writes. */
import {
  ExistingReferencePercentileDbReader,
  REFERENCE_CDF_BYTES_SQL,
  REFERENCE_PK_METADATA_SQL,
} from "../../supabase/functions/_shared/jungsi/infrastructure/reference_percentile_postgres.ts";
import { RuntimeReadBudget } from "../../supabase/functions/_shared/jungsi/infrastructure/runtime_controls.ts";
import type { NativeSqlTransaction } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import { assert, equal } from "./fixture.ts";
const H = (x: string) => x.repeat(64), owner = "00000000-0000-0000-0000-000000000001";
async function sha(v: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(v)))].map((x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}
async function fixture(maxBytes = 50000) {
  const source = new TextEncoder().encode('{"synthetic":"original"}');
  const gzip = new Uint8Array(
    await new Response(new Blob([source]).stream().pipeThrough(new CompressionStream("gzip")))
      .arrayBuffer(),
  );
  const cdf = await sha(source),
    compressed = await sha(gzip),
    methodId = "estimated-whole-cohort-percentile:" + H("9"),
    manifest = H("a");
  const method = JSON.stringify({
    method_id: methodId,
    metric: "estimated_upper_cumulative_percent_all_examinees",
    native_score_and_source_definition_metadata: { academic_year: 2027, engine_approved: false },
  });
  const row: unknown[] = [
    "reference-percentile:" + manifest,
    H("b"),
    H("c"),
    "2027",
    "physical-pk",
    methodId,
    await sha(new TextEncoder().encode(method)),
    cdf,
    method,
    String(source.length),
    compressed,
    String(gzip.length),
    "gzip",
    manifest,
  ];
  const encoded = btoa(String.fromCharCode(...gzip));
  const state = { rows: [row] as unknown[][], encoded, reads: 0, bodyReads: 0 };
  const sql = {
    async read<T>(
      who: string,
      work: (tx: NativeSqlTransaction) => Promise<T>,
      signal?: AbortSignal,
    ) {
      if (who !== owner || signal?.aborted) throw Error("scope");
      return await work({
        async query(sql, _p, s) {
          if (s?.aborted) throw Error("aborted");
          state.reads++;
          if (sql === REFERENCE_PK_METADATA_SQL) return state.rows;
          if (sql === REFERENCE_CDF_BYTES_SQL) {
            state.bodyReads++;
            return [[state.encoded]];
          }
          throw Error("unexpected");
        },
      });
    },
  };
  const budget = new RuntimeReadBudget({ maxRequests: 8, maxBytes });
  const reader = new ExistingReferencePercentileDbReader(
    sql,
    { reserveExternalRead: (n) => budget.reserveExternal(n) },
    4096,
    8388608,
    maxBytes,
  );
  return { reader, source, gzip, row, state, budget };
}
async function denied(f: () => Promise<unknown>) {
  let yes = false;
  try {
    await f();
  } catch {
    yes = true;
  }
  assert(yes);
}
Deno.test("current DB source reads by year and physical PK and verifies original gzip and source SHA", async () => {
  const f = await fixture(),
    s = new AbortController().signal,
    pin = await f.reader.select(owner, 2027, "physical-pk", s);
  assert(pin !== null);
  equal([...await f.reader.source(owner, pin, s)], [...f.source]);
  equal(f.state.reads, 2);
  assert(
    REFERENCE_PK_METADATA_SQL.includes("p.academic_year=$1") &&
      REFERENCE_PK_METADATA_SQL.includes("p.offering_pk=$2"),
  );
  assert(!REFERENCE_PK_METADATA_SQL.includes("p.school_id=$"));
  equal(f.budget.snapshot().requests, 2);
});
Deno.test("DB reader rejects duplicate PK, unapproved metadata and bad method hash", async () => {
  for (const kind of ["duplicate", "hash", "year", "manifest", "size"]) {
    const f = await fixture(), s = new AbortController().signal;
    if (kind === "duplicate") f.state.rows.push([...f.row]);
    if (kind === "hash") f.row[6] = H("f");
    if (kind === "year") f.row[3] = "2026";
    if (kind === "manifest") f.row[13] = H("f");
    if (kind === "size") f.row[9] = "8388609";
    await denied(() => f.reader.select(owner, 2027, "physical-pk", s));
    equal(f.state.bodyReads, 0);
  }
});
Deno.test("DB source rejects changed gzip bytes and does not raise existing byte budget", async () => {
  const f = await fixture(),
    s = new AbortController().signal,
    pin = await f.reader.select(owner, 2027, "physical-pk", s);
  assert(pin !== null);
  f.state.encoded = "A" + f.state.encoded.slice(1);
  await denied(() => f.reader.source(owner, pin, s));
  const limited = await fixture(4096),
    pin2 = await limited.reader.select(owner, 2027, "physical-pk", s);
  assert(pin2 !== null);
  await denied(() => limited.reader.source(owner, pin2, s));
  equal(limited.state.bodyReads, 0);
});
Deno.test("missing PK stays missing and cancelled request cannot read source", async () => {
  const f = await fixture(), ctrl = new AbortController();
  f.state.rows = [];
  equal(await f.reader.select(owner, 2027, "physical-pk", ctrl.signal), null);
  ctrl.abort();
  await denied(() => f.reader.select(owner, 2027, "physical-pk", ctrl.signal));
  equal(f.state.reads, 1);
});
