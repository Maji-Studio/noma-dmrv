"use server";

import { z } from "zod";
import { env } from "@/config/env";
import { listRecentSyncEvents } from "@/data-access/certification";
import {
  getStorageLocationRegistration,
  getStorageLocationRegistryInput,
} from "@/data-access/certifier-storage-locations";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { appendSyncEventBestEffort } from "./shared";
import { ensureStorageLocation } from "./storage-locations";

const applicationIdSchema = z.uuid();
const STORAGE_LOCATION_EVENT_LIMIT = 20;
const STORAGE_LOCATION_OPERATION_PREFIX = "storage-location:";

export type ApplicationStorageLocationSyncState =
  | "not_synced"
  | "synced"
  | "drifted"
  | "failed";

export interface ApplicationStorageLocationSyncView {
  state: ApplicationStorageLocationSyncState;
  externalStorageLocationId: string | null;
  lastError: string | null;
  attemptedAt: Date | null;
  blocker: string | null;
  viewerCanManage: boolean;
}

export async function loadApplicationStorageLocationSync(
  applicationId: string,
): Promise<ActionResult<ApplicationStorageLocationSyncView>> {
  return withAction((orgCtx) =>
    loadApplicationStorageLocationSyncForOrg(
      orgCtx,
      applicationIdSchema.parse(applicationId),
    ),
  );
}

export async function syncApplicationStorageLocation(
  applicationId: string,
): Promise<ActionResult<ApplicationStorageLocationSyncView>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsedApplicationId = applicationIdSchema.parse(applicationId);
    if (env.ISOMETRIC_ENVIRONMENT === "production") {
      throw new SafeError(
        "Storage Location synchronization is not enabled for production yet.",
      );
    }
    const log = logger.child({
      op: "storage-location:sync",
      applicationId: parsedApplicationId,
    });

    try {
      const result = await ensureStorageLocation({
        orgCtx,
        applicationId: parsedApplicationId,
        log,
      });
      await appendSyncEventBestEffort(orgCtx, {
        provider: "isometric",
        entityType: "application",
        entityId: parsedApplicationId,
        operation: "storage-location:sync",
        status: "succeeded",
        responsePayload: {
          id: result.externalStorageLocationId,
          source: result.source,
          drifted: result.drifted,
        },
      });
    } catch (error) {
      const message =
        error instanceof SafeError
          ? error.message
          : "Storage Location synchronization failed. Try again.";
      await appendSyncEventBestEffort(orgCtx, {
        provider: "isometric",
        entityType: "application",
        entityId: parsedApplicationId,
        operation: "storage-location:sync",
        status: "failed",
        errorMessage: message,
      });
      throw error;
    }

    return loadApplicationStorageLocationSyncForOrg(
      orgCtx,
      parsedApplicationId,
    );
  });
}

async function loadApplicationStorageLocationSyncForOrg(
  orgCtx: OrgContext,
  applicationId: string,
): Promise<ApplicationStorageLocationSyncView> {
  const input = await getStorageLocationRegistryInput(orgCtx, applicationId);
  if (!input) {
    throw new SafeError("Application not found.");
  }
  const viewerCanManage =
    orgCtx.isPlatformAdmin ||
    orgCtx.orgRole === "owner" ||
    orgCtx.orgRole === "admin";
  const events = await listRecentSyncEvents(orgCtx, {
    entityType: "application",
    entityId: applicationId,
    limit: STORAGE_LOCATION_EVENT_LIMIT,
  });
  const latestStorageLocationAttempt = events.find((event) =>
    event.operation.startsWith(STORAGE_LOCATION_OPERATION_PREFIX),
  );
  const latestFailedAttempt =
    latestStorageLocationAttempt?.status === "failed"
      ? latestStorageLocationAttempt
      : null;

  if (!input.customerLocationId) {
    return {
      state: latestFailedAttempt ? "failed" : "not_synced",
      externalStorageLocationId: null,
      lastError: latestFailedAttempt?.errorMessage ?? null,
      attemptedAt: latestFailedAttempt?.attemptedAt ?? null,
      blocker: "Select a customer location on the delivery before synchronizing.",
      viewerCanManage,
    };
  }

  const registration = await getStorageLocationRegistration(
    orgCtx,
    input.customerLocationId,
  );
  if (registration) {
    return {
      state: registration.driftStatus === "drifted" ? "drifted" : "synced",
      externalStorageLocationId: registration.externalStorageLocationId,
      lastError: null,
      attemptedAt: registration.updatedAt,
      blocker:
        env.ISOMETRIC_ENVIRONMENT === "production"
          ? "Storage Location synchronization is not enabled for production yet."
          : null,
      viewerCanManage,
    };
  }

  return {
    state: latestFailedAttempt ? "failed" : "not_synced",
    externalStorageLocationId: null,
    lastError: latestFailedAttempt?.errorMessage ?? null,
    attemptedAt: latestFailedAttempt?.attemptedAt ?? null,
    blocker: storageLocationBlocker(input),
    viewerCanManage,
  };
}

function storageLocationBlocker(
  input: Awaited<ReturnType<typeof getStorageLocationRegistryInput>>,
): string | null {
  if (!input) return "Application not found.";
  if (!input.certifierProjectId || !input.externalProjectId) {
    return "Link this facility to an Isometric project before synchronizing.";
  }
  if (!input.name?.trim()) {
    return "Name the customer location before synchronizing.";
  }
  if (input.latitude === null || input.longitude === null) {
    return "Add customer-location coordinates before synchronizing.";
  }
  if (env.ISOMETRIC_ENVIRONMENT === "production") {
    return "Storage Location synchronization is not enabled for production yet.";
  }
  return null;
}
