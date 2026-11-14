/** REVIEW ONLY: internal 2027 assembly. No route, writer, or production admission.
 * The installed server guard must independently authenticate the request, authorize
 * the complete ordered scope and shared admission, and bind the approved composite
 * head and publication before and after all chunks. This candidate proves neither
 * physical query count nor cancellation, real budgets, source eligibility, or rollout.
 */
import { AccessError } from "./jungsi/application/access.ts";
import type { ApiExecution, ApiExecutionBoundary } from "./jungsi/application/api_dispatch.ts";
import type { RequestClockPort } from "./jungsi/application/ports.ts";
import { sessionDto } from "./jungsi/application/session_service.ts";
import type {
  CurrentPublicCatalogPort,
  PublicCatalogPublication,
} from "./current_public_catalog.ts";
import {
  CurrentPublicR27SelectionService,
  type Own2027SelectionItem,
  type Own2027SelectionKey,
  type Own2027SelectionTrust,
} from "./current_public_r27_selection.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const CHUNK = 100;
/** Conservative candidate limit, not an operating budget or approval. */
export const OWN_2027_CANDIDATE_MAX_KEYS = 1000;
const fail = (code = "current_catalog_unavailable"): never => {
  throw new AccessError(code, 503);
};

function exact(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("current_catalog_page_invalid");
  }
  const proto = Object.getPrototypeOf(raw);
  const keys = Reflect.ownKeys(raw);
  if (
    (proto !== Object.prototype && proto !== null) || keys.length !== fields.length ||
    keys.some((k) => typeof k !== "string" || !fields.includes(k))
  ) return fail("current_catalog_page_invalid");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !d.enumerable || !("value" in d)) return fail("current_catalog_page_invalid");
    Object.defineProperty(result, key, { value: d.value, enumerable: true });
  }
  return Object.freeze(result);
}

function keysSnapshot(raw: unknown): readonly Own2027SelectionKey[] {
  if (!Array.isArray(raw)) return fail("current_catalog_page_invalid");
  const d = Object.getOwnPropertyDescriptor(raw, "length"), keys = Reflect.ownKeys(raw);
  if (
    !d || !("value" in d) || !Number.isSafeInteger(d.value) || d.value < 1 ||
    d.value > OWN_2027_CANDIDATE_MAX_KEYS || keys.length !== d.value + 1
  ) return fail("current_catalog_page_invalid");
  const out: Own2027SelectionKey[] = [], seen = new Set<string>();
  for (let i = 0; i < d.value; i++) {
    const entry = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!entry || !entry.enumerable || !("value" in entry)) {
      return fail("current_catalog_page_invalid");
    }
    const k = exact(entry.value, ["academic_year", "school_id", "offering_pk"]);
    if (
      k.academic_year !== 2027 || typeof k.school_id !== "string" || !ID.test(k.school_id) ||
      typeof k.offering_pk !== "string" || !ID.test(k.offering_pk) ||
      !ID.test("2027:" + k.offering_pk) || seen.has(k.offering_pk)
    ) return fail("current_catalog_page_invalid");
    seen.add(k.offering_pk);
    out.push(Object.freeze({
      academic_year: 2027,
      school_id: k.school_id,
      offering_pk: k.offering_pk,
    }));
  }
  return Object.freeze(out);
}

function checkedPublication(raw: unknown, now: bigint): PublicCatalogPublication {
  const p = exact(raw, ["version", "sha256", "expiresAtUtc"]);
  if (
    typeof p.version !== "string" || !ID.test(p.version) ||
    typeof p.sha256 !== "string" || !HASH.test(p.sha256) ||
    typeof p.expiresAtUtc !== "bigint" || typeof now !== "bigint" || now >= p.expiresAtUtc
  ) return fail("current_catalog_publication_unapproved");
  return Object.freeze({ version: p.version, sha256: p.sha256, expiresAtUtc: p.expiresAtUtc });
}

function binding(raw: unknown, publication: PublicCatalogPublication): Readonly<{
  subject_id: string;
  publication_sha256: string;
  head_sha256: string;
}> {
  const b = exact(raw, ["subject_id", "publication_sha256", "head_sha256"]);
  if (
    typeof b.subject_id !== "string" || !ID.test(b.subject_id) ||
    b.publication_sha256 !== publication.sha256 ||
    typeof b.head_sha256 !== "string" || !HASH.test(b.head_sha256)
  ) return fail("current_catalog_publication_unapproved");
  return Object.freeze({
    subject_id: b.subject_id,
    publication_sha256: b.publication_sha256,
    head_sha256: b.head_sha256,
  });
}

/** Both injected guards must be server-authenticated; the whole-scope guard must
 * authorize all keys under this same admitted request, not merely echo the input. */
