import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  listFacilitiesLinkedToExternal,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";
import { facilityIdSchema } from "./facility-id";

/**
 * What the certification settings surface needs before it can offer to link,
 * relink, or unlink a facility: the current mapping, how many facilities share
 * that registry project, the registry environment, and whether this viewer may
 * change any of it.
 */
export interface FacilityCertifierSummary {
  mapping: CertifierProjectRow | null;
  linkedFacilityCount: number;
  isProduction: boolean;
  viewerCanManage: boolean;
}

/** The certification settings summary for one facility. */
export async function readFacilityCertifierSummary(
  ctx: OrgContext,
  input: unknown,
): Promise<FacilityCertifierSummary> {
  const facilityId = facilityIdSchema.parse(input);
  await requireOrgFacility(ctx, facilityId);
  const mapping = await getCertifierProjectByFacility(
    ctx,
    facilityId,
    ISOMETRIC_PROVIDER,
  );
  const linkedFacilities = mapping
    ? await listFacilitiesLinkedToExternal(
        ctx,
        ISOMETRIC_PROVIDER,
        mapping.externalProjectId,
      )
    : [];
  return {
    mapping,
    linkedFacilityCount: linkedFacilities.length,
    isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    viewerCanManage:
      ctx.isPlatformAdmin ||
      ctx.orgRole === "owner" ||
      ctx.orgRole === "admin",
  };
}
