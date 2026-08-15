import { env } from "@/config/env";
import {
  claimBiocharApplicationRegistration,
  confirmBiocharApplicationRegistration,
  getBiocharApplicationRegistration,
  markBiocharApplicationDrift,
} from "@/data-access/certifier-biochar-applications";
import { getProductionBatchRegistrations } from "@/data-access/certifier-production-batches";
import { withDedicatedSessionAdvisoryLock } from "@/db";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  biocharApplicationMismatchMessage,
  createBiocharApplication,
  findBiocharApplicationBySupplierReference,
  type IsometricBiocharApplication,
} from "@/lib/isometric/biochar-applications";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import {
  buildBiocharApplicationRequestFromIntent,
  type BiocharApplicationIntent,
} from "./biochar-application-intents";
import { ensureProductionBatchesForCreditBatches } from "./production-batches";
import {
  performRegistryCreate,
  supplierRefLookup,
  type RegistryExternalMutationReporter,
} from "./registry-create";
import { ensureStorageLocation } from "./storage-locations";

const BIOCHAR_APPLICATION_LOCK_SCOPE =
  "certifier-biochar-application:isometric";

export async function ensureRemovalBiocharApplications(args: {
  orgCtx: OrgContext;
  removalId: string;
  externalRemovalId: string;
  submissionRow: CertificationSubmissionRow;
  expectedLockedAt?: Date;
  intents: BiocharApplicationIntent[];
  resumed: boolean;
  onExternalMutation?: RegistryExternalMutationReporter;
  log: Logger;
}): Promise<void> {
  requireOrgRole(args.orgCtx, "admin");
  if (args.intents.length === 0) return;
  if (env.ISOMETRIC_ENVIRONMENT === "production") {
    throw new SafeError(
      "Storage Location and Biochar Application synchronization is not enabled for production yet.",
    );
  }
  const creditBatchIds = [
    ...new Set(args.intents.map((intent) => intent.creditBatchId)),
  ].sort();
  const externalProductionBatchIds =
    await ensureProductionBatchesForCreditBatches({
      orgCtx: args.orgCtx,
      removalId: args.removalId,
      submissionRow: args.submissionRow,
      expectedLockedAt: args.expectedLockedAt,
      deferRejectionToAttempt: true,
      onExternalMutation: args.onExternalMutation,
      creditBatchIds,
      log: args.log,
    });
  const productionRegistrations = await getProductionBatchRegistrations(
    args.orgCtx,
    creditBatchIds,
  );
  const productionRegistrationByBatchId = new Map(
    productionRegistrations.map((row) => [row.creditBatchId, row]),
  );

  const storageByApplicationId = new Map<
    string,
    Awaited<ReturnType<typeof ensureStorageLocation>>
  >();
  for (const intent of args.intents) {
    const storage = await ensureStorageLocation({
      orgCtx: args.orgCtx,
      applicationId: intent.applicationId,
      log: args.log,
    });
    if (storage.drifted) {
      throw new SafeError(
        `Application ${intent.applicationCode}'s registered Storage Location differs from its current site facts. Resolve the Storage Location drift before submitting.`,
      );
    }
    storageByApplicationId.set(intent.applicationId, storage);
  }

  for (const intent of args.intents) {
    const production = productionRegistrationByBatchId.get(
      intent.creditBatchId,
    );
    const externalProductionBatchId = externalProductionBatchIds.get(
      intent.creditBatchId,
    );
    const storage = storageByApplicationId.get(intent.applicationId);
    if (
      !production ||
      !externalProductionBatchId ||
      production.externalProductionBatchId !== externalProductionBatchId ||
      !storage
    ) {
      throw new SafeError(
        `Application ${intent.applicationCode} could not resolve its registered Production Batch or Storage Location. Retry the Removal submission.`,
      );
    }
    await ensureBiocharApplication({
      ...args,
      intent,
      productionBatchRegistrationId: production.id,
      externalProductionBatchId,
      storageLocationRegistrationId: storage.registration.id,
      externalStorageLocationId: storage.externalStorageLocationId,
    });
  }
}

