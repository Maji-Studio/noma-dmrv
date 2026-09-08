import {
  claimRemovalDeletion,
  finalizeRemovalDeletion,
  releaseRemovalDeletionClaim,
  type RemovalDeletionClaim,
} from "@/data-access/certifier-removal-deletion";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  deleteBiocharApplication,
  deleteGhgEntry,
  findBiocharApplicationBySupplierReference,
} from "@/lib/isometric";
import {
  getIsometricClientForOrg,
  IsometricApiError,
  type IsometricClient,
} from "@/lib/isometric/client";
import { describeIsometricApiError } from "@/lib/isometric/error-utils";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "@/lib/isometric/utils/constants";
import { logger } from "@/lib/log";
import type { DeleteRemovalInput } from "@/schemas/certification";
import { appendSyncEventBestEffort } from "./shared";

/**
 * Deletes a Removal that never finalized, cleaning up the registry first.
 *
 * Order matters: the GHG Entry goes first because the registry only deletes
 * it while it is still DRAFT. A refusal there means the Removal progressed on
 * the registry side without our ledger knowing, so nothing else is touched
 * and the claim is released. Biochar Applications follow; a registration
 * whose POST was interrupted before the registry ID came back is resolved by
 * its supplier reference first. Every DELETE tolerates a 404 so a retry after
 * a partial cleanup converges.
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
}

type RegistryDeleteOutcome = "deleted" | "absent";

export async function deleteRemoval(
  orgCtx: OrgContext,
  input: DeleteRemovalInput,
): Promise<RemovalDeletionResult> {
  requireOrgRole(orgCtx, "admin");
  const { facilityId, removalId } = input;
  const log = logger.child({ op: "removal:delete", removalId });

  const claim = await claimRemovalDeletion(orgCtx, facilityId, removalId);
  const deletedGhgEntryIds: string[] = [];
  const deletedBiocharApplicationIds: string[] = [];

  if (
    claim.externalRemovalIds.length > 0 ||
    claim.biocharApplications.length > 0
  ) {
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    try {
      await deleteRegistryRecords(orgCtx, client, claim, {
        deletedGhgEntryIds,
        deletedBiocharApplicationIds,
      });
    } catch (error) {
      await releaseRemovalDeletionClaim(orgCtx, claim);
      const message =
        error instanceof SafeError
          ? error.message
          : registryDeleteRefusalMessage(error);
      log.warn(
        { submissionId: claim.lockedSubmission?.id ?? null },
        "removal delete stopped before local cleanup",
      );
      throw error instanceof SafeError ? error : new SafeError(message);
    }
  }

  const { releasedSliceCount } = await finalizeRemovalDeletion(orgCtx, claim, {
    deletedGhgEntryIds,
    deletedBiocharApplicationIds,
  });
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
        released_slice_count: releasedSliceCount,
      },
    },
    { removalId },
  );
  log.info(
    {
      deletedGhgEntryCount: deletedGhgEntryIds.length,
      deletedBiocharApplicationCount: deletedBiocharApplicationIds.length,
      releasedSliceCount,
    },
    "removal deleted",
  );
  return {
    removalId,
    deletedGhgEntryIds,
    deletedBiocharApplicationIds,
    releasedSliceCount,
  };
}

async function deleteRegistryRecords(
  orgCtx: OrgContext,
  client: IsometricClient,
  claim: RemovalDeletionClaim,
  out: {
    deletedGhgEntryIds: string[];
    deletedBiocharApplicationIds: string[];
  },
): Promise<void> {
  for (const ghgEntryId of claim.externalRemovalIds) {
    const outcome = await deleteRegistryRecord(
      orgCtx,
      claim.removalId,
      "removal:delete:ghg-entry",
      ghgEntryId,
      `GHG Entry ${ghgEntryId}`,
      () => deleteGhgEntry(client, ghgEntryId),
    );
    if (outcome === "deleted") out.deletedGhgEntryIds.push(ghgEntryId);
  }
  for (const application of claim.biocharApplications) {
    const externalApplicationId =
      application.externalApplicationId ??
      (await resolveUnconfirmedBiocharApplication(
        client,
        application.supplierReference,
      ));
    if (externalApplicationId === null) continue;
    const outcome = await deleteRegistryRecord(
      orgCtx,
      claim.removalId,
      "removal:delete:biochar-application",
      externalApplicationId,
      `Biochar Application ${externalApplicationId}`,
      () => deleteBiocharApplication(client, externalApplicationId),
    );
    if (outcome === "deleted") {
      out.deletedBiocharApplicationIds.push(externalApplicationId);
    }
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

async function deleteRegistryRecord(
  orgCtx: OrgContext,
  removalId: string,
  operation: string,
  externalId: string,
  label: string,
  run: () => Promise<void>,
): Promise<RegistryDeleteOutcome> {
  let outcome: RegistryDeleteOutcome;
  try {
    await run();
    outcome = "deleted";
  } catch (error) {
    if (error instanceof IsometricApiError && error.status === 404) {
      outcome = "absent";
    } else {
      const message = registryDeleteRefusalMessage(error, label);
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
            error instanceof IsometricApiError ? (error.body ?? null) : null,
          errorMessage: message,
        },
        { removalId },
      );
      throw new SafeError(message);
    }
  }
  await appendSyncEventBestEffort(
    orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      operation,
      status: "succeeded",
      requestPayload: { id: externalId },
      responsePayload: { id: externalId, outcome },
    },
    { removalId },
  );
  return outcome;
}

function registryDeleteRefusalMessage(error: unknown, label?: string): string {
  const target = label ? `${label}` : "the registry records";
  if (error instanceof IsometricApiError) {
    if (error.code === "not_configured") return error.message;
    return `Isometric did not delete ${target}. ${describeIsometricApiError(error)} Only draft registry records can be deleted. Nothing was removed locally.`;
  }
  return `Isometric did not delete ${target}. Nothing was removed locally. Try again.`;
}
