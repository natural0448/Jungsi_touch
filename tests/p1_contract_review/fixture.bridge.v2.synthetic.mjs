/** Synthetic P1 fixture adapted from the preserved repository test. */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { nativeJsonText } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { HISTORY_SNAPSHOT_SLOTS } from "../../supabase/functions/_shared/jungsi/application/history_snapshot.ts";
import {
  bindReviewedR27Links,
  bindReviewedR27Scope,
  combineReviewedR27Scopes,
} from "../../supabase/functions/_shared/jungsi/application/r27_standalone.ts";
import {
  bindP1R27Evidence,
  composeP1R27Candidate,
} from "../../supabase/functions/_shared/jungsi/application/p1_r27_composition.ts";
const S = "a".repeat(64),
  H = "b".repeat(64),
  OLD = "c".repeat(64),
  PUB = "d".repeat(64),
  SCOPE = "e".repeat(64),
  EV = "f".repeat(64);
const encode = (x) => new TextEncoder().encode(nativeJsonText(x));
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) =>
    n.toString(16).padStart(2, "0")
  ).join("");
const ident = (r) =>
  Object.fromEntries(
    ["academic_year", "school_id", "original_pk", "campus", "admission_track", "group"].map(
      (k) => [k, r[k]],
    ),
  );
function sourceRow(overrides = {}) {
  return {
    academic_year: 2027,
    school_id: "SYN-SCHOOL",
    original_pk: "SYN-PK",
    campus: "SYN-CAMPUS",
    admission_track: "SYN-TRACK",
    group: "SYN-GROUP",
    university_name: "SYN SCHOOL",
    department: "SYN DEPARTMENT",
    region: "SYN REGION",
    scope: { state: "eligible_non_practical", evidence_sha256: EV },
    source_ref: "SYN-PRIVATE-REF",
    quota_value: 0,
    quota_literal_state: "source_reported",
    quota_stage: null,
    quota_cell: {
      status: "pending_metadata",
      reason_code: "SYN_PENDING",
      unit: "명",
      source_as_of: "2026-01-01",
    },
    ...overrides,
  };
}
function emptyCell(slot) {
  const cut = slot.endsWith("percent_cut") || slot === "alternate_cut";
  return {
    value: null,
    unit: null,
    status: "not_published",
    reason_code: "SYN_UNPUBLISHED",
    source_url: null,
    source_as_of: null,
    statistic_label: null,
    cohort: null,
    source_context: null,
    ...(slot === "recruitment_count_with_stage" ? { stage: "unspecified" } : {}),
    ...(slot === "alternate_cut" ? { entries: [], omitted_other_basis_count: 0 } : {}),
    ...(cut
      ? {
        statistic_percent: slot === "final_50_percent_cut"
          ? 50
          : slot === "final_70_percent_cut"
          ? 70
          : 75,
        basis_code: null,
        basis_label: null,
        cohort_code: null,
        cohort_label: null,
        selection_rule_ref: null,
      }
      : {}),
  };
}
function historical(year = 2026, overrides = {}) {
  const pk = overrides.original_pk ?? "SYN-OLD";
  return {
    offering_id: year + ":" + pk,
    academic_year: year,
    original_pk: pk,
    observation_key: null,
    mapping_status: "mapped",
    identity_review: { status: "source_consistent", reason_code: null, variants: [] },
    university_id: "SYN-SCHOOL",
    university_name: "SYN SCHOOL",
    region: null,
    campus: "SYN-CAMPUS",
    department: "SYN PRIOR",
    admission_track: "SYN-TRACK",
    group: "SYN-GROUP",
    ...Object.fromEntries(HISTORY_SNAPSHOT_SLOTS.map((slot) => [slot, emptyCell(slot)])),
    ...overrides,
  };
}
async function scopes(rows) {
  const unique = new Map();
  for (const r of rows) {
    if (r.scope.state !== "review_pending" && r.scope.evidence_sha256) {
      const g = {
        source: ident(r),
        state: r.scope.state,
        evidence_sha256: r.scope.evidence_sha256,
      };
      unique.set(JSON.stringify(g.source), g);
    }
  }
  const contexts = [], grants = [...unique.values()];
  for (let i = 0; i < grants.length; i += 64) {
    const b = encode({
      format: "jungsi.r27-reviewed-scope/v1",
      status: "approved_scope_mappings",
      source_sha256: S,
      grants: grants.slice(i, i + 64),
    });
    contexts.push(await bindReviewedR27Scope(b, { receiptSha256: await hash(b), sourceSha256: S }));
  }
  return contexts.length ? combineReviewedR27Scopes(contexts) : undefined;
}
async function links(grants) {
  if (!grants.length) return undefined;
  const b = encode({
    format: "jungsi.r27-reviewed-links/v1",
    status: "approved_exact_mappings",
    source_sha256: S,
    grants,
  });
  return bindReviewedR27Links(b, { receiptSha256: await hash(b), sourceSha256: S });
}
const grant = (r, target) => ({
  source: ident(r),
  target,
  review_state: "approved",
  evidence_sha256: EV,
});
const target = (r) => ({
  academic_year: r.academic_year,
  school_id: r.university_id,
  original_pk: r.original_pk,
  campus: r.campus,
  admission_track: r.admission_track,
  group: r.group,
});

