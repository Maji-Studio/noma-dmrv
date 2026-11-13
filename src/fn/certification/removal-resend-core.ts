import { logActionError } from "@/fn/action-errors";
import { listGhgEntryTemplates } from "@/lib/isometric/projects";
import { getBiocharApplication } from "@/lib/isometric/biochar-applications";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { getRemovalResendProjectId, removalResendKey, retireMissingRemovalSubmission } from "@/data-access/removal-resend";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { isRegistryMissingSubmission, readRemovalRegistryPresence, type RemovalRegistryPresence } from "@/lib/certification/removal-registry-presence";
import { SafeError } from "@/lib/errors";
import { getGhgEntry } from "@/lib/isometric/submissions";
import type { IsometricClient } from "@/lib/isometric/client";
import type { RemovalResendInput } from "@/schemas/removal-resend";

async function checkRemote(ctx: OrgContext, input: RemovalResendInput, externalId: string, projectId: string): Promise<RemovalRegistryPresence> {
  let client: IsometricClient;
  try {
    client = await resolveIsometricClient(ctx);
  } catch (error) {
    logActionError(error, { message: "Removal registry credential resolution failed", context: { removalId: input.removalId, facilityId: input.facilityId } });
    return "unknown";
  }
  return checkRemoteWith(client, externalId, projectId, input);
}

async function checkRemoteWith(client: IsometricClient, externalId: string, projectId: string, input: RemovalResendInput): Promise<RemovalRegistryPresence> {
  try {
    await listGhgEntryTemplates(client, projectId);
  } catch (error) {
    logActionError(error, {
      message: "Removal registry project check failed",
      context: { removalId: input.removalId, facilityId: input.facilityId, externalProjectId: projectId },
    });
    return "unknown";
  }
  return readRemovalRegistryPresence(() => getGhgEntry(client, externalId), externalId);
}

export async function checkRemovalRegistryPresenceCore(ctx: OrgContext, input: RemovalResendInput): Promise<RemovalRegistryPresence> {
  requireOrgRole(ctx, "admin");
  await requireOrgFacility(ctx, input.facilityId);
  const removal = await getCertifierRemovalById(ctx, input.removalId);
  if (!removal || removal.facilityId !== input.facilityId) throw new SafeError("Removal does not belong to requested facility.");
  const latest = await getLatestSubmission(ctx, removalResendKey(input.removalId), input.facilityId);
  if (!latest?.externalId || (latest.status !== "submitted" && !isRegistryMissingSubmission(latest))) return "unknown";
  const projectId = await getRemovalResendProjectId(ctx, input.facilityId, latest.payloadSnapshot);
  if (!projectId) return "unknown";
  return checkRemote(ctx, input, latest.externalId, projectId);
}

export async function prepareRemovalResendCore(ctx: OrgContext, input: RemovalResendInput) {
  requireOrgRole(ctx, "admin");
  await requireOrgFacility(ctx, input.facilityId);
  // Resolve credentials before the retirement transaction opens: the lookup
  // needs its own pool connection, which a pool of one cannot spare.
  const client = await resolveIsometricClient(ctx);
  return retireMissingRemovalSubmission(ctx, input,
    (externalId, projectId) => checkRemoteWith(client, externalId, projectId, input),
    (externalId) => readRemovalRegistryPresence(() => getBiocharApplication(client, externalId), externalId),
  );
}
