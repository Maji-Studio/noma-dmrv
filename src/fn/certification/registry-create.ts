import { markSubmissionRejected } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/log";
import {
  IsometricApiError,
  type GhgStatementReconciliation,
} from "@/lib/isometric";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
import { appendSyncEventBestEffort, ISOMETRIC_PROVIDER } from "./shared";

// One implementation of the registry create-or-reconcile choreography shared
// by datapoint creates, removal creates, and GHG Statement creates:
// POST → on failure, reconcile by lookup → record a sync event → claim the
// orphan or mark the ledger row rejected. A resumed draft reconciles BEFORE
// POSTing, because its previous attempt may have created the record
// server-side while the client saw a network error — POSTing again would
// double-submit.
//
// Lives in fn/ (not lib/) because it composes the isometric client calls with
// data-access ledger/sync-event writes, which data-access must not import.
// Sources mirroring (signed-URL refresh shape) and telemetry (ADR 0006
// journaled-step recovery) stay on their own shapes by decision — see
// docs/plans/2026-06-10-certification-reliability-track.md, Phase 2.

// Three-way reconcile outcome. "multiple" covers lookups that are not
// guaranteed unique server-side (a GHG Statement period can hold several
// drafts); supplier-reference lookups never produce it.
export type ReconcileLookup =
  | { found: "single"; externalId: string }
  | { found: "none" }
  | { found: "multiple" };

// Adapts the supplier-ref reconciliation shape (`found: boolean` — a supplier
// reference is unique in the registry, so "multiple" is unreachable) to the
// module's three-way lookup.
export function supplierRefLookup(
  result: { found: true; externalId: string } | { found: false },
): ReconcileLookup {
  return result.found
    ? { found: "single", externalId: result.externalId }
    : { found: "none" };
}

// Adapts the GHG Statement reconciliation shape to the module's three-way
// lookup. Unlike the supplier-ref shape this genuinely uses all three arms —
// a period can hold multiple drafts ("multiple") — and drops the carried
// `status`/`ids` the create choreography does not need.
export function ghgStatementLookup(
  result: GhgStatementReconciliation,
): ReconcileLookup {
  if (result.found === "single") {
    return { found: "single", externalId: result.externalId };
  }
  if (result.found === "multiple") {
    return { found: "multiple" };
  }
  return { found: "none" };
}

export interface RegistryCreateResult {
  externalId: string;
  // "reconciliation" means the record already existed server-side and was
  // claimed by lookup instead of created by this attempt.
  source: "create" | "reconciliation";
}

export interface PerformRegistryCreateArgs {
  userId: string;
  /** Sync-event identity (certifier_sync_events.entity_type / entity_id). */
  entityType: string;
  entityId: string;
  /** Ledger row claimed for this attempt — rejected on unrecoverable failure. */
  submissionRowId: string;
  /** Sync-event operation key; a reconciled claim appends `:reconciled`. */
  operation: string;
  requestPayload: unknown;
  /** From the claim outcome — a resumed draft reconciles before POSTing. */
  resumed: boolean;
  create: () => Promise<string>;
  reconcile: () => Promise<ReconcileLookup>;
  /** Echoed into the success event for audit cross-referencing. */
  supplierRefId?: string;
  /** Domain wording when the lookup finds multiple candidates. */
  ambiguousMessage?: string;
  failureMessagePrefix: string;
  /** Attempt-scoped logger (e.g. carrying submissionAttemptId). */
  log?: Logger;
}

const AMBIGUOUS_FALLBACK_MESSAGE =
  "Multiple matching records exist in the registry for this submission. Resolve the duplicates in the registry before retrying.";

export async function performRegistryCreate(
  args: PerformRegistryCreateArgs,
): Promise<RegistryCreateResult> {
  const log = args.log ?? logger;

  if (args.resumed) {
    const reconciled = await reconcileToResult(args);
    if (reconciled) return reconciled;
  }

  try {
    const externalId = await args.create();
    await appendSyncEventBestEffort(
      args.userId,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: args.entityType,
        entityId: args.entityId,
        operation: args.operation,
        status: "succeeded",
        requestPayload: args.requestPayload,
        responsePayload: {
          id: externalId,
          ...(args.supplierRefId
            ? { supplier_reference_id: args.supplierRefId }
            : {}),
          mapping_revision: MAPPING_REVISION,
        },
      },
      { submissionId: args.submissionRowId },
    );
    return { externalId, source: "create" };
  } catch (err) {
    log.warn(
      {
        op: args.operation,
        entityId: args.entityId,
        submissionId: args.submissionRowId,
        errorName: err instanceof Error ? err.name : typeof err,
      },
      "registry create failed; attempting reconciliation",
    );
    const reconciled = await reconcileToResult(args);
    if (reconciled) return reconciled;

    const message = err instanceof Error ? err.message : String(err);
    // The failure event keeps `mapping_revision` (so the audit trail names
    // which mapping revision produced the failed payload — ADR 0005 / B3)
    // AND the registry's response body when there is one: an Isometric 4xx
    // carries the actionable detail; a bare status code is undebuggable
    // without it.
    const body = err instanceof IsometricApiError ? err.body : undefined;
    await appendSyncEventBestEffort(
      args.userId,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: args.entityType,
        entityId: args.entityId,
        operation: args.operation,
        status: "failed",
        requestPayload: args.requestPayload,
        responsePayload:
          body === undefined
            ? { mapping_revision: MAPPING_REVISION }
            : { mapping_revision: MAPPING_REVISION, body },
        errorMessage: message,
      },
      { submissionId: args.submissionRowId },
    );
    await markSubmissionRejected(args.userId, args.submissionRowId, {
      errorMessage: message,
    });
    throw new SafeError(`${args.failureMessagePrefix}: ${message}`);
  }
}

// Runs the lookup and translates it: "single" claims the orphan (recording
// the `:reconciled` audit event), "multiple" rejects the row and throws the
// caller's ambiguity wording, "none" returns null so the caller proceeds.
async function reconcileToResult(
  args: PerformRegistryCreateArgs,
): Promise<RegistryCreateResult | null> {
  const lookup = await args.reconcile();
  if (lookup.found === "none") return null;

  if (lookup.found === "multiple") {
    const message = args.ambiguousMessage ?? AMBIGUOUS_FALLBACK_MESSAGE;
    await markSubmissionRejected(args.userId, args.submissionRowId, {
      errorMessage: message,
    });
    throw new SafeError(message);
  }

  await appendSyncEventBestEffort(
    args.userId,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: args.entityType,
      entityId: args.entityId,
      operation: `${args.operation}:reconciled`,
      status: "succeeded",
      requestPayload: args.requestPayload,
      responsePayload: {
        id: lookup.externalId,
        source: "reconciliation",
        mapping_revision: MAPPING_REVISION,
      },
    },
    { submissionId: args.submissionRowId },
  );
  return { externalId: lookup.externalId, source: "reconciliation" };
}
