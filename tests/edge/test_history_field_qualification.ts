import {
  bindFieldQualificationPublication,
  validateFieldServiceQualification,
} from "../../supabase/functions/_shared/jungsi/application/history_field_qualification.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {
  cloneNativeJson,
  nativeJsonSha256,
  nativeJsonText,
  type NativeObject,
} from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

const A = "a".repeat(64),
  B = "b".repeat(64),
  C = "c".repeat(64),
  D = "d".repeat(64);
const SLOT = "final_additional_admission_rank";
const eq = (a: unknown, b: unknown) => {
  if (nativeJsonText(a) !== nativeJsonText(b)) {
    throw new Error("synthetic_expectation_failed");
  }
};
async function fixture() {
  const subject: NativeObject = {
    observation_id: "observation:" + A,
    academic_year: 2025,
    offering_pk: "SYNTHETIC-PK",
    identity_variant_index: 1,
  };
  const cell: NativeObject = {
    value: "17",
    unit: null,
    status: "pending_metadata",
    reason_code: "synthetic_general_metadata_pending",
    source_url: null,
    source_as_of: null,
    statistic_label: "synthetic original label",
    cohort: null,
    source_context: {
      observation_id: subject.observation_id,
      identity_variant_index: 1,
      scope_status: "review_pending",
    },
  };
  const row: NativeObject = {
    academic_year: 2025,
    original_pk: "SYNTHETIC-PK",
    mapping_status: "mapped",
    identity_review: {
      status: "review_pending",
      reason_code: "synthetic_identity_metadata_pending",
      variants: [{ department: "synthetic unrelated variant" }, {
        department: "synthetic selected variant",
      }],
    },
  };
  const approval: NativeObject = {
    field: SLOT,
    subject: cloneNativeJson(subject),
    expected_raw_cell_sha256: await nativeJsonSha256(cell),
    expected_native_value_type: "string",
    expected_raw_status: "pending_metadata",
    expected_raw_unit: null,
    expected_identity_review_sha256: await nativeJsonSha256(
      row.identity_review,
    ),
  };
  const receipt: NativeObject = {
    format: "jungsi.history-field-qualification-receipt/v1",
    status: "approved_exact_fields",
    authority_sha256: A,
    source_head_sha256: D,
    scope_sha256: A,
    expected_previous_manifest_sha256: B,
    subjects: [cloneNativeJson(approval)],
  };
  const receiptBytes = new TextEncoder().encode(nativeJsonText(receipt));
  const receiptSha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", receiptBytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  approval.authority_sha256 = A;
  approval.qualification_receipt_sha256 = receiptSha;
  const descriptor = [approval];
  const pins = {
    publicationSha256: C,
    sourceHeadSha256: D,
    scopeSha256: A,
    authoritySha256: A,
    qualificationReceiptSha256: receiptSha,
    previousManifestSha256: B,
    expectedSubjectCount: 1,
  };
  const bind = () => bindFieldQualificationPublication(descriptor, receiptBytes, pins);
  const pub = await bind();
  const q: NativeObject = {
    format: "jungsi.history-field-service-qualification/v1",
    authority_sha256: A,
    qualification_receipt_sha256: receiptSha,
    subject: cloneNativeJson(subject),
    normalized_service_fields: { status: "verified_official", unit: "번" },
  };
  const originalText = nativeJsonText({ cell, row });
  cell.service_qualification = q;
  return {
    cell,
    row,
    pub,
    approval,
    q,
    originalText,
    subject,
    receipt,
    receiptBytes,
    descriptor,
    pins,
    bind,
  };
}
Deno.test("history field qualification preserves a legacy cell without requiring a qualification descriptor", async () => {
  const f = await fixture();
  const legacy = Object.fromEntries(
    Object.entries(f.cell).filter(([k]) => k !== "service_qualification"),
  );
  eq(
    await validateFieldServiceQualification(SLOT, legacy, f.row, C, null),
    null,
  );
  eq(nativeJsonText({ cell: legacy, row: f.row }), f.originalText);
});
Deno.test("history field qualification accepts an exact approved selected variant and keeps general pending and nulls", async () => {
  const f = await fixture(),
    before = nativeJsonText({ cell: f.cell, row: f.row, pub: f.pub });
  eq(
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, f.pub),
    f.q,
  );
  eq(nativeJsonText({ cell: f.cell, row: f.row, pub: f.pub }), before);
  eq([
    f.cell.value,
    f.cell.status,
    f.cell.unit,
    f.cell.source_url,
    f.cell.source_as_of,
  ], [
    "17",
    "pending_metadata",
    null,
    null,
    null,
  ]);
  eq((f.row.identity_review as NativeObject).status, "review_pending");
});
const cases: [string, (f: Awaited<ReturnType<typeof fixture>>) => void][] = [
  ["wrong authority", (f) => f.q.authority_sha256 = D],
  ["wrong receipt", (f) => f.q.qualification_receipt_sha256 = D],
  ["self-consistent unapproved CID", (f) => {
    (f.q.subject as NativeObject).observation_id = "observation:" + D;
    (f.cell.source_context as NativeObject).observation_id = "observation:" + D;
  }],
  ["self-consistent unapproved variant", (f) => {
    (f.q.subject as NativeObject).identity_variant_index = 0;
    (f.cell.source_context as NativeObject).identity_variant_index = 0;
  }],
  [
    "descriptor substitutes an unapproved tuple with the same authority pair",
    (f) => {
      (f.approval.subject as NativeObject).observation_id = "observation:" + D;
      (f.q.subject as NativeObject).observation_id = "observation:" + D;
      (f.cell.source_context as NativeObject).observation_id = "observation:" +
        D;
    },
  ],
  ["descriptor appends an unapproved subject", (f) => {
    const extra = cloneNativeJson(f.approval);
    (extra.subject as NativeObject).observation_id = "observation:" + D;
    f.descriptor.push(extra);
  }],
  ["changed receipt bytes", (f) => f.receiptBytes[0] ^= 1],
  ["wrong approved receipt pin", (f) => f.pins.qualificationReceiptSha256 = D],
  ["wrong approved authority pin", (f) => f.pins.authoritySha256 = D],
  ["wrong approved source head", (f) => f.pins.sourceHeadSha256 = A],
  ["wrong approved scope", (f) => f.pins.scopeSha256 = B],
  [
    "wrong approved previous manifest",
    (f) => f.pins.previousManifestSha256 = D,
  ],
  ["wrong approved subject count", (f) => f.pins.expectedSubjectCount = 2],
  [
    "wrong CID",
    (f) => (f.q.subject as NativeObject).observation_id = "observation:" + D,
  ],
  ["wrong year", (f) => (f.q.subject as NativeObject).academic_year = 2024],
  [
    "wrong PK",
    (f) => (f.q.subject as NativeObject).offering_pk = "SYNTHETIC-OTHER",
  ],
  [
    "wrong variant",
    (f) => (f.q.subject as NativeObject).identity_variant_index = 0,
  ],
  [
    "boolean variant",
    (f) => (f.q.subject as NativeObject).identity_variant_index = true,
  ],
  ["extra q field", (f) => f.q.source_path = "SYNTHETIC_PRIVATE_PATH"],
  [
    "extra subject field",
    (f) => (f.q.subject as NativeObject).other = "unregistered",
  ],
  [
    "wrong q unit",
    (f) => (f.q.normalized_service_fields as NativeObject).unit = "명",
  ],
  [
    "wrong q status",
    (f) => (f.q.normalized_service_fields as NativeObject).status = "ready",
  ],
  ["null rank", (f) => f.cell.value = null],
  ["numeric rank type", (f) => f.cell.value = 17],
  ["changed original rank", (f) => f.cell.value = "18"],
  ["changed raw status", (f) => f.cell.status = "verified_official"],
  ["changed raw unit", (f) => f.cell.unit = "번"],
  [
    "changed original label",
    (f) => f.cell.statistic_label = "different synthetic label",
  ],
  [
    "changed source context",
    (f) => (f.cell.source_context as NativeObject).scope_status = "source_consistent",
  ],
  ["changed selected variant label", (f) => {
    ((f.row.identity_review as NativeObject).variants as NativeObject[])[1]
      .department = "changed";
  }],
  [
    "changed general identity status",
    (f) => (f.row.identity_review as NativeObject).status = "source_consistent",
  ],
  [
    "changed publication",
    (f) => f.pins.publicationSha256 = D,
  ],
  ["wrong raw cell digest", (f) => f.approval.expected_raw_cell_sha256 = D],
  [
    "wrong identity digest",
    (f) => f.approval.expected_identity_review_sha256 = D,
  ],
  [
    "descriptor promotes another slot",
    (f) => f.approval.field = "competition_ratio",
  ],
  ["descriptor extra permission", (f) => f.approval.allow_other_rows = true],
  [
    "duplicate descriptor subject",
    (f) => f.descriptor.push(cloneNativeJson(f.approval)),
  ],
];
for (const [name, mutate] of cases) {
  Deno.test("history field qualification rejects " + name, async () => {
    const f = await fixture();
    mutate(f);
    try {
      await validateFieldServiceQualification(
        SLOT,
        f.cell,
        f.row,
        C,
        await f.bind(),
      );
    } catch (e) {
      if (
        e instanceof AccessError && e.code === "snapshot_invalid" &&
        e.http === 503
      ) return;
      throw new Error("unexpected_synthetic_rejection");
    }
    throw new Error("synthetic_case_was_not_rejected");
  });
}
for (
  const slot of [
    "competition_ratio",
    "additional_admission_count",
    "alternate_cut",
  ]
) {
  Deno.test("history field qualification refuses another slot " + slot, async () => {
    const f = await fixture();
    try {
      await validateFieldServiceQualification(slot, f.cell, f.row, C, f.pub);
    } catch (e) {
      if (e instanceof AccessError && e.code === "snapshot_invalid") return;
      throw e;
    }
    throw new Error("other_slot_was_not_rejected");
  });
}
Deno.test("history field qualification never accepts self-claimed authority without a verified publication", async () => {
  const f = await fixture();
  try {
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, null);
  } catch (e) {
    if (e instanceof AccessError && e.code === "snapshot_invalid") return;
    throw e;
  }
  throw new Error("self_claimed_authority_was_accepted");
});
Deno.test("history field qualification rejects an unbound context claiming an approved authority pair", async () => {
  const f = await fixture();
  try {
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, {
      ...f.pub,
    });
  } catch (e) {
    if (e instanceof AccessError && e.code === "snapshot_invalid") return;
    throw e;
  }
  throw new Error("unbound_context_was_accepted");
});
Deno.test("history field qualification freezes a verified subject allowlist", async () => {
  const f = await fixture();
  let blocked = false;
  try {
    (f.pub.approvals[0].subject as NativeObject).observation_id = "observation:" + D;
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("verified_context_was_mutable");
  eq(
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, f.pub),
    f.q,
  );
});

