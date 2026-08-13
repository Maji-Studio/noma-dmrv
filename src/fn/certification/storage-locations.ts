/**
 * Server-internal create/reconcile seam for Isometric Storage Locations.
 * It is deliberately not wired to application CRUD or the existing Removal
 * payload. The explicit sandbox action is its only supported caller.
 */

import {
  getStorageLocationRegistration,
  getStorageLocationRegistryInput,
  persistStorageLocationRegistration,
  setStorageLocationDrift,
  type StorageLocationRegistryInput,
} from "@/data-access/certifier-storage-locations";
import { env } from "@/config/env";
import { withDedicatedSessionAdvisoryLock } from "@/db";
import type { CertifierStorageLocation } from "@/db/schema/certifier-storage-locations";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  certifierExternalProjectLockKey,
  certifierProjectLockKey,
} from "@/lib/certification/certifier-project-lock";
import {
  getIsometricClientForOrg,
  IsometricApiError,
} from "@/lib/isometric/client";
import {
  buildCreateStorageLocationRequest,
  buildStorageLocationReference,
  createStorageLocation,
  findStorageLocationBySupplierReference,
  getStorageLocation,
  type CreateStorageLocationRequest,
  type IsometricStorageLocation,
} from "@/lib/isometric/storage-locations";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
} from "./shared";

export const STORAGE_LOCATION_ENTITY_TYPE = "customerLocation";
export const STORAGE_LOCATION_OPERATION_PREFIX = "storage-location:";
export const STORAGE_LOCATION_SYNC_OPERATION = `${STORAGE_LOCATION_OPERATION_PREFIX}sync`;
export const STORAGE_LOCATION_CREATE_OPERATION = `${STORAGE_LOCATION_OPERATION_PREFIX}create`;
export const STORAGE_LOCATION_DRIFT_OPERATION = `${STORAGE_LOCATION_OPERATION_PREFIX}drift`;
const STORAGE_LOCATION_LOCK_SCOPE = "certifier-storage-location:isometric";
const STORAGE_LOCATION_COORDINATE_TOLERANCE = 0.000001;

export interface EnsureStorageLocationArgs {
  orgCtx: OrgContext;
  applicationId: string;
  log: Logger;
}

export interface EnsureStorageLocationResult {
  externalStorageLocationId: string;
  registration: CertifierStorageLocation;
  source: "journal" | "create" | "reconciliation";
  drifted: boolean;
}

/** Event identity follows the same project-scoped grain as the registry row. */
export function storageLocationEventEntityId(
  input: Pick<
    StorageLocationRegistryInput,
    "customerLocationId" | "externalProjectId" | "facilityId"
  >,
): string {
  if (input.customerLocationId && input.externalProjectId) {
    return buildStorageLocationReference({
      customerLocationId: input.customerLocationId,
      externalProjectId: input.externalProjectId,
    });
  }
  return `unmapped:${input.facilityId}:${input.customerLocationId ?? "none"}`;
}

