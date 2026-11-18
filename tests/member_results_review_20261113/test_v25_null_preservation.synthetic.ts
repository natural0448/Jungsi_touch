import { P1V25V2ReviewInput } from "../../supabase/functions/_shared/jungsi/application/p1_v25_v2_input_builder_candidate.ts";
import { PUBLISHER_VALUE_FIELDS } from "../../supabase/functions/_shared/jungsi/infrastructure/owner_v25_publisher_sql_candidate.ts";
const encode = (x: unknown) => new TextEncoder().encode(JSON.stringify(x) + "\n");
async function sha(x: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(x)))].map((v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
const authority = {
  assertInputCurrent: async () => {},
  assertPublicationCurrent: () => Promise.reject(Error("NO_ISSUER")),
  awaitQuiescence: async () => {},
};
async function build(values: Record<string, unknown>) {
  const input = {
    v25: encode({ academicYear: 2026, offeringPk: "SYN-PK", values }),
    guide: encode({
      academicYear: 2027,
      offeringPk: "SYN-27",
      service_scope: "NOT_ASSESSED_BY_THIS_CANDIDATE",
      historical_keys: [{ academicYear: 2026, offeringPk: "SYN-PK", v25_present: true }],
      guide: {},
    }),
    references: encode({
      academicYear: 2027,
      offeringPk: "SYN-27",
      service_scope: "NOT_ASSESSED_BY_THIS_CANDIDATE",
      references_by_year: {},
    }),
    changes: encode({
      academicYear: 2027,
      offeringPk: "SYN-27",
      priorYear: 2026,
      priorOfferingPk: "SYN-PK",
      service_scope: "NOT_ASSESSED",
      same_cohort_same_final_stage_not_asserted: true,
      automatic_score_or_cut_adjustment: null,
      flags: [],
    }),
    cutContexts: encode({
      academicYear: 2027,
      offeringPk: "SYN-27",
      service_scope: "NOT_ASSESSED_BY_THIS_CANDIDATE",
      three_year_cut_context_candidates: [],
    }),
    ruleSqlReceipt: encode({ synthetic: true }),
  };
  const pins = {
    v25Sha256: await sha(input.v25),
    guideSha256: await sha(input.guide),
    historicalReferencesSha256: await sha(input.references),
    unqualifiedChangeReferencesSha256: await sha(input.changes),
    pendingCutContextReferencesSha256: await sha(input.cutContexts),
    exactRuleSqlReceiptSha256: await sha(input.ruleSqlReceipt),
    previousHeadSha256: "a".repeat(64),
    guideRows: 1,
    v25Rows: 1,
    historicalReferenceRows: 1,
    unqualifiedChangeReferenceRows: 1,
    pendingCutContextReferenceRows: 1,
  };
  return await P1V25V2ReviewInput.open(input, pins, new AbortController().signal, authority);
}
function assert(value: unknown, why: string): asserts value {
  if (!value) throw Error(why);
}
Deno.test("all 13 explicit null values survive review page unchanged", async () => {
  const values: Record<string, unknown> = Object.fromEntries(
    PUBLISHER_VALUE_FIELDS.map((k) => [k, null]),
  );
  const builder = await build(values);
  const page = await builder.page(0, 1, new AbortController().signal);
  assert(page.status === "HOLD_UNPUBLISHED", "status");
  const row = page.rows[0].pastV25[0].source;
  assert(row !== null, "source");
  const result = row.values as Record<string, unknown>;
  for (const k of PUBLISHER_VALUE_FIELDS) assert(Object.hasOwn(result, k) && result[k] === null, k);
});
Deno.test("null, zero text and blank text remain distinct", async () => {
  const values: Record<string, unknown> = Object.fromEntries(
    PUBLISHER_VALUE_FIELDS.map((k) => [k, null]),
  );
  values["최종모집인원"] = "0";
  values["경쟁률"] = "";
  const builder = await build(values),
    page = await builder.page(0, 1, new AbortController().signal);
  const result = page.rows[0].pastV25[0].source?.values as Record<string, unknown>;
  assert(
    result["최종모집인원"] === "0" && result["경쟁률"] === "" && result["수시이월인원"] === null,
    "native distinctions",
  );
});
Deno.test("missing, numeric, boolean and object field are rejected", async () => {
  for (const invalid of [undefined, 0, false, {}]) {
    const values: Record<string, unknown> = Object.fromEntries(
      PUBLISHER_VALUE_FIELDS.map((k) => [k, null]),
    );
    if (invalid === undefined) delete values["경쟁률"];
    else values["경쟁률"] = invalid;
    let failed = false;
    try {
      await build(values);
    } catch {
      failed = true;
    }
    assert(failed, "invalid source accepted");
  }
});
Deno.test("review result does not supply publication authority", async () => {
  const builder = await build(Object.fromEntries(PUBLISHER_VALUE_FIELDS.map((k) => [k, null])));
  let failed = false;
  try {
    await builder.validateIssuedParts({} as never, [], {
      maxParts: 1,
      maxRows: 1,
      maxDecodedBytes: 1,
      maxPartBytes: 1,
      maxDepth: 1,
    }, new AbortController().signal);
  } catch {
    failed = true;
  }
  assert(failed, "publication bypass");
});
