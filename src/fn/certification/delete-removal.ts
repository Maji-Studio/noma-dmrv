import { isRemovalProductionBatchShared } from "@/data-access/removal-production-batch-deletion";
import { deleteProductionBatch, getProductionBatch, findProductionBatchBySupplierRef } from "@/lib/isometric/production-batches";
import { deleteMeasurementSample, getMeasurementSample, findMeasurementSampleBySupplierRef } from "@/lib/isometric/measurement-samples";
import {
  claimRemovalDeletion,
  finalizeRemovalDeletion,
  releaseRemovalDeletionClaim,
  withRemovalDeletionMutation,
  type RemovalDeletionClaim,
  type RemovalDeletionRegistryOutcome,
} from "@/data-access/certifier-removal-deletion";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  deleteBiocharApplication,
  deleteGhgEntry,
  findBiocharApplicationBySupplierReference,
  reconcileRemoval,
} from "@/lib/isometric";
import {
  getIsometricClientForOrg,
  IsometricApiError,
  type IsometricClient,
} from "@/lib/isometric/client";
import {
  describeIsometricApiError,
  isMissingIsometricResource,
  sanitizeIsometricErrorBody,
} from "@/lib/isometric/error-utils";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "@/lib/isometric/utils/constants";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import type { DeleteRemovalInput } from "@/schemas/certification";
import { appendSyncEventBestEffort } from "./shared";

/**
 * Deletes a Removal that never finalized, cleaning up the registry first.
 *
 * Order matters: the GHG Entry goes first because the registry only deletes
 * it while it is still DRAFT. A refusal there means the Removal progressed on
 * the registry side without our ledger knowing, so nothing else is touched
 * and the claim is released. Biochar Applications follow. A GHG Entry or
 * registration whose POST was interrupted before the registry ID came back is
 * resolved by its supplier reference first. Every DELETE tolerates a 404 so a
 * retry after a partial cleanup converges; the claim is released on any
 * failure after it was taken, registry or local, so the Removal never stays
 * frozen behind a `deleting` lock.
 *
 * No role floor for now: any member may delete (issue #746).
 *
 * This module is deliberately not a `"use server"` file: the core takes a
 * caller-supplied `OrgContext`, so it must never be registered as a callable
 * server action. The action lives in `delete-removal-action.ts`.
 */

export interface RemovalDeletionResult {
  removalId: string;
  deletedGhgEntryIds: string[];
  deletedBiocharApplicationIds: string[];
  releasedSliceCount: number;
  releasedDocumentMirrorCount: number;
}

type RegistryDeleteOutcome = "deleted" | "absent";
type RegistryDeleteRequest = (send: () => Promise<void>) => Promise<RegistryDeleteOutcome>;

interface RegistryDeleteTarget {
  removalId: string;
  operation: string;
  kind: "GHG Entry" | "Biochar Application" | "MeasurementSample" | "ProductionBatch";
  externalId: string;
}

// Certify signals "this record is not in a deletable state" with a request
// or conflict error; auth, rate-limit, and not-found refusals say nothing
// about the record's status.
const REGISTRY_STATE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([
  400, 409, 422,
]);

const PARTIAL_CLEANUP_NOTE =
  "Some registry records were already deleted. Run Delete Removal again to finish the cleanup.";
const LOCAL_FAILURE_MESSAGE =
  "The Removal could not be removed locally. Try again.";
const RETRY_SUFFIX = " Try again.";

