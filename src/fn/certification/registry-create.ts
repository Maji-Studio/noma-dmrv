import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { markSubmissionRejected } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/log";
import {
  describeIsometricApiError,
  ghgStatementCreateRefusalMessage,
  IsometricApiError,
  sanitizeIsometricErrorBody,
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
// docs/archive/plans/2026-06-10-certification-reliability-track.md, Phase 2.

// Registry lookup outcome. "multiple" covers lookups that are not
// guaranteed unique server-side (a GHG Statement period can hold several
// drafts); "refused" lets a domain-specific lookup reject the claimed row
// without attempting a POST. Supplier-reference lookups produce neither.
export type ReconcileLookup =
  | { found: "single"; externalId: string }
  | { found: "none" }
  | { found: "multiple" }
  | { found: "refused"; message: string };

// Adapts the supplier-ref reconciliation shape (`found: boolean` — a supplier
// reference is unique in the registry, so "multiple" is unreachable) to the
// module's registry lookup.
export function supplierRefLookup(
  result: { found: true; externalId: string } | { found: false },
): ReconcileLookup {
  return result.found
    ? { found: "single", externalId: result.externalId }
    : { found: "none" };
}

// Adapts the GHG Statement reconciliation shape to the module's registry
// lookup. A period can hold multiple drafts ("multiple"), while a matching
// non-DRAFT is a refusal whose message must be recorded on the claimed row.
export function ghgStatementLookup(
  result: GhgStatementReconciliation,
): ReconcileLookup {
  if (result.found === "single") {
    return { found: "single", externalId: result.externalId };
  }
  if (result.found === "multiple") {
    return { found: "multiple" };
  }
  if (result.found === "refused") {
    return {
      found: "refused",
      message: ghgStatementCreateRefusalMessage({
        id: result.externalId,
        status: result.status,
      }),
    };
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
  orgCtx: OrgContext;
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
  /** Reports only the external GHG Entry mutation state to the submit wrapper. */
  onExternalMutation?: (state: "possible" | "confirmed") => void;
  /** Persists confirmed external identity before any success audit/follow-up. */
  onConfirmed?: (externalId: string) => Promise<void>;
}

const AMBIGUOUS_FALLBACK_MESSAGE =
  "Multiple matching records exist in the registry for this submission. Resolve the duplicates in the registry before retrying.";

export async function performRegistryCreate(
  args: PerformRegistryCreateArgs,
): Promise<RegistryCreateResult> {
  requireOrgRole(args.orgCtx, "admin");
  const log = args.log ?? logger;

  if (args.resumed) {
    const reconciled = await reconcileToResult(args);
    if (reconciled) return reconciled;
  }

  let externalId: string;
  try {
    externalId = await args.create();
  } catch (err) {
    if (externalMutationMayHaveOccurred(err)) {
      args.onExternalMutation?.("possible");
    }
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

    const message =
      err instanceof IsometricApiError
        ? describeIsometricApiError(err)
        : "Registry create failed. Try again.";
    // The failure event keeps `mapping_revision` (so the audit trail names
    // which mapping revision produced the failed payload — ADR 0005 / B3)
    // AND the registry's response body when there is one: an Isometric 4xx
    // carries the actionable detail; a bare status code is undebuggable
    // without it.
    const body =
      err instanceof IsometricApiError
        ? sanitizeIsometricErrorBody(err.body)
        : undefined;
    await appendSyncEventBestEffort(
      args.orgCtx,
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
    await markSubmissionRejected(args.orgCtx, args.submissionRowId, {
      errorMessage: message,
    });
    throw new SafeError(`${args.failureMessagePrefix}: ${message}`);
  }

  args.onExternalMutation?.("confirmed");
  await args.onConfirmed?.(externalId);
  await appendSyncEventBestEffort(
    args.orgCtx,
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
}

// Runs the lookup and translates it: "single" claims the orphan (recording
// the `:reconciled` audit event), "multiple" and "refused" reject the row,
// and "none" returns null so the caller proceeds.
async function reconcileToResult(
  args: PerformRegistryCreateArgs,
): Promise<RegistryCreateResult | null> {
  const lookup = await args.reconcile();
  if (lookup.found === "none") return null;

  if (lookup.found === "refused") {
    await markSubmissionRejected(args.orgCtx, args.submissionRowId, {
      errorMessage: lookup.message,
    });
    throw new SafeError(lookup.message);
  }

  if (lookup.found === "multiple") {
    const message = args.ambiguousMessage ?? AMBIGUOUS_FALLBACK_MESSAGE;
    await markSubmissionRejected(args.orgCtx, args.submissionRowId, {
      errorMessage: message,
    });
    throw new SafeError(message);
  }

  args.onExternalMutation?.("confirmed");
  await args.onConfirmed?.(lookup.externalId);
  await appendSyncEventBestEffort(
    args.orgCtx,
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
        // Mirror the fresh-create path's correlation key so reconciled/orphan
        // claims cross-reference the same supplier ref in the audit trail.
        ...(args.supplierRefId
          ? { supplier_reference_id: args.supplierRefId }
          : {}),
        mapping_revision: MAPPING_REVISION,
      },
    },
    { submissionId: args.submissionRowId },
  );
  return { externalId: lookup.externalId, source: "reconciliation" };
}

function externalMutationMayHaveOccurred(error: unknown): boolean {
  if (!(error instanceof IsometricApiError)) return true;
  if (error.code === "network") return true;
  return (
    error.status === undefined ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}
