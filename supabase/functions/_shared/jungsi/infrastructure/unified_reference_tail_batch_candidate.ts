/** Opt-in request-local composition of the unified Guide issuer and existing batched CDF reader.
 * All approved source, scope, same-head, artifact and live lease authorities remain required. */
import { AccessError } from "../application/access.ts";
import type { SavedTailRequestBudget } from "./saved_reference_tail_source.ts";
import {
  type ReferenceIssuerBatchInput,
  SelectedReferenceIssuerBatch,
} from "./selected_reference_issuer_batch_candidate.ts";
import {
  type CdfBatchInputs,
  createBatchedExistingReferenceTailSource,
} from "./reference_cdf_batch_reader_candidate.ts";
function fail(): never {
  throw new AccessError("reference_tail_unavailable", 503);
}
/** Does not register or activate the runtime. Pending records remain null; integrity failures fail. */
export async function createUnifiedBatchedReferenceTail(
  issuerInput: ReferenceIssuerBatchInput,
  cdfInput: CdfBatchInputs,
  maxObjects: number,
  maxBytes: number,
  sharedBudget?: SavedTailRequestBudget,
) {
  if (
    !issuerInput || !cdfInput || issuerInput.request !== cdfInput.request ||
    issuerInput.boundary !== cdfInput.boundary || issuerInput.sql !== cdfInput.sql ||
    issuerInput.budget !== cdfInput.budget ||
    cdfInput.owner !== issuerInput.request.session.user.subjectId ||
    !Array.isArray(cdfInput.keys) || cdfInput.keys.length !== issuerInput.keys.length
  ) fail();
  const guideIds = issuerInput.keys.map((v) => v.academicYear === 2027 ? v.offeringPk : "");
  const cdfIds = cdfInput.keys.map((v) => v.offeringPk);
  if (
    new Set(guideIds).size !== guideIds.length || new Set(cdfIds).size !== cdfIds.length ||
    guideIds.some((id) => !id || !cdfIds.includes(id))
  ) fail();
  // Independent authority implementations must bind the returned Guide keys to the CDF metadata
  // school IDs, selected calculator artifact, current heads, profile and request budget. Matching
  // PKs alone only prevents accidental scope expansion; they grant no access or equivalence.
  const issuer = await SelectedReferenceIssuerBatch.create(issuerInput);
  if (issuerInput.boundary.signal.aborted) fail();
  const result = await createBatchedExistingReferenceTailSource(
    cdfInput,
    issuer,
    maxObjects,
    maxBytes,
    sharedBudget,
  );
  if (issuerInput.boundary.signal.aborted) fail();
  return Object.freeze({ issuer, reader: result.reader, tail: result.tail });
}