export async function deleteRemoval(
  orgCtx: OrgContext,
  input: DeleteRemovalInput,
): Promise<RemovalDeletionResult> {
  const { facilityId, removalId } = input;
  const log = logger.child({ op: "removal:delete", removalId });

  const claim = await claimRemovalDeletion(orgCtx, facilityId, removalId);
  const registry: RemovalDeletionRegistryOutcome = {
    deletedGhgEntryIds: [],
    deletedBiocharApplicationIds: [],
    absentGhgEntryIds: [],
    absentBiocharApplicationIds: [],
    unresolvedBiocharApplicationReferences: [],
    productionBatches: [],
    measurementSamples: [],
  };

  let releasedSliceCount: number;
  let releasedDocumentMirrorCount: number;
  try {
    if (claimNeedsRegistryCleanup(claim)) {
      const client = await getIsometricClientForOrg(orgCtx.organizationId);
      await deleteRegistryRecords(orgCtx, client, claim, registry);
    }
    const finalized = await finalizeRemovalDeletion(orgCtx, claim, registry);
    releasedSliceCount = finalized.releasedSliceCount;
    releasedDocumentMirrorCount = finalized.releasedDocumentMirrors.length;
  } catch (error) {
    // The release is TTL-bounded, so a failure here must not hide the
    // original error behind a raw database error.
    try {
      await releaseRemovalDeletionClaim(orgCtx, claim);
    } catch (releaseError) {
      log.error(
        {
          errorName:
            releaseError instanceof Error ? releaseError.name : typeof releaseError,
          errorMessage: sanitizeErrorMessage(releaseError),
        },
        "removal deletion claim could not be released; lock expires with the TTL",
      );
    }
    log.warn(
      {
        lockedSubmissionCount: claim.lockedSubmissions.length,
        deletedGhgEntryCount: registry.deletedGhgEntryIds.length,
        deletedBiocharApplicationCount:
          registry.deletedBiocharApplicationIds.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: sanitizeErrorMessage(error),
      },
      "removal delete stopped before local cleanup",
    );
    throw toDeletionError(error, registry);
  }
  const { deletedGhgEntryIds, deletedBiocharApplicationIds } = registry;
  await appendSyncEventBestEffort(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      operation: "removal:delete",
      status: "succeeded",
      responsePayload: {
        deleted_ghg_entry_ids: deletedGhgEntryIds,
        deleted_biochar_application_ids: deletedBiocharApplicationIds,
        absent_ghg_entry_ids: registry.absentGhgEntryIds,
        absent_biochar_application_ids: registry.absentBiocharApplicationIds,
        unresolved_biochar_application_references:
          registry.unresolvedBiocharApplicationReferences,
        production_batches: registry.productionBatches ?? [],
        measurement_samples: registry.measurementSamples ?? [],
        released_slice_count: releasedSliceCount,
        released_document_mirror_count: releasedDocumentMirrorCount,
      },
    },
    { removalId },
  );
  log.info(
    {
      deletedGhgEntryCount: deletedGhgEntryIds.length,
      deletedBiocharApplicationCount: deletedBiocharApplicationIds.length,
      releasedSliceCount,
      releasedDocumentMirrorCount,
    },
    "removal deleted",
  );
  return {
    removalId,
    deletedGhgEntryIds,
    deletedBiocharApplicationIds,
    releasedSliceCount,
    releasedDocumentMirrorCount,
  };
}

function claimNeedsRegistryCleanup(claim: RemovalDeletionClaim): boolean {
  return (
    claim.externalRemovalIds.length > 0 ||
    claim.unconfirmedRemovalSupplierRefs.length > 0 ||
    claim.biocharApplications.length > 0 ||
    (claim.productionBatches?.length ?? 0) > 0 ||
    (claim.measurementSamples?.length ?? 0) > 0
  );
}