export async function ensureStorageLocation(
  args: EnsureStorageLocationArgs,
): Promise<EnsureStorageLocationResult> {
  requireOrgRole(args.orgCtx, "admin");
  if (env.ISOMETRIC_ENVIRONMENT === "production") {
    throw new SafeError(
      "Storage Location synchronization is not enabled for production yet.",
    );
  }
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
  if (!input.certifierProjectId || !input.externalProjectId) {
    throw new SafeError(
      "This application's facility is not linked to an Isometric project. Add the mapping under Certification settings before synchronizing its Storage Location.",
    );
  }
  const certifierProjectId = input.certifierProjectId;
  const externalProjectId = input.externalProjectId;
  const existing = await getStorageLocationRegistration(
    args.orgCtx,
    customerLocationId,
    externalProjectId,
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
  const supplierReference = buildStorageLocationReference({
    customerLocationId,
    externalProjectId,
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
    `${STORAGE_LOCATION_LOCK_SCOPE}:${externalProjectId}:${customerLocationId}`,
    () =>
      withDedicatedSessionAdvisoryLock(
        certifierExternalProjectLockKey({
          organizationId: args.orgCtx.organizationId,
          externalProjectId,
          provider: ISOMETRIC_PROVIDER,
        }),
        () =>
          withDedicatedSessionAdvisoryLock(
            certifierProjectLockKey({
              organizationId: args.orgCtx.organizationId,
              facilityId: input.facilityId,
              provider: ISOMETRIC_PROVIDER,
            }),
            () =>
              createStorageLocationUnderLocks({
                args,
                input,
                customerLocationId,
                certifierProjectId,
                externalProjectId,
                supplierReference,
                body,
                currentPayloadHash,
              }),
          ),
      ),
  );
}

async function createStorageLocationUnderLocks(input: {
  args: EnsureStorageLocationArgs;
  input: StorageLocationRegistryInput;
  customerLocationId: string;
  certifierProjectId: string;
  externalProjectId: string;
  supplierReference: string;
  body: CreateStorageLocationRequest;
  currentPayloadHash: string;
}): Promise<EnsureStorageLocationResult> {
  const lockedInput = await getStorageLocationRegistryInput(
    input.args.orgCtx,
    input.args.applicationId,
  );
  if (
    !lockedInput ||
    lockedInput.facilityId !== input.input.facilityId ||
    lockedInput.customerLocationId !== input.customerLocationId ||
    lockedInput?.certifierProjectId !== input.certifierProjectId ||
    lockedInput.externalProjectId !== input.externalProjectId
  ) {
    throw new SafeError(
      "The application's certifier project changed while its Storage Location was being prepared. Reload the application and try again.",
    );
  }
  const lockedCurrent = tryBuildCurrentStorageLocationPayload(lockedInput);
  if (
    !lockedCurrent.body ||
    payloadHash(lockedCurrent.body) !== input.currentPayloadHash
  ) {
    throw new SafeError(
      "The application site changed while its Storage Location was being prepared. Reload the application and try again.",
    );
  }

  // Re-read after both locks so concurrent first syncs cannot POST twice.
  const concurrentWinner = await getStorageLocationRegistration(
    input.args.orgCtx,
    input.customerLocationId,
    input.externalProjectId,
  );
  if (concurrentWinner) {
    return reuseStorageLocationRegistration({
      ...input.args,
      existing: concurrentWinner,
      body: input.body,
      currentPayloadHash: input.currentPayloadHash,
      currentExternalProjectId: input.externalProjectId,
      missingFacts: [],
    });
  }

  const client = await getIsometricClientForOrg(
    input.args.orgCtx.organizationId,
  );
  let registration: CertifierStorageLocation | null = null;
  let createdRemoteDriftReason: string | null = null;
  const createResult = await performRegistryCreate({
    orgCtx: input.args.orgCtx,
    entityType: STORAGE_LOCATION_ENTITY_TYPE,
    entityId: input.supplierReference,
    operation: STORAGE_LOCATION_CREATE_OPERATION,
    requestPayload: input.body,
    supplierRefId: input.supplierReference,
    resumed: true,
    create: async () => {
      const remote = await createStorageLocation(
        client,
        input.externalProjectId,
        input.body,
      );
      // A successful POST has already minted the remote identity. Preserve its
      // ID even if the provider normalized echoed facts, then surface the
      // discrepancy through the durable drift workflow instead of orphaning it.
      createdRemoteDriftReason = storageLocationMismatchMessage(
        remote,
        input.body,
      );
      return remote.id;
    },
    reconcile: async () => {
      const remote = await findStorageLocationBySupplierReference(
        client,
        input.externalProjectId,
        input.supplierReference,
      );
      if (remote) {
        const mismatch = storageLocationMismatchMessage(remote, input.body);
        if (
          remote.project_id !== input.body.project_id ||
          remote.supplier_reference_id !== input.body.supplier_reference_id
        ) {
          return {
            found: "refused" as const,
            message:
              "The matching Isometric Storage Location conflicts with this application's project-scoped identity. Resolve the remote identity before retrying.",
          };
        }
        // A deterministic supplier-reference match is our previously minted
        // identity even when the original POST response was lost. Adopt it and
        // surface mutable provider normalization or later edits as drift.
        createdRemoteDriftReason = mismatch;
      }
      return supplierRefLookup(
        remote ? { found: true, externalId: remote.id } : { found: false },
      );
    },
    onConfirmed: async (externalStorageLocationId) => {
      const winner = await persistStorageLocationRegistration(
        input.args.orgCtx,
        {
          customerLocationId: input.customerLocationId,
          certifierProjectId: input.certifierProjectId,
          externalProjectId: input.externalProjectId,
          externalStorageLocationId,
          supplierReference: input.supplierReference,
          submittedPayload: input.body,
          payloadHash: input.currentPayloadHash,
        },
      );
      if (
        winner.externalStorageLocationId !== externalStorageLocationId ||
        winner.supplierReference !== input.supplierReference ||
        winner.externalProjectId !== input.externalProjectId ||
        winner.payloadHash !== input.currentPayloadHash
      ) {
        throw new SafeError(
          "This customer location was concurrently registered with a different Isometric Storage Location identity. Review the registry record before retrying.",
        );
      }
      registration = winner;
    },
    failureMessagePrefix: "The Isometric Storage Location could not be created",
    log: input.args.log,
  });

  // The callback runs before performRegistryCreate resolves, but TypeScript
  // does not model assignments performed through an awaited callback.
  const confirmedRegistration = registration as CertifierStorageLocation | null;
  if (!confirmedRegistration) {
    throw new Error(
      `Storage Location ${createResult.externalId} was confirmed without a local registration`,
    );
  }
  const confirmedInput = await getStorageLocationRegistryInput(
    input.args.orgCtx,
    input.args.applicationId,
  );
  const confirmedCurrent = confirmedInput
    ? tryBuildCurrentStorageLocationPayload(confirmedInput)
    : { body: null, missingFacts: ["application_missing"] };
  if (
    confirmedInput?.customerLocationId !== input.customerLocationId ||
    confirmedInput.externalProjectId !== input.externalProjectId ||
    !confirmedCurrent.body ||
    payloadHash(confirmedCurrent.body) !== input.currentPayloadHash
  ) {
    createdRemoteDriftReason =
      "The application site changed while the registry identity was being confirmed.";
  }
  if (createdRemoteDriftReason) {
    await setStorageLocationDrift(input.args.orgCtx, confirmedRegistration.id, {
      status: "drifted",
      details: {
        registeredPayloadHash: input.currentPayloadHash,
        currentPayloadHash: input.currentPayloadHash,
        registeredExternalProjectId: input.externalProjectId,
        currentExternalProjectId: input.externalProjectId,
        missingFacts: [],
        remoteDriftReason: createdRemoteDriftReason,
      },
    });
    await appendSyncEventBestEffort(input.args.orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      entityType: STORAGE_LOCATION_ENTITY_TYPE,
      entityId: input.supplierReference,
      operation: STORAGE_LOCATION_DRIFT_OPERATION,
      status: "succeeded",
      requestPayload: input.body,
      responsePayload: {
        id: createResult.externalId,
        remote_drift_reason: createdRemoteDriftReason,
        action: "operator_review_required",
      },
    });
  }
  return {
    externalStorageLocationId: createResult.externalId,
    registration: confirmedRegistration,
    source: createResult.source,
    drifted: createdRemoteDriftReason !== null,
  };
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
  const localDrifted =
    args.currentPayloadHash === null ||
    args.existing.payloadHash !== args.currentPayloadHash;
  const client = await getIsometricClientForOrg(args.orgCtx.organizationId);
  let remoteDriftReason: string | null = null;
  try {
    const remote = await getStorageLocation(
      client,
      args.existing.externalProjectId,
      args.existing.externalStorageLocationId,
    );
    remoteDriftReason = storageLocationMismatchMessage(
      remote,
      args.existing.submittedPayload,
    );
  } catch (error) {
    if (error instanceof IsometricApiError && error.status === 404) {
      remoteDriftReason = "The registered Isometric Storage Location no longer exists.";
    } else {
      throw error;
    }
  }
  const drifted = localDrifted || remoteDriftReason !== null;
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
            remoteDriftReason,
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
        provider: ISOMETRIC_PROVIDER,
        entityType: STORAGE_LOCATION_ENTITY_TYPE,
        entityId: args.existing.supplierReference,
        operation: STORAGE_LOCATION_DRIFT_OPERATION,
        status: "succeeded",
        requestPayload: args.body ?? {
          customer_location_id: args.existing.customerLocationId,
          missing_facts: args.missingFacts,
        },
        responsePayload: {
          id: args.existing.externalStorageLocationId,
          registered_payload_hash: args.existing.payloadHash,
          current_payload_hash: args.currentPayloadHash,
          remote_drift_reason: remoteDriftReason,
          action: "operator_review_required",
        },
      },
    );
  }
  return {
    externalStorageLocationId: args.existing.externalStorageLocationId,
    registration: args.existing,
    source: "journal",
    drifted,
  };
}