async function evidenceFor(rows, overrides = {}, previousPub = PUB) {
  const pages = [];
  for (let i = 0; i < rows.length; i += 128) pages.push(rows.slice(i, i + 128));
  if (!pages.length) pages.push([]);
  const pageBytes = pages.map((items, index) =>
    encode({
      format: "jungsi.r27-source-page/v1",
      source_sha256: S,
      source_head_sha256: H,
      index,
      rows: items,
    })
  );
  const pagePins = [];
  for (let i = 0; i < pageBytes.length; i++) {
    pagePins.push({
      sha256: await hash(pageBytes[i]),
      bytes: pageBytes[i].length,
      rows: pages[i].length,
    });
  }
  const coverage = {
    format: "jungsi.r27-coverage-receipt/v1",
    source_sha256: S,
    source_head_sha256: H,
    previous_publication_sha256: previousPub,
    previous_source_head_sha256: OLD,
    scope_sha256: SCOPE,
    snapshot_isolation: "repeatable_read",
    source_mode: "current_logical_view",
    head_rechecked: true,
    writer_stable: true,
    previous_scope_mapping_reviewed: true,
    expected_rows: rows.length,
    source_only: 0,
    view_only: 0,
    full_scope_duplicates: 0,
    unresolved_pk_groups: 0,
    value_mismatches: 0,
    numeric_mismatches: 0,
    null_presence_mismatches: 0,
    literal_mismatches: 0,
    ...overrides,
  };
  const coverageBytes = encode(coverage), coverageSha = await hash(coverageBytes);
  const manifestBytes = encode({
    format: "jungsi.r27-page-manifest/v1",
    source_sha256: S,
    source_head_sha256: H,
    coverage_sha256: coverageSha,
    previous_publication_sha256: previousPub,
    previous_source_head_sha256: OLD,
    scope_sha256: SCOPE,
    expected_rows: rows.length,
    pages: pagePins,
  });
  const pins = {
    manifest_sha256: await hash(manifestBytes),
    coverage_sha256: coverageSha,
    source_sha256: S,
    source_head_sha256: H,
    previous_publication_sha256: previousPub,
    previous_source_head_sha256: OLD,
    scope_sha256: SCOPE,
  };
  return { pageBytes, coverageBytes, manifestBytes, pins };
}
async function previousPort(groups) {
  const parts = [], images = [];
  for (let i = 0; i < groups.length; i++) {
    const rows = groups[i], partId = "SYN-PART-" + i, payloadId = "SYN-OLD-PAYLOAD";
    const raw = encode({
      format: "jungsi.history-snapshot/v1",
      payload_id: payloadId,
      part_id: partId,
      rows,
    });
    const gzip = new Uint8Array(gzipSync(raw));
    images.push(gzip);
    parts.push({
      partId,
      payloadId,
      gzipBytes: gzip.length,
      gzipSha256: await hash(gzip),
      decodedBytes: raw.length,
      decodedSha256: await hash(raw),
      rows: rows.length,
      mappedRows: rows.filter((r) => r.mapping_status === "mapped").length,
      mappingPendingRows: rows.filter((r) => r.mapping_status === "mapping_pending").length,
      objectKey: "SYN-PRIVATE-" + i,
    });
  }
  const counts = {
    rows: groups.flat().length,
    mapped_rows: parts.reduce((n, p) => n + p.mappedRows, 0),
    mapping_pending_rows: parts.reduce((n, p) => n + p.mappingPendingRows, 0),
    observations: 0,
    schools: 0,
  };
  const manifestParts = parts.map((p) => ({
    part_id: p.partId,
    payload_id: p.payloadId,
    object_key: p.objectKey,
    gzip_bytes: p.gzipBytes,
    gzip_sha256: p.gzipSha256,
    decoded_bytes: p.decodedBytes,
    decoded_sha256: p.decodedSha256,
    rows: p.rows,
    mapped_rows: p.mappedRows,
    mapping_pending_rows: p.mappingPendingRows,
  }));
  const manifestBytes = encode({
    format: "jungsi.history-snapshot-manifest/v1",
    status: "approved",
    snapshot_id: "SYN-OLD",
    source_head_sha256: OLD,
    scope_sha256: SCOPE,
    generated_at: "2026-01-01T00:00:00Z",
    source_as_of: "2026-01-01",
    schema_version: "jungsi.history-snapshot/v1",
    normalization_rules_version: "SYN-NORM",
    normalization_rules_sha256: "1".repeat(64),
    selection_rules_version: "SYN-SELECT",
    selection_rules_sha256: "2".repeat(64),
    counts,
    full: null,
    parts: manifestParts,
  });
  const pub = {
    snapshotId: "SYN-OLD",
    publicationSha256: await hash(manifestBytes),
    sourceHeadSha256: OLD,
    scopeSha256: SCOPE,
    generatedAt: "2026-01-01T00:00:00Z",
    sourceAsOf: "2026-01-01",
    schemaVersion: "jungsi.history-snapshot/v1",
    normalizationRulesVersion: "SYN-NORM",
    selectionRulesVersion: "SYN-SELECT",
    expiresAtUtc: 9_999_999n,
    counts,
    full: null,
    parts,
  };
  return {
    pub,
    manifestBytes,
    images,
    calls: 0,
    finishes: 0,
    failFinish: false,
    readPinnedBatch(request) {
      return new Promise((resolve) => {
        this.calls++;
        assert.equal(typeof request.previous_publication_sha256, "string");
        resolve({
          publication: this.pub,
          manifest_bytes: this.manifestBytes,
          gzip_parts: this.images,
        });
      });
    },
    assertCurrent(request) {
      return new Promise((resolve) => {
        this.finishes++;
        assert.equal(request.previous_publication_sha256, this.pub.publicationSha256);
        if (this.failFinish) throw Error("SYN_PREVIOUS_CHANGED");
        resolve();
      });
    },
  };
}
function buildLimits(overrides = {}) {
  return {
    max_baseline_parts: 200,
    max_combined_rows: 10000,
    max_body_bytes: 10000000,
    max_baseline_gzip_bytes: 10000000,
    max_baseline_decoded_bytes: 10000000,
    max_part_gzip_bytes: 1000000,
    max_part_decoded_bytes: 1000000,
    max_depth: 64,
    ...overrides,
  };
}
async function fixture(rows, groups = [[historical()]], opts = {}) {
  const previous = await previousPort(groups);
  const e = await evidenceFor(rows, opts.coverage ?? {}, previous.pub.publicationSha256);
  const context = await bindP1R27Evidence(e.manifestBytes, e.coverageBytes, e.pins);
  const scope = await scopes(rows), link = await links(opts.links ?? []);
  const source = {
    calls: 0,
    finishes: 0,
    pages: e.pageBytes,
    failFinish: false,
    readPage(index) {
      return new Promise((resolve) => {
        this.calls++;
        resolve(this.pages[index]);
      });
    },
    assertSourceHead(head) {
      return new Promise((resolve) => {
        this.finishes++;
        assert.equal(head, H);
        if (this.failFinish) throw Error("SYN_SOURCE_CHANGED");
        resolve();
      });
    },
  };
  return {
    ...e,
    context,
    scope,
    link,
    previous,
    source,
    build: () =>
      composeP1R27Candidate(
        previous,
        source,
        context,
        scope,
        link,
        "SYN-NEW-PAYLOAD",
        buildLimits(),
      ),
  };
}

export { buildLimits, encode, fixture, grant, H, hash, historical, S, sourceRow, target };
