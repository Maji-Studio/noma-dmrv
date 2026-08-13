/**
 * Server-internal create/reconcile seam for Isometric Storage Locations.
 * It is deliberately not wired to application CRUD or the existing Removal
 * payload. A certification workflow must invoke it with an already-claimed
 * submission row and explicit application intent.
 */

import {
  getStorageLocationRegistration,
  getStorageLocationRegistryInput,
  persistStorageLocationRegistration,
  setStorageLocationDrift,
  type StorageLocationRegistryInput,
} from "@/data-access/certifier-storage-locations";
import { withDedicatedSessionAdvisoryLock } from "@/db";
import type { CertifierStorageLocation } from "@/db/schema/certifier-storage-locations";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
import {
  buildCreateStorageLocationRequest,
  buildStorageLocationReference,
  createStorageLocation,
  findStorageLocationBySupplierReference,
  type CreateStorageLocationRequest,
  type IsometricStorageLocation,
} from "@/lib/isometric/storage-locations";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import { appendSyncEventBestEffort } from "./shared";

const STORAGE_LOCATION_ENTITY_TYPE = "application";
const STORAGE_LOCATION_LOCK_SCOPE = "certifier-storage-location:isometric";

export interface EnsureStorageLocationArgs {
  orgCtx: OrgContext;
  applicationId: string;
  submissionRow: { id: string };
  log: Logger;
}

export interface EnsureStorageLocationResult {
  externalStorageLocationId: string;
  registration: CertifierStorageLocation;
  source: "journal" | "create" | "reconciliation";
  drifted: boolean;
}

export async function ensureStorageLocation(
  args: EnsureStorageLocationArgs,
): Promise<EnsureStorageLocationResult> {
  requireOrgRole(args.orgCtx, "admin");
  const input = await getStorageLocationRegistryInput(
    args.orgCtx,
    args.applicationId,
  );
  if (!input) {
    throw new SafeError(
      "This application could not be loaded for Storage Location synchronization. Reload it and try again.",
    );
  }
  if (!input.customerLocationId) {
    throw new SafeError(
      "This application's delivery has no customer location. Select a destination before synchronizing its Storage Location.",
    );
  }
  const customerLocationId = input.customerLocationId;
  const existing = await getStorageLocationRegistration(
    args.orgCtx,
    customerLocationId,
  );
  if (existing) {
    const current = tryBuildCurrentStorageLocationPayload(input);
    return reuseStorageLocationRegistration({
      ...args,
      existing,
      body: current.body,
      currentPayloadHash: current.body ? payloadHash(current.body) : null,
      currentExternalProjectId: input.externalProjectId,
      missingFacts: current.missingFacts,
    });
  }
  if (!input.certifierProjectId || !input.externalProjectId) {
    throw new SafeError(
      "This application's facility is not linked to an Isometric project. Add the mapping under Certification settings before synchronizing its Storage Location.",
    );
  }
  const certifierProjectId = input.certifierProjectId;
  const externalProjectId = input.externalProjectId;

  const supplierReference = buildStorageLocationReference({
    customerLocationId,
  });
  const body = buildCreateStorageLocationRequest({
    externalProjectId,
    name: input.name ?? "",
    latitude: input.latitude,
    longitude: input.longitude,
    supplierReferenceId: supplierReference,
  });
  const currentPayloadHash = payloadHash(body);
  return withDedicatedSessionAdvisoryLock(
    `${STORAGE_LOCATION_LOCK_SCOPE}:${customerLocationId}`,
    async () => {
      // The first read is intentionally outside the lock for the common reuse
      // path. Re-read after acquiring it so two first-time syncs cannot both
      // reconcile "not found" and POST the same stable site concurrently.
      const concurrentWinner = await getStorageLocationRegistration(
        args.orgCtx,
        customerLocationId,
      );
      if (concurrentWinner) {
        return reuseStorageLocationRegistration({
          ...args,
          existing: concurrentWinner,
          body,
          currentPayloadHash,
          currentExternalProjectId: externalProjectId,
          missingFacts: [],
        });
      }

      const client = await getIsometricClientForOrg(args.orgCtx.organizationId);
      let registration: CertifierStorageLocation | null = null;
      const createResult = await performRegistryCreate({
        orgCtx: args.orgCtx,
        entityType: STORAGE_LOCATION_ENTITY_TYPE,
        entityId: args.applicationId,
        submissionRowId: args.submissionRow.id,
        operation: "storage-location:create",
        requestPayload: body,
        supplierRefId: supplierReference,
        // A missing local journal always means a previous POST might have won.
        resumed: true,
        create: async () => {
          const remote = await createStorageLocation(
            client,
            externalProjectId,
            body,
          );
          assertMatchingRemoteStorageLocation(remote, body);
          return remote.id;
        },
        reconcile: async () => {
          const remote = await findStorageLocationBySupplierReference(
            client,
            externalProjectId,
            supplierReference,
          );
          if (remote) {
            const mismatch = storageLocationMismatchMessage(remote, body);
            if (mismatch) {
              return { found: "refused" as const, message: mismatch };
            }
          }
          return supplierRefLookup(
            remote ? { found: true, externalId: remote.id } : { found: false },
          );
        },
        onConfirmed: async (externalStorageLocationId) => {
          const winner = await persistStorageLocationRegistration(args.orgCtx, {
            customerLocationId,
            certifierProjectId,
            externalProjectId,
            externalStorageLocationId,
            supplierReference,
            submittedPayload: body,
            payloadHash: currentPayloadHash,
          });
          if (
            winner.externalStorageLocationId !== externalStorageLocationId ||
            winner.supplierReference !== supplierReference ||
            winner.externalProjectId !== externalProjectId ||
            winner.payloadHash !== currentPayloadHash
          ) {
            throw new SafeError(
              "This customer location was concurrently registered with a different Isometric Storage Location identity. Review the registry record before retrying.",
            );
          }
          registration = winner;
        },
        failureMessagePrefix:
          "The Isometric Storage Location could not be created",
        log: args.log,
      });

      if (!registration) {
        throw new Error(
          `Storage Location ${createResult.externalId} was confirmed without a local registration`,
        );
      }
      return {
        externalStorageLocationId: createResult.externalId,
        registration,
        source: createResult.source,
        drifted: false,
      };
    },
  );
}