async function ensureBiocharApplication(args: {
  orgCtx: OrgContext;
  removalId: string;
  externalRemovalId: string;
  submissionRow: CertificationSubmissionRow;
  expectedLockedAt?: Date;
  intent: BiocharApplicationIntent;
  productionBatchRegistrationId: string;
  externalProductionBatchId: string;
  storageLocationRegistrationId: string;
  externalStorageLocationId: string;
  resumed: boolean;
  onExternalMutation?: RegistryExternalMutationReporter;
  log: Logger;
}): Promise<void> {
  const body = buildBiocharApplicationRequestFromIntent({
    intent: args.intent,
    externalProductionBatchId: args.externalProductionBatchId,
    externalStorageLocationId: args.externalStorageLocationId,
  });
  const bodyHash = payloadHash(body);
  await withDedicatedSessionAdvisoryLock(
    `${BIOCHAR_APPLICATION_LOCK_SCOPE}:${args.orgCtx.organizationId}:${args.intent.applicationId}:${args.intent.creditBatchId}`,
    async () => {
      let registration = await getBiocharApplicationRegistration(
        args.orgCtx,
        args.intent.applicationId,
        args.intent.creditBatchId,
      );
      if (!registration) {
        registration = await claimBiocharApplicationRegistration(args.orgCtx, {
          applicationId: args.intent.applicationId,
          creditBatchId: args.intent.creditBatchId,
          productionBatchRegistrationId:
            args.productionBatchRegistrationId,
          storageLocationRegistrationId: args.storageLocationRegistrationId,
          externalProductionBatchId: args.externalProductionBatchId,
          externalStorageLocationId: args.externalStorageLocationId,
          supplierReference: args.intent.supplierReference,
          submittedPayload: body,
          payloadHash: bodyHash,
          observedGhgEntryId: args.externalRemovalId,
          observedRemovalId: null,
        });
      }
      const identityMatches =
        registration.payloadHash === bodyHash &&
        registration.supplierReference === args.intent.supplierReference &&
        registration.externalProductionBatchId ===
          args.externalProductionBatchId &&
        registration.externalStorageLocationId ===
          args.externalStorageLocationId;
      if (!identityMatches) {
        await markBiocharApplicationDrift(
          args.orgCtx,
          registration.id,
          "local_payload_or_dependency_drift",
        );
        throw new SafeError(
          `Application ${args.intent.applicationCode} differs from its registered Biochar Application payload. Resolve the journal drift before retrying.`,
        );
      }

      const client = await getIsometricClientForOrg(
        args.orgCtx.organizationId,
      );
      let confirmedRemote: IsometricBiocharApplication | null = null;
      await performRegistryCreate({
        orgCtx: args.orgCtx,
        entityType: "application",
        entityId: args.intent.applicationId,
        submissionRowId: args.submissionRow.id,
        expectedLockedAt: args.expectedLockedAt,
        deferRejectionToAttempt: true,
        operation: `biochar-application:create:${args.intent.applicationId}`,
        requestPayload: body,
        supplierRefId: args.intent.supplierReference,
        resumed: true,
        create: async () => {
          const remote = await createBiocharApplication(client, body);
          assertRemoteMatches(remote, body, args.externalRemovalId);
          confirmedRemote = remote;
          return remote.id;
        },
        reconcile: async () => {
          const remote = await findBiocharApplicationBySupplierReference(
            client,
            args.intent.supplierReference,
          );
          if (remote) {
            try {
              assertRemoteMatches(remote, body, args.externalRemovalId);
            } catch (error) {
              await markBiocharApplicationDrift(
                args.orgCtx,
                registration!.id,
                "remote_payload_or_identity_drift",
              );
              return {
                found: "refused" as const,
                message:
                  error instanceof SafeError
                    ? error.message
                    : "The matching Biochar Application has registry drift.",
              };
            }
            confirmedRemote = remote;
          } else if (registration!.lifecycleStatus === "confirmed") {
            await markBiocharApplicationDrift(
              args.orgCtx,
              registration!.id,
              "remote_record_missing",
            );
            return {
              found: "refused" as const,
              message: `Application ${args.intent.applicationCode}'s registered Biochar Application no longer exists. Resolve the registry drift before retrying.`,
            };
          }
          return supplierRefLookup(
            remote ? { found: true, externalId: remote.id } : { found: false },
          );
        },
        onConfirmed: async (externalApplicationId) => {
          const remote = confirmedRemote;
          if (
            registration!.lifecycleStatus === "confirmed" &&
            registration!.externalApplicationId !== externalApplicationId
          ) {
            await markBiocharApplicationDrift(
              args.orgCtx,
              registration!.id,
              "external_identity_drift",
            );
            throw new SafeError(
              `Application ${args.intent.applicationCode} is linked to a different Biochar Application identity. Resolve the journal drift before retrying.`,
            );
          }
          await confirmBiocharApplicationRegistration(args.orgCtx, {
            registrationId: registration!.id,
            expectedPayloadHash: bodyHash,
            externalApplicationId,
            observedGhgEntryId: remote?.ghg_entry_id ?? null,
            observedRemovalId: remote?.removal_id ?? null,
          });
        },
        failureMessagePrefix: `Biochar Application ${args.intent.applicationCode} could not be created`,
        onExternalMutation: args.onExternalMutation,
        log: args.log,
      });
    },
  );
}

function assertRemoteMatches(
  remote: IsometricBiocharApplication,
  body: Parameters<typeof biocharApplicationMismatchMessage>[1],
  externalRemovalId: string,
): void {
  const mismatch = biocharApplicationMismatchMessage(remote, body);
  if (mismatch) throw new SafeError(mismatch);
  if (!remote.ghg_entry_id && !remote.removal_id) {
    throw new SafeError(
      `Isometric Biochar Application ${remote.id} is not linked to a GHG Entry yet. Retry after Isometric records the association.`,
    );
  }
  if (
    (remote.ghg_entry_id && remote.ghg_entry_id !== externalRemovalId) ||
    (remote.removal_id && remote.removal_id !== externalRemovalId)
  ) {
    throw new SafeError(
      `Isometric Biochar Application ${remote.id} is linked to a different GHG Entry. Resolve the registry identity before retrying.`,
    );
  }
}