Deno.test("history field detached snapshot digest and decode use the same receipt snapshot during async mutation", async () => {
  const f = await fixture(), expected = cloneNativeJson(f.q);
  const pending = f.bind();
  f.receiptBytes.fill(0);
  const pub = await pending;
  eq(
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, pub),
    expected,
  );
});
for (
  const [name, mutate] of ([
    ["q authority", (f) => f.q.authority_sha256 = D],
    [
      "q subject",
      (f) => (f.q.subject as NativeObject).identity_variant_index = 0,
    ],
    [
      "q unit",
      (f) => (f.q.normalized_service_fields as NativeObject).unit = "명",
    ],
    ["raw cell", (f) => f.cell.value = "18"],
    [
      "review",
      (f) =>
        ((f.row.identity_review as NativeObject).variants as NativeObject[])[1]
          .department = "changed",
    ],
  ] as [string, (f: Awaited<ReturnType<typeof fixture>>) => void][])
) {
  Deno.test(
    "history field detached snapshot authenticates one detached input snapshot despite async mutation of " +
      name,
    async () => {
      const f = await fixture(), expected = cloneNativeJson(f.q);
      const pending = validateFieldServiceQualification(
        SLOT,
        f.cell,
        f.row,
        C,
        f.pub,
      );
      mutate(f);
      eq(await pending, expected);
    },
  );
}
Deno.test("history field detached snapshot cannot repair an initially invalid unit during await", async () => {
  const f = await fixture();
  (f.q.normalized_service_fields as NativeObject).unit = "명";
  const pending = validateFieldServiceQualification(
    SLOT,
    f.cell,
    f.row,
    C,
    f.pub,
  );
  (f.q.normalized_service_fields as NativeObject).unit = "번";
  try {
    await pending;
  } catch (e) {
    if (e instanceof AccessError && e.code === "snapshot_invalid") return;
    throw e;
  }
  throw new Error("invalid_initial_snapshot_was_repaired");
});
for (const kind of ["getter", "hidden", "symbol"]) {
  for (
    const location of [
      "q",
      "subject",
      "unit",
      "raw",
      "review",
      "descriptor",
      "pins",
    ]
  ) {
    Deno.test(
      "history field detached snapshot rejects " + kind + " property at " + location +
        " without invoking accessors",
      async () => {
        const f = await fixture();
        let reads = 0;
        const target = location === "q"
          ? f.q
          : location === "subject"
          ? f.q.subject
          : location === "unit"
          ? f.q.normalized_service_fields
          : location === "raw"
          ? f.cell
          : location === "review"
          ? f.row.identity_review
          : location === "descriptor"
          ? f.approval
          : f.pins;
        if (kind === "symbol") {
          Object.defineProperty(target, Symbol("hidden synthetic permission"), {
            value: true,
            enumerable: true,
          });
        } else if (kind === "hidden") {
          Object.defineProperty(target, "hidden_synthetic_permission", {
            value: true,
            enumerable: false,
          });
        } else {Object.defineProperty(target, "synthetic_accessor", {
            enumerable: true,
            get() {
              reads++;
              return reads === 1 ? "번" : "명";
            },
          });}
        try {
          const pub = location === "descriptor" || location === "pins" ? await f.bind() : f.pub;
          await validateFieldServiceQualification(SLOT, f.cell, f.row, C, pub);
        } catch (e) {
          if (
            e instanceof AccessError && e.code === "snapshot_invalid" &&
            reads === 0
          ) return;
          throw new Error("accessor_was_invoked_or_unexpected_rejection");
        }
        throw new Error("non_data_property_was_accepted");
      },
    );
  }
}
Deno.test("history field detached snapshot rejects a unit getter that changes after the first read without reading it", async () => {
  const f = await fixture();
  let reads = 0;
  Object.defineProperty(f.q.normalized_service_fields, "unit", {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      return reads === 1 ? "번" : "명";
    },
  });
  try {
    await validateFieldServiceQualification(SLOT, f.cell, f.row, C, f.pub);
  } catch (e) {
    if (
      e instanceof AccessError && e.code === "snapshot_invalid" && reads === 0
    ) return;
    throw e;
  }
  throw new Error("changing_unit_accessor_was_accepted");
});
for (const target of ["descriptor", "pins"]) {
  Deno.test(
    "history field detached snapshot binds detached factory approval references despite async mutation of " +
      target,
    async () => {
      const f = await fixture(), expected = cloneNativeJson(f.q);
      const pending = f.bind();
      if (target === "descriptor") {
        (f.approval.subject as NativeObject).identity_variant_index = 0;
      } else f.pins.authoritySha256 = D;
      const pub = await pending;
      eq(
        await validateFieldServiceQualification(SLOT, f.cell, f.row, C, pub),
        expected,
      );
    },
  );
}