async function deleteRegistryRecords(
  orgCtx: OrgContext,
  client: IsometricClient,
  claim: RemovalDeletionClaim,
  out: RemovalDeletionRegistryOutcome,
): Promise<void> {
  const ghgEntryIds = [...claim.externalRemovalIds];
  for (const supplierRef of claim.unconfirmedRemovalSupplierRefs) {
    const found = await auditedLookup(
      orgCtx,
      {
        removalId: claim.removalId,
        operation: "removal:delete:ghg-entry",
        supplierReference: supplierRef,
      },
      () => reconcileRemoval(client, { supplierRefId: supplierRef }),
    );
    if (found.found && !ghgEntryIds.includes(found.externalId)) {
      ghgEntryIds.push(found.externalId);
    }
  }
  for (const ghgEntryId of ghgEntryIds) {
    const outcome = await deleteRegistryRecord(
      orgCtx,
      {
        removalId: claim.removalId,
        operation: "removal:delete:ghg-entry",
        kind: "GHG Entry",
        externalId: ghgEntryId,
      },
      (request) => withRemovalDeletionMutation(orgCtx, claim,
        () => request(() => deleteGhgEntry(client, ghgEntryId))),
    );
    if (outcome === "deleted") out.deletedGhgEntryIds.push(ghgEntryId);
    else out.absentGhgEntryIds.push(ghgEntryId);
  }
  for (const application of claim.biocharApplications) {
    const externalApplicationId =
      application.externalApplicationId ??
      (await auditedLookup(
        orgCtx,
        {
          removalId: claim.removalId,
          operation: "removal:delete:biochar-application",
          supplierReference: application.supplierReference,
        },
        () =>
          resolveUnconfirmedBiocharApplication(
            client,
            application.supplierReference,
          ),
      ));
    if (externalApplicationId === null) {
      out.unresolvedBiocharApplicationReferences.push(
        application.supplierReference,
      );
      continue;
    }
    const outcome = await deleteRegistryRecord(
      orgCtx,
      {
        removalId: claim.removalId,
        operation: "removal:delete:biochar-application",
        kind: "Biochar Application",
        externalId: externalApplicationId,
      },
      (request) => withRemovalDeletionMutation(orgCtx, claim,
        () => request(() => deleteBiocharApplication(client, externalApplicationId))),
    );
    if (outcome === "deleted") {
      out.deletedBiocharApplicationIds.push(externalApplicationId);
    } else {
      out.absentBiocharApplicationIds.push(externalApplicationId);
    }
  }
  for (const measurement of claim.measurementSamples ?? []) {
    let remote = await auditedLookup(orgCtx, {
      removalId: claim.removalId, operation: "removal:delete:measurement-sample",
      supplierReference: measurement.supplierReference,
    }, () => findMeasurementSampleBySupplierRef(client, measurement.supplierReference, { requireUnique: true }));
    if (!remote && measurement.externalId) remote = await getMeasurementSample(client, measurement.externalId);
    if (remote && (remote.supplier_reference_id !== measurement.supplierReference ||
      (measurement.externalId && remote.id !== measurement.externalId))) {
      throw new SafeError("The registry measurement does not match this Removal version. Ask support to check it before deleting.");
    }
    const externalId = remote?.id ?? measurement.externalId;
    const outcome = remote && externalId ? await deleteRegistryRecord(orgCtx, {
      removalId: claim.removalId, operation: "removal:delete:measurement-sample",
      kind: "MeasurementSample", externalId,
    }, (request) => withRemovalDeletionMutation(orgCtx, claim,
      () => request(() => deleteMeasurementSample(client, externalId)))) : "absent";
    out.measurementSamples!.push({ ...measurement, externalId, outcome });
  }
  for (const batch of claim.productionBatches ?? []) {
    if (await isRemovalProductionBatchShared(orgCtx, claim, batch)) {
      out.productionBatches!.push({ creditBatchId: batch.creditBatchId, externalId: batch.externalProductionBatchId, outcome: "retained" });
      continue;
    }
    let remote = batch.externalProductionBatchId
      ? await getProductionBatch(client, batch.externalProductionBatchId) : null;
    // A lost journal or a previously deleted identity can still hide a POST.
    if (!remote) remote = await findProductionBatchBySupplierRef(client, batch.supplierReference);
    if (remote && (!batch.externalFacilityId || remote.facility_id !== batch.externalFacilityId || remote.supplier_reference_id !== batch.supplierReference ||
      (batch.externalProductionBatchId && remote.id !== batch.externalProductionBatchId))) {
      throw new SafeError("The registry production batch does not match its saved identity. Ask support to check it before deleting.");
    }
    const externalId = remote?.id ?? batch.externalProductionBatchId;
    // Lock through the final sharing decision and DELETE. Membership and
    // submission cannot take over if the lease expires during the request.
    const mutate = (request: RegistryDeleteRequest) => withRemovalDeletionMutation(orgCtx, claim, async (tx) => {
      if (await isRemovalProductionBatchShared(orgCtx, claim, batch, tx)) return "retained" as const;
      if (!remote) return "absent" as const;
      return request(() => deleteProductionBatch(client, remote.id));
    });
    const outcome = remote ? await deleteRegistryRecord(orgCtx, {
      removalId: claim.removalId, operation: "removal:delete:production-batch",
      kind: "ProductionBatch", externalId: remote.id,
    }, mutate) : await mutate(async () => "absent");
    out.productionBatches!.push({ creditBatchId: batch.creditBatchId, externalId, outcome });
  }
}

// A supplier-reference lookup can be refused deterministically (duplicate
// references, pagination limit). Record that on the sync-event log before it
// propagates so the operator sees why the deletion stopped.
async function auditedLookup<T>(
  orgCtx: OrgContext,
  target: { removalId: string; operation: string; supplierReference: string },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await appendSyncEventBestEffort(
      orgCtx,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: target.removalId,
        operation: target.operation,
        status: "failed",
        requestPayload: { supplier_reference_id: target.supplierReference },
        responsePayload:
          error instanceof IsometricApiError
            ? (sanitizeIsometricErrorBody(error.body) ?? null)
            : null,
        errorMessage: sanitizeErrorMessage(error),
      },
      { removalId: target.removalId },
    );
    throw error;
  }
}

// A `creating` registration means the POST may or may not have landed. The
// supplier reference is the only handle, so ask the registry whether a
// Biochar Application carries it before deciding there is nothing to delete.
async function resolveUnconfirmedBiocharApplication(
  client: IsometricClient,
  supplierReference: string,
): Promise<string | null> {
  const remote = await findBiocharApplicationBySupplierReference(
    client,
    supplierReference,
  );
  return remote?.id ?? null;
}

