import { getLatestSubmission } from "@/data-access/certification-submissions";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { resolveIsometricClient } from "@/data-access/certifier-credentials";
import { removalResendKey, retireMissingRemovalSubmission } from "@/data-access/removal-resend";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { isRegistryMissingSubmission, readRemovalRegistryPresence, type RemovalRegistryPresence } from "@/lib/certification/removal-registry-presence";
import { SafeError } from "@/lib/errors";
import { getGhgEntry } from "@/lib/isometric/submissions";
import type { RemovalResendInput } from "@/schemas/removal-resend";

async function checkRemote(ctx: OrgContext, externalId: string): Promise<RemovalRegistryPresence> {
  return readRemovalRegistryPresence(async () => {
    const client = await resolveIsometricClient(ctx);
    return getGhgEntry(client, externalId);
  }, externalId);
}

export async function checkRemovalRegistryPresenceCore(ctx: OrgContext, input: RemovalResendInput): Promise<RemovalRegistryPresence> {
  requireOrgRole(ctx, "admin");
  await requireOrgFacility(ctx, input.facilityId);
  const removal = await getCertifierRemovalById(ctx, input.removalId);
  if (!removal || removal.facilityId !== input.facilityId) throw new SafeError("Removal does not belong to requested facility.");
  const latest = await getLatestSubmission(ctx, removalResendKey(input.removalId), input.facilityId);
  // Already retired and waiting for the next version: still missing, no GET needed.
  if (isRegistryMissingSubmission(latest)) return "missing";
  if (latest?.status !== "submitted" || !latest.externalId) return "unknown";
  return checkRemote(ctx, latest.externalId);
}

export async function prepareRemovalResendCore(ctx: OrgContext, input: RemovalResendInput) {
  requireOrgRole(ctx, "admin");
  await requireOrgFacility(ctx, input.facilityId);
  return retireMissingRemovalSubmission(ctx, input, (externalId) => checkRemote(ctx, externalId));
}