async function reuseStorageLocationRegistration(
  args: EnsureStorageLocationArgs & {
    existing: CertifierStorageLocation;
    body: CreateStorageLocationRequest | null;
    currentPayloadHash: string | null;
    currentExternalProjectId: string | null;
    missingFacts: string[];
  },
): Promise<EnsureStorageLocationResult> {
  const drifted =
    args.currentPayloadHash === null ||
    args.existing.payloadHash !== args.currentPayloadHash;
  await setStorageLocationDrift(
    args.orgCtx,
    args.existing.id,
    drifted
      ? {
          status: "drifted",
          details: {
            registeredPayloadHash: args.existing.payloadHash,
            currentPayloadHash: args.currentPayloadHash,
            registeredExternalProjectId: args.existing.externalProjectId,
            currentExternalProjectId: args.currentExternalProjectId,
            missingFacts: args.missingFacts,
          },
        }
      : { status: "in_sync" },
  );
  if (drifted) {
    args.log.warn(
      {
        applicationId: args.applicationId,
        storageLocationId: args.existing.externalStorageLocationId,
      },
      "registered Storage Location differs from current customer-location facts",
    );
    await appendSyncEventBestEffort(
      args.orgCtx,
      {
        provider: "isometric",
        entityType: STORAGE_LOCATION_ENTITY_TYPE,
        entityId: args.applicationId,
        operation: "storage-location:drift",
        status: "failed",
        requestPayload: args.body ?? {
          customer_location_id: args.existing.customerLocationId,
          missing_facts: args.missingFacts,
        },
        responsePayload: {
          id: args.existing.externalStorageLocationId,
          registered_payload_hash: args.existing.payloadHash,
          current_payload_hash: args.currentPayloadHash,
          action: "operator_review_required",
        },
        errorMessage:
          "The customer location no longer matches the registered Isometric Storage Location. Review the name or coordinates; noma did not update the registry record.",
      },
      { submissionId: args.submissionRow.id },
    );
  }
  return {
    externalStorageLocationId: args.existing.externalStorageLocationId,
    registration: args.existing,
    source: "journal",
    drifted,
  };
}

function tryBuildCurrentStorageLocationPayload(
  input: StorageLocationRegistryInput,
): { body: CreateStorageLocationRequest | null; missingFacts: string[] } {
  const missingFacts = [
    !input.certifierProjectId || !input.externalProjectId
      ? "project_mapping"
      : null,
    input.name?.trim() ? null : "site_name",
    input.latitude === null ? "latitude" : null,
    input.longitude === null ? "longitude" : null,
  ].filter((fact): fact is string => fact !== null);
  if (missingFacts.length > 0 || !input.customerLocationId) {
    return { body: null, missingFacts };
  }
  try {
    return {
      body: buildCreateStorageLocationRequest({
        externalProjectId: input.externalProjectId ?? "",
        name: input.name ?? "",
        latitude: input.latitude,
        longitude: input.longitude,
        supplierReferenceId: buildStorageLocationReference({
          customerLocationId: input.customerLocationId,
        }),
      }),
      missingFacts,
    };
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    return { body: null, missingFacts: ["invalid_site_facts"] };
  }
}

function assertMatchingRemoteStorageLocation(
  remote: IsometricStorageLocation,
  expected: CreateStorageLocationRequest,
): void {
  const mismatch = storageLocationMismatchMessage(remote, expected);
  if (mismatch) throw new SafeError(mismatch);
}

export function storageLocationMismatchMessage(
  remote: IsometricStorageLocation,
  expected: CreateStorageLocationRequest,
): string | null {
  if (
    remote.project_id !== expected.project_id ||
    remote.supplier_reference_id !== expected.supplier_reference_id ||
    remote.storage_method !== expected.storage_method ||
    remote.name !== expected.name ||
    remote.latitude !== expected.latitude ||
    remote.longitude !== expected.longitude
  ) {
    return "The matching Isometric Storage Location conflicts with this customer location's project, name, coordinates, or storage method. Resolve the remote identity before retrying.";
  }
  return null;
}