async function deleteRegistryRecord<T extends RegistryDeleteOutcome | "retained">(
  orgCtx: OrgContext,
  target: RegistryDeleteTarget,
  run: (request: RegistryDeleteRequest) => Promise<T>,
): Promise<T | "absent"> {
  const { removalId, operation, externalId } = target;
  const captured: { attempt?: { outcome: RegistryDeleteOutcome } | { error: unknown } } = {};
  let outcome!: T;
  let fenceFailed = false;
  let fenceError: unknown;
  try {
    outcome = await run(async (send) => {
      try {
        await send();
        captured.attempt = { outcome: "deleted" };
        return "deleted";
      } catch (error) {
        if (isMissingIsometricResource(error,
          target.kind === "ProductionBatch" || target.kind === "MeasurementSample" ? target.kind : null,
          externalId)) {
          captured.attempt = { outcome: "absent" };
          return "absent";
        }
        captured.attempt = { error };
        throw error;
      }
    });
  } catch (error) {
    fenceFailed = true;
    fenceError = error;
  }
  // Capture only the provider request inside the lock; connection, validation,
  // SQL, commit, and unlock failures remain local errors. Audit after release.
  const attempt = captured.attempt;
  if (attempt && "error" in attempt) {
    const error = attempt.error;
    const message = error instanceof SafeError ? error.message : registryDeleteRefusalMessage(error, target);
    await appendSyncEventBestEffort(
      orgCtx,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: removalId,
        operation,
        status: "failed",
        requestPayload: { id: externalId },
        responsePayload:
          error instanceof IsometricApiError
            ? (sanitizeIsometricErrorBody(error.body) ?? null)
            : null,
        errorMessage: message,
      },
      { removalId },
    );
    if (fenceFailed && fenceError !== error) throw fenceError;
    throw new SafeError(message);
  }
  // The protected callback has finished and released its dedicated locks.
  // Pooled audit writes must not wait behind a membership writer holding the
  // pool connection while that writer waits for those same locks.
  if (attempt && "outcome" in attempt) await appendSyncEventBestEffort(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      operation,
      status: "succeeded",
      requestPayload: { id: externalId },
      responsePayload: { id: externalId, outcome: attempt.outcome },
    },
    { removalId },
  );
  if (fenceFailed) throw fenceError;
  return outcome;
}

function registryDeleteRefusalMessage(
  error: unknown,
  target?: RegistryDeleteTarget,
): string {
  const kindLabel = target?.kind === "ProductionBatch" ? "Production Batch" : target?.kind === "MeasurementSample" ? "Measurement sample" : target?.kind;
  const label = target
    ? `${kindLabel} ${target.externalId}`
    : "the registry records";
  if (error instanceof IsometricApiError) {
    if (error.code === "not_configured") return error.message;
    const detail = describeIsometricApiError(error);
    if (isRegistryStateRefusal(error) && target?.kind !== "ProductionBatch" && target?.kind !== "MeasurementSample") {
      return `Isometric did not delete ${label}. ${detail} Only draft registry records can be deleted. Nothing was removed locally.`;
    }
    return `Isometric did not delete ${label}. ${detail} Nothing was removed locally. Try again.`;
  }
  return `Isometric did not delete ${label}. Nothing was removed locally. Try again.`;
}

function isRegistryStateRefusal(error: IsometricApiError): boolean {
  return (
    error.status !== undefined &&
    REGISTRY_STATE_REFUSAL_STATUSES.has(error.status)
  );
}

// Anything thrown after the claim reaches the operator through here. Only a
// registry error is described as a registry refusal; a local failure (the
// finalize transaction, client setup) says so. A partial registry cleanup is
// called out so the next step is obvious.
function toDeletionError(
  error: unknown,
  registry: RemovalDeletionRegistryOutcome,
): SafeError {
  const base =
    error instanceof SafeError
      ? error.message
      : error instanceof IsometricApiError
        ? registryDeleteRefusalMessage(error)
        : LOCAL_FAILURE_MESSAGE;
  const partial =
    registry.deletedGhgEntryIds.length > 0 ||
    registry.deletedBiocharApplicationIds.length > 0 ||
    registry.productionBatches?.some((item) => item.outcome === "deleted") ||
    registry.measurementSamples?.some((item) => item.outcome === "deleted");
  if (!partial) return new SafeError(base);
  // One next action only: the partial note replaces a generic retry prompt.
  const withoutRetry = base.endsWith(RETRY_SUFFIX)
    ? base.slice(0, -RETRY_SUFFIX.length)
    : base;
  return new SafeError(`${withoutRetry} ${PARTIAL_CLEANUP_NOTE}`);
}