export class CurrentPublicR27BoundedService {
  constructor(
    private readonly current: CurrentPublicCatalogPort,
    private readonly requestClock: RequestClockPort,
    private readonly wholeTrust: Own2027SelectionTrust,
    private readonly chunkTrust: Own2027SelectionTrust,
  ) {}

  async selectedOwn2027Guides(
    request: ApiExecution,
    boundary: ApiExecutionBoundary,
    rawKeys: unknown,
  ): Promise<
    Readonly<{
      publication_sha256: string;
      head_sha256: string;
      items: readonly Own2027SelectionItem[];
    }>
  > {
    const keys = keysSnapshot(rawKeys);
    if (
      !boundary || !(boundary.signal instanceof AbortSignal) || boundary.signal.aborted ||
      boundary.admission === undefined || boundary.admission === null ||
      !this.wholeTrust || typeof this.wholeTrust.bind !== "function" ||
      !this.chunkTrust || typeof this.chunkTrust.bind !== "function"
    ) return fail("security_policy_unavailable");
    const admission = boundary.admission, signal = boundary.signal, session = request.session;
    const subject = session.user.subjectId, user = session.user;
    const assertRequest = () => {
      if (
        boundary.signal !== signal || signal.aborted || boundary.admission !== admission ||
        request.session !== session || session.user !== user || user.subjectId !== subject
      ) return fail("security_policy_unavailable");
      sessionDto(session, this.requestClock.nowUtc());
    };
    const pubCall = this.current.publication.bind(this.current);
    const lookupCall = this.current.lookup.bind(this.current);
    const bindWhole = this.wholeTrust.bind.bind(this.wholeTrust);
    const bindChunk = this.chunkTrust.bind.bind(this.chunkTrust);
    assertRequest();
    const firstPub = checkedPublication(await pubCall(), this.requestClock.nowUtc());
    assertRequest();
    const first = binding(await bindWhole(request, boundary, keys, firstPub), firstPub);
    if (first.subject_id !== subject) return fail("security_policy_unavailable");
    assertRequest();

    const checkedCurrent: CurrentPublicCatalogPort = {
      publication: async () => {
        assertRequest();
        const pub = checkedPublication(await pubCall(), this.requestClock.nowUtc());
        assertRequest();
        if (
          pub.version !== firstPub.version || pub.sha256 !== firstPub.sha256 ||
          pub.expiresAtUtc !== firstPub.expiresAtUtc
        ) return fail("current_catalog_state_unapproved");
        return pub;
      },
      lookup: async (s, ids, recruitment) => {
        assertRequest();
        if (s !== subject || recruitment !== true) return fail("security_policy_unavailable");
        const result = await lookupCall(s, ids, recruitment);
        assertRequest();
        return result;
      },
      search: () => Promise.reject(new AccessError("current_catalog_unavailable", 503)),
    };
    const chunkGuard: Own2027SelectionTrust = Object.freeze({ bind: bindChunk });
    const service = new CurrentPublicR27SelectionService(
      checkedCurrent,
      this.requestClock,
      chunkGuard,
    );
    const items: Own2027SelectionItem[] = [];
    for (let offset = 0; offset < keys.length; offset += CHUNK) {
      assertRequest();
      const part = Object.freeze(keys.slice(offset, offset + CHUNK));
      const result = await service.selectedOwn2027Guides(request, boundary, part);
      assertRequest();
      if (
        result.publication_sha256 !== firstPub.sha256 || result.head_sha256 !== first.head_sha256 ||
        result.items.length !== part.length
      ) return fail("current_catalog_state_unapproved");
      for (let i = 0; i < part.length; i++) {
        const item = result.items[i], expected = part[i];
        if (
          item.academic_year !== 2027 || item.school_id !== expected.school_id ||
          item.offering_pk !== expected.offering_pk ||
          item.offering_id !== "2027:" + expected.offering_pk || item.status !== "HOLD"
        ) return fail("current_catalog_identity_conflict");
        items.push(item);
      }
    }
    const endPub = checkedPublication(await pubCall(), this.requestClock.nowUtc());
    assertRequest();
    const last = binding(await bindWhole(request, boundary, keys, endPub), endPub);
    assertRequest();
    if (
      endPub.version !== firstPub.version || endPub.sha256 !== firstPub.sha256 ||
      endPub.expiresAtUtc !== firstPub.expiresAtUtc || last.subject_id !== subject ||
      last.head_sha256 !== first.head_sha256
    ) return fail("current_catalog_state_unapproved");
    return Object.freeze({
      publication_sha256: firstPub.sha256,
      head_sha256: first.head_sha256,
      items: Object.freeze(items),
    });
  }
}
