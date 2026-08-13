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

export type RegistryExternalMutation = "possible" | "confirmed";
export type RegistryExternalMutationReporter = (
  state: RegistryExternalMutation,
) => void;

type ReconciliationAttempt =
  | { kind: "result"; result: RegistryCreateResult | null }
  | { kind: "lookup-failed"; error: unknown };

export interface PerformRegistryCreateArgs {
  orgCtx: OrgContext;
  /** Sync-event identity (certifier_sync_events.entity_type / entity_id). */
  entityType: string;
  entityId: string;
  /**
   * Ledger row claimed for this attempt, rejected on unrecoverable failure.
   * Explicit standalone syncs may omit it while retaining sync-event audit.
   */
  submissionRowId?: string;
  /** Exact draft lock owned by this attempt, for rejection compare-and-set. */
  expectedLockedAt?: Date;
  /** Owning pipeline performs attempt-wide definitive-failure cleanup. */
  deferRejectionToAttempt?: boolean;
  /** Sync-event operation key; a reconciled claim appends `:reconciled`. */
  operation: string;
  requestPayload: unknown;
  /** Reconcile before POSTing whenever an earlier attempt may have reached the registry. */
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
  /** Reports possible or confirmed registry mutation to the owning attempt. */
  onExternalMutation?: RegistryExternalMutationReporter;
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
    const reconciliation = await reconcileToResult(args, true);
    if (reconciliation.kind === "lookup-failed") {
      // A resumed draft exists precisely because an earlier request may have
      // reached the registry. A failed lookup cannot resolve that uncertainty.
      args.onExternalMutation?.("possible");
      throw reconciliation.error;
    }
    if (reconciliation.result) return reconciliation.result;
  }

  let externalId: string;
  try {
    externalId = await args.create();
  } catch (err) {
    const mutationPossible = externalMutationMayHaveOccurred(err);
    if (mutationPossible) {
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
    const reconciliation = await reconcileToResult(args, !mutationPossible);
    if (reconciliation.kind === "lookup-failed") {
      const lookupError = reconciliation.error;
      log.warn(
        {
          op: args.operation,
          entityId: args.entityId,
          submissionId: args.submissionRowId,
          errorName:
            lookupError instanceof Error
              ? lookupError.name
              : typeof lookupError,
        },
        "registry reconciliation lookup failed",
      );
      if (mutationPossible) throw lookupError;
      // A definitive provider refusal remains definitive even when the
      // follow-up lookup is unavailable. Preserve the provider error below.
    }
    if (
      reconciliation.kind === "result" &&
      reconciliation.result
    ) {
      return reconciliation.result;
    }

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
    // A timeout/network/5xx may have committed despite the missing response.
    // A lookup miss cannot prove otherwise, so keep the draft locked for a
    // later reconciliation attempt. Definitive refusals may be unlocked.
    if (!mutationPossible) {
      await markSubmissionRejectedBestEffort(args, message);
    }
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
  rejectDefinitiveOutcome: boolean,
): Promise<ReconciliationAttempt> {
  let lookup: ReconcileLookup;
  try {
    lookup = await args.reconcile();
  } catch (error) {
    return { kind: "lookup-failed", error };
  }
  if (lookup.found === "none") return { kind: "result", result: null };

  if (lookup.found === "refused") {
    if (rejectDefinitiveOutcome) {
      await markSubmissionRejectedBestEffort(args, lookup.message);
    }
    throw new SafeError(lookup.message);
  }

  if (lookup.found === "multiple") {
    const message = args.ambiguousMessage ?? AMBIGUOUS_FALLBACK_MESSAGE;
    if (rejectDefinitiveOutcome) {
      await markSubmissionRejectedBestEffort(args, message);
    }
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
  return {
    kind: "result",
    result: { externalId: lookup.externalId, source: "reconciliation" },
  };
}

async function markSubmissionRejectedBestEffort(
  args: PerformRegistryCreateArgs,
  errorMessage: string,
): Promise<void> {
  if (args.deferRejectionToAttempt || !args.submissionRowId) return;
  const log = args.log ?? logger;
  try {
    await markSubmissionRejected(args.orgCtx, args.submissionRowId, {
      errorMessage,
      ...(args.expectedLockedAt
        ? { expectedLockedAt: args.expectedLockedAt }
        : {}),
    });
  } catch (cleanupError) {
    log.warn(
      {
        submissionId: args.submissionRowId,
        cleanupErrorName:
          cleanupError instanceof Error
            ? cleanupError.name
            : typeof cleanupError,
      },
      "failed to reject registry submission draft",
    );
  }
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
