/**
 * The REVIEW hash of a compiled Removal submission — the fingerprint the operator
 * is actually shown and consents to, and the one `submitRemoval` re-asserts before
 * claiming.
 *
 * It is deliberately NOT `payloadHash(semanticPayload)`. That full hash includes
 * the Isometric Source IDs, which only exist once a supporting file has been
 * copied to the registry. Submission copies pending files as one of its own
 * steps, so hashing the IDs makes the reviewed artifact change as a side effect
 * of submitting it. Two failures follow:
 *
 *   1. A submission that copies some files and then fails partway persists the
 *      IDs it already created. The operator's hash is now stale, so a plain
 *      retry is rejected ("source data changed") before it can finish the
 *      remaining copies — the retry can never succeed without a manual reload.
 *   2. Because the strict post-copy artifact could never match the reviewed one,
 *      there was nothing to compare it against, so a supporting file removed or
 *      reclassified mid-submission could slip into the claimed artifact
 *      unreviewed.
 *
 * Stripping the IDs fixes both: the reviewed fingerprint stays stable while the
 * IDs materialize, so a retry resumes, AND the post-copy artifact becomes
 * comparable, so a changed evidence set is caught. What the operator reviewed is
 * still fully covered — `candidateSources` carries every supporting file's
 * documentId and binding, so adding, removing, or rebinding a file still moves
 * the hash. Only the registry-assigned IDs, which the operator never sees, are
 * excluded.
 *
 * Generated evidence ledgers are also excluded. They materialize during submit
 * from transport and durability inputs already covered by the review, so their
 * document IDs do not exist when the operator opens it. The full payload hash
 * still covers their candidate records, binding targets, and Source IDs.
 *
 * The full `payloadHash` remains the supersede / drift fingerprint: the persisted
 * snapshot must still change when the IDs do.
 */
import { payloadHash } from "@/lib/isometric/utils/payload-hash";

/** Keys whose values are registry-assigned Source IDs, not reviewed content. */
const SOURCE_ID_KEY = "sourceIds";
const SOURCE_BINDING_PLAN_KEY = "sourceBindingPlan";
const CANDIDATE_SOURCES_KEY = "candidateSources";
const GENERATED_LEDGER_ROLES = new Set([
  "transport_evidence_ledger",
  "durability_evidence_ledger",
]);

/**
 * Hash a compiled semantic payload with every registry-assigned Source ID
 * removed. Unknown payload shapes pass through untouched, so a future field is
 * hashed by default rather than silently dropped from the operator's review.
 */
export function reviewPayloadHash(
  semanticPayload: Record<string, unknown>,
): string {
  return payloadHash(stripSourceIds(semanticPayload));
}

function stripSourceIds(
  semanticPayload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(semanticPayload)) {
    if (key === SOURCE_ID_KEY) continue;
    if (key === SOURCE_BINDING_PLAN_KEY && Array.isArray(value)) {
      out[key] = value
        .filter((entry) => !isGeneratedLedgerBinding(entry))
        .map(stripBindingSourceId);
      continue;
    }
    if (key === CANDIDATE_SOURCES_KEY && Array.isArray(value)) {
      out[key] = value.filter(
        (candidate) => !isGeneratedLedgerCandidate(candidate),
      );
      continue;
    }
    out[key] = stripNestedSourceIds(value);
  }
  return out;
}

function stripNestedSourceIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNestedSourceIds);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== SOURCE_ID_KEY)
      .map(([key, nestedValue]) => [key, stripNestedSourceIds(nestedValue)]),
  );
}

function isGeneratedLedgerBinding(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return GENERATED_LEDGER_ROLES.has(
    String((value as Record<string, unknown>).nomaRole),
  );
}

function isGeneratedLedgerCandidate(value: unknown): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const binding = (value as Record<string, unknown>).binding;
  return isGeneratedLedgerBinding(binding);
}

/**
 * Drop `sourceId` from one binding-plan entry. Everything else about the binding
 * — which document, which role, which template input it targets — is reviewed
 * content and stays hashed.
 */
function stripBindingSourceId(entry: unknown): unknown {
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
    return entry;
  }
  const copy = { ...(entry as Record<string, unknown>) };
  delete copy.sourceId;
  return copy;
}