export function missingStorageLocationFacts(
  input: StorageLocationRegistryInput,
): string[] {
  return [
    !input.certifierProjectId || !input.externalProjectId
      ? "project_mapping"
      : null,
    input.name?.trim() ? null : "site_name",
    input.latitude == null ? "latitude" : null,
    input.longitude == null ? "longitude" : null,
  ].filter((fact): fact is string => fact !== null);
}

function tryBuildCurrentStorageLocationPayload(
  input: StorageLocationRegistryInput,
): { body: CreateStorageLocationRequest | null; missingFacts: string[] } {
  const missingFacts = missingStorageLocationFacts(input);
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
          externalProjectId: input.externalProjectId ?? "",
        }),
      }),
      missingFacts,
    };
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    return { body: null, missingFacts: ["invalid_site_facts"] };
  }
}

export function storageLocationMismatchMessage(
  remote: IsometricStorageLocation,
  expected: CreateStorageLocationRequest,
): string | null {
  if (
    remote.project_id !== expected.project_id ||
    remote.supplier_reference_id !== expected.supplier_reference_id ||
    remote.storage_method !== expected.storage_method ||
    remote.name.trim() !== expected.name.trim() ||
    remote.latitude == null ||
    remote.longitude == null ||
    Math.abs(remote.latitude - expected.latitude) >
      STORAGE_LOCATION_COORDINATE_TOLERANCE ||
    Math.abs(remote.longitude - expected.longitude) >
      STORAGE_LOCATION_COORDINATE_TOLERANCE
  ) {
    return "The matching Isometric Storage Location conflicts with this customer location's project, name, coordinates, or storage method. Resolve the remote identity before retrying.";
  }
  return null;
}
